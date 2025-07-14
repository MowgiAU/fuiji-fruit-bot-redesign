const fs = require('fs').promises;
const path = require('path');

class MigrationPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Data Migration';
        this.description = 'Migrate XP/levels from Arcane and reputation from YAGPDB';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        this.migrationFile = path.join(__dirname, '../data/migrationData.json');
        this.levelingDataFile = path.join(__dirname, '../data/levelingData.json');
        this.levelingSettingsFile = path.join(__dirname, '../data/levelingSettings.json');
        this.reputationDataFile = path.join(__dirname, '../data/reputationData.json');
        this.reputationSettingsFile = path.join(__dirname, '../data/reputationSettings.json');
        
        // Migration conversion rates
        this.CONVERSION_RATES = {
            ARCANE_LEVEL_TO_NEW: 0.33, // Level 15 Arcane = Level 5 New (15 * 0.33 = 5)
            ARCANE_XP_TO_NEW: 0.25,    // More conservative XP conversion
            YAGPDB_REP_TO_NEW: 1,      // 1:1 for now, can adjust
            YAGPDB_REP_TO_LEGACY: 1    // Keep original rep as legacy category
        };
        
        this.initializeData();
        this.setupRoutes();
    }

    async initializeData() {
        try {
            // Initialize migration tracking file
            try {
                await fs.access(this.migrationFile);
            } catch {
                const initialData = {
                    migrations: {}, // guildId: { arcane: { completed: false, date: null, users: [] }, yagpdb: { completed: false, date: null, users: [] } }
                    backups: {} // Store original data before migration
                };
                await fs.writeFile(this.migrationFile, JSON.stringify(initialData, null, 2));
            }
        } catch (error) {
            console.error('Error initializing migration data:', error);
        }
    }

    async loadMigrationData() {
        try {
            const data = await fs.readFile(this.migrationFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading migration data:', error);
            return { migrations: {}, backups: {} };
        }
    }

    async saveMigrationData(data) {
        try {
            await fs.writeFile(this.migrationFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving migration data:', error);
        }
    }

    async loadLevelingData() {
        try {
            const data = await fs.readFile(this.levelingDataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return { users: {}, leaderboards: {} };
        }
    }

    async saveLevelingData(data) {
        try {
            await fs.writeFile(this.levelingDataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving leveling data:', error);
        }
    }

    async loadReputationData() {
        try {
            const data = await fs.readFile(this.reputationDataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return { users: {}, history: {}, leaderboards: {} };
        }
    }

    async saveReputationData(data) {
        try {
            await fs.writeFile(this.reputationDataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving reputation data:', error);
        }
    }

    calculateNewLevel(arcaneXP) {
        // Convert Arcane XP to new XP using conversion rate
        const newXP = Math.floor(arcaneXP * this.CONVERSION_RATES.ARCANE_XP_TO_NEW);
        
        // Calculate level using the new system's formula: level = floor(sqrt(xp / 100))
        const newLevel = Math.floor(Math.sqrt(newXP / 100));
        
        return { newXP, newLevel };
    }

    async migrateArcaneData(guildId, arcaneData) {
        try {
            const migrationData = await this.loadMigrationData();
            const levelingData = await this.loadLevelingData();
            
            // Create backup
            if (!migrationData.backups[guildId]) {
                migrationData.backups[guildId] = {};
            }
            migrationData.backups[guildId].arcane = {
                originalData: arcaneData,
                backupDate: new Date().toISOString(),
                levelingDataBackup: JSON.parse(JSON.stringify(levelingData))
            };

            const migratedUsers = [];

            // Process each user in the Arcane data
            for (const arcaneUser of arcaneData) {
                const { userId, level: arcaneLevel, xp: arcaneXP, rank } = arcaneUser;
                
                // Skip if no valid data
                if (!userId || (!arcaneLevel && !arcaneXP)) continue;

                // Calculate new values
                const { newXP, newLevel } = this.calculateNewLevel(arcaneXP || 0);
                
                // Initialize user data in leveling system
                if (!levelingData.users[userId]) {
                    levelingData.users[userId] = {};
                }
                
                if (!levelingData.users[userId][guildId]) {
                    levelingData.users[userId][guildId] = {
                        xp: 0,
                        level: 0,
                        lastMessageTime: 0,
                        voiceTime: 0,
                        reactionsGiven: 0,
                        reactionsReceived: 0
                    };
                }

                // Migrate the data (add to existing, don't overwrite)
                const userData = levelingData.users[userId][guildId];
                userData.xp += newXP;
                userData.level = Math.max(userData.level, newLevel);
                
                // Add migration metadata
                userData.migratedFromArcane = {
                    originalLevel: arcaneLevel,
                    originalXP: arcaneXP,
                    originalRank: rank,
                    migrationDate: new Date().toISOString(),
                    convertedXP: newXP,
                    convertedLevel: newLevel
                };

                migratedUsers.push({
                    userId,
                    originalLevel: arcaneLevel,
                    originalXP: arcaneXP,
                    newLevel: userData.level,
                    newXP: userData.xp
                });
            }

            // Save updated leveling data
            await this.saveLevelingData(levelingData);

            // Update migration tracking
            if (!migrationData.migrations[guildId]) {
                migrationData.migrations[guildId] = {};
            }
            migrationData.migrations[guildId].arcane = {
                completed: true,
                date: new Date().toISOString(),
                users: migratedUsers,
                totalUsers: migratedUsers.length
            };

            await this.saveMigrationData(migrationData);

            return {
                success: true,
                migratedUsers: migratedUsers.length,
                users: migratedUsers
            };

        } catch (error) {
            console.error('Error migrating Arcane data:', error);
            throw error;
        }
    }

    async migrateYAGPDBReputation(guildId, yagpdbData) {
        try {
            const migrationData = await this.loadMigrationData();
            const reputationData = await this.loadReputationData();
            
            // Create backup
            if (!migrationData.backups[guildId]) {
                migrationData.backups[guildId] = {};
            }
            migrationData.backups[guildId].yagpdb = {
                originalData: yagpdbData,
                backupDate: new Date().toISOString(),
                reputationDataBackup: JSON.parse(JSON.stringify(reputationData))
            };

            const migratedUsers = [];

            // Initialize reputation data structures if needed
            if (!reputationData.users) reputationData.users = {};
            if (!reputationData.history) reputationData.history = {};
            if (!reputationData.leaderboards) reputationData.leaderboards = {};
            if (!reputationData.history[guildId]) reputationData.history[guildId] = {};

            // Process each user in the YAGPDB data
            for (const yagpdbUser of yagpdbData) {
                const { userId, reputation, given, received } = yagpdbUser;
                
                // Skip if no valid data
                if (!userId || !reputation) continue;

                // Initialize user data in reputation system
                if (!reputationData.users[userId]) {
                    reputationData.users[userId] = {};
                }

                if (!reputationData.users[userId][guildId]) {
                    reputationData.users[userId][guildId] = {
                        categories: {
                            helpfulness: 0,
                            creativity: 0,
                            reliability: 0,
                            community: 0,
                            legacy: 0 // New category for migrated rep
                        },
                        total: 0,
                        given: 0,
                        received: 0,
                        streaks: { current: 0, longest: 0 },
                        badges: [],
                        lastActive: Date.now()
                    };
                }

                const userData = reputationData.users[userId][guildId];
                
                // Add YAGPDB reputation as "legacy" category
                const legacyRep = Math.floor(reputation * this.CONVERSION_RATES.YAGPDB_REP_TO_LEGACY);
                userData.categories.legacy += legacyRep;
                userData.total += legacyRep;
                
                // Add given/received if available
                if (given) userData.given += Math.floor(given * this.CONVERSION_RATES.YAGPDB_REP_TO_NEW);
                if (received) userData.received += Math.floor(received * this.CONVERSION_RATES.YAGPDB_REP_TO_NEW);

                // Add migration metadata
                userData.migratedFromYAGPDB = {
                    originalReputation: reputation,
                    originalGiven: given || 0,
                    originalReceived: received || 0,
                    migrationDate: new Date().toISOString(),
                    convertedLegacyRep: legacyRep
                };

                // Add migration history entry
                if (!reputationData.history[guildId][userId]) {
                    reputationData.history[guildId][userId] = [];
                }

                reputationData.history[guildId][userId].push({
                    from: 'system',
                    to: userId,
                    category: 'legacy',
                    amount: legacyRep,
                    reason: `Migrated from YAGPDB (original: ${reputation})`,
                    timestamp: Date.now(),
                    type: 'migration'
                });

                migratedUsers.push({
                    userId,
                    originalReputation: reputation,
                    newLegacyRep: legacyRep,
                    newTotal: userData.total
                });
            }

            // Save updated reputation data
            await this.saveReputationData(reputationData);

            // Update migration tracking
            if (!migrationData.migrations[guildId]) {
                migrationData.migrations[guildId] = {};
            }
            migrationData.migrations[guildId].yagpdb = {
                completed: true,
                date: new Date().toISOString(),
                users: migratedUsers,
                totalUsers: migratedUsers.length
            };

            await this.saveMigrationData(migrationData);

            return {
                success: true,
                migratedUsers: migratedUsers.length,
                users: migratedUsers
            };

        } catch (error) {
            console.error('Error migrating YAGPDB data:', error);
            throw error;
        }
    }

    setupRoutes() {
        // Get migration status
        this.app.get('/api/plugins/migration/status/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                if (!await this.hasAdminPermissions(req.user.id, req.params.guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                const migrationData = await this.loadMigrationData();
                const guildMigrations = migrationData.migrations[req.params.guildId] || {};

                res.json({
                    arcane: guildMigrations.arcane || { completed: false },
                    yagpdb: guildMigrations.yagpdb || { completed: false }
                });
            } catch (error) {
                console.error('Error getting migration status:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Preview migration (dry run)
        this.app.post('/api/plugins/migration/preview', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, type, data } = req.body;

                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                let preview = [];

                if (type === 'arcane') {
                    for (const user of data) {
                        const { newXP, newLevel } = this.calculateNewLevel(user.xp || 0);
                        preview.push({
                            userId: user.userId,
                            originalLevel: user.level,
                            originalXP: user.xp,
                            newLevel,
                            newXP
                        });
                    }
                } else if (type === 'yagpdb') {
                    for (const user of data) {
                        const legacyRep = Math.floor(user.reputation * this.CONVERSION_RATES.YAGPDB_REP_TO_LEGACY);
                        preview.push({
                            userId: user.userId,
                            originalReputation: user.reputation,
                            newLegacyRep: legacyRep
                        });
                    }
                }

                res.json({ preview });
            } catch (error) {
                console.error('Error previewing migration:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Execute migration
        this.app.post('/api/plugins/migration/execute', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, type, data } = req.body;

                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                let result;

                if (type === 'arcane') {
                    result = await this.migrateArcaneData(guildId, data);
                } else if (type === 'yagpdb') {
                    result = await this.migrateYAGPDBReputation(guildId, data);
                } else {
                    return res.status(400).json({ error: 'Invalid migration type' });
                }

                res.json(result);
            } catch (error) {
                console.error('Error executing migration:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get conversion rates
        this.app.get('/api/plugins/migration/rates', this.ensureAuthenticated, (req, res) => {
            res.json(this.CONVERSION_RATES);
        });

        // Update conversion rates
        this.app.post('/api/plugins/migration/rates', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.body;

                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                const { rates } = req.body;
                Object.assign(this.CONVERSION_RATES, rates);

                res.json({ success: true, rates: this.CONVERSION_RATES });
            } catch (error) {
                console.error('Error updating conversion rates:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Rollback migration
        this.app.post('/api/plugins/migration/rollback', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, type } = req.body;

                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                const migrationData = await this.loadMigrationData();
                const backup = migrationData.backups[guildId]?.[type];

                if (!backup) {
                    return res.status(404).json({ error: 'No backup found for rollback' });
                }

                if (type === 'arcane') {
                    await this.saveLevelingData(backup.levelingDataBackup);
                } else if (type === 'yagpdb') {
                    await this.saveReputationData(backup.reputationDataBackup);
                }

                // Mark migration as not completed
                if (migrationData.migrations[guildId] && migrationData.migrations[guildId][type]) {
                    migrationData.migrations[guildId][type].completed = false;
                    migrationData.migrations[guildId][type].rolledBack = true;
                    migrationData.migrations[guildId][type].rollbackDate = new Date().toISOString();
                }

                await this.saveMigrationData(migrationData);

                res.json({ success: true, message: `${type} migration rolled back successfully` });
            } catch (error) {
                console.error('Error rolling back migration:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

    getFrontendComponent() {
        return {
            id: 'migration-plugin',
            name: 'Data Migration',
            description: 'Migrate XP/levels from Arcane and reputation from YAGPDB',
            icon: '🔄',
            containerId: 'migrationPluginContainer',
            pageId: 'migration',
            navIcon: '🔄',
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🔄</span> Data Migration</h3>
                        <p>Migrate XP/levels from Arcane and reputation from YAGPDB into your new systems</p>
                    </div>

                    <div class="settings-section">
                        <h3>Migration Status</h3>
                        <div class="form-group">
                            <label for="migrationServerSelect">Server</label>
                            <select id="migrationServerSelect" required>
                                <option value="">Select a server...</option>
                            </select>
                        </div>

                        <div id="migrationStatusContainer" style="display: none;">
                            <div class="migration-status" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">
                                <div id="arcaneStatus" class="status-card" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                                    <h4 style="margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px;">
                                        <span>⚡</span> Arcane XP/Levels
                                    </h4>
                                    <div id="arcaneStatusText" style="margin-bottom: 10px;">Not migrated</div>
                                    <button id="arcaneStartBtn" class="btn-primary" style="width: 100%;">Start Migration</button>
                                    <button id="arcaneRollbackBtn" class="btn-secondary" style="width: 100%; margin-top: 8px; display: none;">Rollback</button>
                                </div>
                                
                                <div id="yagpdbStatus" class="status-card" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                                    <h4 style="margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px;">
                                        <span>🏆</span> YAGPDB Reputation
                                    </h4>
                                    <div id="yagpdbStatusText" style="margin-bottom: 10px;">Not migrated</div>
                                    <button id="yagpdbStartBtn" class="btn-primary" style="width: 100%;">Start Migration</button>
                                    <button id="yagpdbRollbackBtn" class="btn-secondary" style="width: 100%; margin-top: 8px; display: none;">Rollback</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="conversionRatesSection" style="display: none;">
                        <h3>Conversion Rates</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; margin: 15px 0;">
                            <div class="form-group">
                                <label for="arcaneXpRate">Arcane XP Conversion Rate</label>
                                <input type="number" id="arcaneXpRate" step="0.01" min="0" max="2" value="0.25">
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Multiplier for converting Arcane XP to new XP (e.g., 0.25 = 25% of original)
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="yagpdbRepRate">YAGPDB Reputation Conversion Rate</label>
                                <input type="number" id="yagpdbRepRate" step="0.01" min="0" max="2" value="1.0">
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Multiplier for converting YAGPDB reputation to legacy reputation
                                </small>
                            </div>
                            
                            <button type="button" id="saveRatesBtn" class="btn-secondary">
                                Save Conversion Rates
                            </button>
                        </div>
                    </div>

                    <div id="migrationFormSection" style="display: none;">
                        <h3 id="migrationFormTitle">Migration Setup</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                            <div class="form-group">
                                <label for="migrationDataInput">Data (JSON Format)</label>
                                <textarea id="migrationDataInput" rows="10" placeholder="Paste your migration data here..." style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 10px; color: white; font-family: monospace;"></textarea>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Expected format: [{"userId": "123", "level": 15, "xp": 22500}] for Arcane or [{"userId": "123", "reputation": 50}] for YAGPDB
                                </small>
                            </div>
                            
                            <div style="display: flex; gap: 10px;">
                                <button type="button" id="previewMigrationBtn" class="btn-secondary">
                                    Preview Migration
                                </button>
                                <button type="button" id="executeMigrationBtn" class="btn-primary" disabled>
                                    Execute Migration
                                </button>
                                <button type="button" id="cancelMigrationBtn" class="btn-secondary">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="migrationPreviewSection" style="display: none;">
                        <h3>Migration Preview</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; margin: 15px 0;">
                            <div id="previewContent"></div>
                        </div>
                    </div>
                </div>
            `,
            script: `
                // Migration Plugin Frontend Logic
                (function() {
                    const migrationServerSelect = document.getElementById('migrationServerSelect');
                    const migrationStatusContainer = document.getElementById('migrationStatusContainer');
                    const conversionRatesSection = document.getElementById('conversionRatesSection');
                    const migrationFormSection = document.getElementById('migrationFormSection');
                    const migrationPreviewSection = document.getElementById('migrationPreviewSection');
                    
                    let currentServer = '';
                    let currentMigrationType = '';
                    let migrationPreviewData = null;

                    async function loadUserServers(selectElement) {
                        try {
                            const response = await fetch('/api/servers');
                            const servers = await response.json();
                            selectElement.innerHTML = '<option value="">Select a server...</option>';
                            servers.forEach(server => {
                                const option = document.createElement('option');
                                option.value = server.id;
                                option.textContent = server.name;
                                selectElement.appendChild(option);
                            });
                        } catch (error) {
                            console.error('Error loading servers:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading servers', 'error');
                            }
                        }
                    }

                    // Load servers on page load
                    if (migrationServerSelect) {
                        loadUserServers(migrationServerSelect);
                    }

                    migrationServerSelect.addEventListener('change', async () => {
                        currentServer = migrationServerSelect.value;
                        if (currentServer) {
                            await loadMigrationStatus();
                            migrationStatusContainer.style.display = 'block';
                            conversionRatesSection.style.display = 'block';
                            await loadConversionRates();
                        } else {
                            migrationStatusContainer.style.display = 'none';
                            conversionRatesSection.style.display = 'none';
                        }
                    });

                    async function loadMigrationStatus() {
                        try {
                            const response = await fetch(\`/api/plugins/migration/status/\${currentServer}\`);
                            const status = await response.json();

                            updateStatusDisplay('arcane', status.arcane);
                            updateStatusDisplay('yagpdb', status.yagpdb);
                        } catch (error) {
                            console.error('Error loading migration status:', error);
                            showNotification('Error loading migration status', 'error');
                        }
                    }

                    function updateStatusDisplay(type, status) {
                        const statusText = document.getElementById(\`\${type}StatusText\`);
                        const startBtn = document.getElementById(\`\${type}StartBtn\`);
                        const rollbackBtn = document.getElementById(\`\${type}RollbackBtn\`);

                        if (status.completed) {
                            statusText.innerHTML = \`
                                <div style="color: #4CAF50;">✅ Completed</div>
                                <div style="font-size: 0.9em; opacity: 0.8;">
                                    \${new Date(status.date).toLocaleString()}<br>
                                    \${status.totalUsers} users migrated
                                </div>
                            \`;
                            startBtn.style.display = 'none';
                            rollbackBtn.style.display = 'block';
                        } else {
                            statusText.innerHTML = '<div style="color: #FFC107;">⏳ Not migrated</div>';
                            startBtn.style.display = 'block';
                            rollbackBtn.style.display = 'none';
                        }
                    }

                    async function loadConversionRates() {
                        try {
                            const response = await fetch('/api/plugins/migration/rates');
                            const rates = await response.json();

                            document.getElementById('arcaneXpRate').value = rates.ARCANE_XP_TO_NEW;
                            document.getElementById('yagpdbRepRate').value = rates.YAGPDB_REP_TO_LEGACY;
                        } catch (error) {
                            console.error('Error loading conversion rates:', error);
                        }
                    }

                    // Event listeners for start migration buttons
                    document.getElementById('arcaneStartBtn').addEventListener('click', () => {
                        startMigration('arcane');
                    });

                    document.getElementById('yagpdbStartBtn').addEventListener('click', () => {
                        startMigration('yagpdb');
                    });

                    function startMigration(type) {
                        currentMigrationType = type;
                        document.getElementById('migrationFormTitle').textContent = 
                            \`\${type === 'arcane' ? 'Arcane XP/Levels' : 'YAGPDB Reputation'} Migration\`;
                        
                        migrationFormSection.style.display = 'block';
                        document.getElementById('migrationDataInput').value = '';
                        document.getElementById('executeMigrationBtn').disabled = true;
                        migrationPreviewSection.style.display = 'none';
                    }

                    // Preview migration
                    document.getElementById('previewMigrationBtn').addEventListener('click', async () => {
                        const dataInput = document.getElementById('migrationDataInput').value.trim();
                        
                        if (!dataInput) {
                            showNotification('Please enter migration data', 'error');
                            return;
                        }

                        try {
                            const data = JSON.parse(dataInput);
                            
                            const response = await fetch('/api/plugins/migration/preview', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    guildId: currentServer,
                                    type: currentMigrationType,
                                    data: data
                                })
                            });

                            const result = await response.json();
                            migrationPreviewData = result.preview;
                            
                            displayPreview(result.preview);
                            document.getElementById('executeMigrationBtn').disabled = false;
                            migrationPreviewSection.style.display = 'block';
                            
                        } catch (error) {
                            console.error('Error previewing migration:', error);
                            showNotification('Error parsing or previewing data', 'error');
                        }
                    });

                    function displayPreview(preview) {
                        const previewContent = document.getElementById('previewContent');
                        
                        if (!preview.length) {
                            previewContent.innerHTML = '<p style="text-align: center; opacity: 0.7;">No valid data to migrate</p>';
                            return;
                        }

                        let html = \`
                            <h4>Migration Preview (\${preview.length} users)</h4>
                            <div style="max-height: 300px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead>
                                        <tr style="background: rgba(255,255,255,0.1);">
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">User ID</th>
                        \`;

                        if (currentMigrationType === 'arcane') {
                            html += \`
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">Original Level</th>
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">Original XP</th>
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">New Level</th>
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">New XP</th>
                            \`;
                        } else {
                            html += \`
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">Original Rep</th>
                                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.2);">Legacy Rep</th>
                            \`;
                        }

                        html += \`
                                        </tr>
                                    </thead>
                                    <tbody>
                        \`;

                        preview.slice(0, 50).forEach(user => {
                            html += \`<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">\`;
                            html += \`<td style="padding: 8px;">\${user.userId}</td>\`;
                            
                            if (currentMigrationType === 'arcane') {
                                html += \`
                                    <td style="padding: 8px;">\${user.originalLevel}</td>
                                    <td style="padding: 8px;">\${user.originalXP.toLocaleString()}</td>
                                    <td style="padding: 8px; color: #4CAF50;">\${user.newLevel}</td>
                                    <td style="padding: 8px; color: #4CAF50;">\${user.newXP.toLocaleString()}</td>
                                \`;
                            } else {
                                html += \`
                                    <td style="padding: 8px;">\${user.originalReputation}</td>
                                    <td style="padding: 8px; color: #4CAF50;">\${user.newLegacyRep}</td>
                                \`;
                            }
                            
                            html += \`</tr>\`;
                        });

                        if (preview.length > 50) {
                            html += \`<tr><td colspan="\${currentMigrationType === 'arcane' ? 5 : 3}" style="padding: 8px; text-align: center; opacity: 0.7;">... and \${preview.length - 50} more users</td></tr>\`;
                        }

                        html += \`
                                    </tbody>
                                </table>
                            </div>
                        \`;

                        previewContent.innerHTML = html;
                    }

                    // Execute migration
                    document.getElementById('executeMigrationBtn').addEventListener('click', async () => {
                        if (!migrationPreviewData) {
                            showNotification('Please preview the migration first', 'error');
                            return;
                        }

                        const confirmed = confirm(\`Are you sure you want to migrate \${migrationPreviewData.length} users? This action cannot be easily undone.\`);
                        if (!confirmed) return;

                        try {
                            const dataInput = document.getElementById('migrationDataInput').value.trim();
                            const data = JSON.parse(dataInput);

                            const response = await fetch('/api/plugins/migration/execute', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    guildId: currentServer,
                                    type: currentMigrationType,
                                    data: data
                                })
                            });

                            const result = await response.json();
                            
                            if (result.success) {
                                showNotification(\`Successfully migrated \${result.migratedUsers} users!\`, 'success');
                                migrationFormSection.style.display = 'none';
                                migrationPreviewSection.style.display = 'none';
                                await loadMigrationStatus();
                            } else {
                                showNotification('Migration failed', 'error');
                            }
                            
                        } catch (error) {
                            console.error('Error executing migration:', error);
                            showNotification('Error executing migration', 'error');
                        }
                    });

                    // Cancel migration
                    document.getElementById('cancelMigrationBtn').addEventListener('click', () => {
                        migrationFormSection.style.display = 'none';
                        migrationPreviewSection.style.display = 'none';
                        currentMigrationType = '';
                        migrationPreviewData = null;
                    });

                    // Save conversion rates
                    document.getElementById('saveRatesBtn').addEventListener('click', async () => {
                        try {
                            const rates = {
                                ARCANE_XP_TO_NEW: parseFloat(document.getElementById('arcaneXpRate').value),
                                YAGPDB_REP_TO_LEGACY: parseFloat(document.getElementById('yagpdbRepRate').value)
                            };

                            const response = await fetch('/api/plugins/migration/rates', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    guildId: currentServer,
                                    rates: rates
                                })
                            });

                            const result = await response.json();
                            
                            if (result.success) {
                                showNotification('Conversion rates saved!', 'success');
                            } else {
                                showNotification('Error saving rates', 'error');
                            }
                            
                        } catch (error) {
                            console.error('Error saving conversion rates:', error);
                            showNotification('Error saving conversion rates', 'error');
                        }
                    });

                    // Rollback event listeners
                    document.getElementById('arcaneRollbackBtn').addEventListener('click', () => {
                        rollbackMigration('arcane');
                    });

                    document.getElementById('yagpdbRollbackBtn').addEventListener('click', () => {
                        rollbackMigration('yagpdb');
                    });

                    async function rollbackMigration(type) {
                        const confirmed = confirm(\`Are you sure you want to rollback the \${type} migration? This will restore the data to its state before migration.\`);
                        if (!confirmed) return;

                        try {
                            const response = await fetch('/api/plugins/migration/rollback', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    guildId: currentServer,
                                    type: type
                                })
                            });

                            const result = await response.json();
                            
                            if (result.success) {
                                showNotification(\`\${type} migration rolled back successfully!\`, 'success');
                                await loadMigrationStatus();
                            } else {
                                showNotification(result.error || 'Rollback failed', 'error');
                            }
                            
                        } catch (error) {
                            console.error('Error rolling back migration:', error);
                            showNotification('Error rolling back migration', 'error');
                        }
                    }

                })();
            `
        };
    }
}

module.exports = MigrationPlugin;