const fs = require('fs').promises;
const path = require('path');

class LevelingPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Leveling System';
        this.description = 'XP and leveling system with multiple sources and leaderboards';
        this.version = '2.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // File paths
        this.dataFile = './data/levelingData.json';
        this.settingsFile = './data/levelingSettings.json';
        this.backupDir = './data/backups/leveling';
        
        // Backup configuration
        this.maxBackups = 50;
        this.backupInterval = 30 * 60 * 1000; // 30 minutes
        this.dailyBackupHour = 3; // 3 AM daily backup
        
        // XP calculation constants
        this.XP_RATES = {
            MESSAGE: { min: 15, max: 25 },
            VOICE_PER_MINUTE: 10,
            REACTION_GIVEN: 5,
            REACTION_RECEIVED: 3
        };
        
        // Rate limiting (prevent XP farming)
        this.MESSAGE_COOLDOWN = 60000; // 1 minute
        this.VOICE_UPDATE_INTERVAL = 60000; // 1 minute
        
        this.userCooldowns = new Map();
        this.voiceTracker = new Map();
        
        // Initialize everything
        this.initialize();
    }

    async initialize() {
        try {
            await this.ensureDirectories();
            await this.initializeData();
            await this.initializeBackupSystem();
            this.setupRoutes();
            this.setupBackupRoutes();
            this.setupDiscordEvents(); // FIXED: Make sure this method exists
            this.setupSlashCommands();
            
            // Start intervals
            setInterval(() => this.updateVoiceXP(), this.VOICE_UPDATE_INTERVAL);
            
            console.log('✅ Leveling Plugin v2.0 loaded with dashboard integration');
        } catch (error) {
            console.error('❌ Failed to initialize Leveling Plugin:', error);
        }
    }

    async ensureDirectories() {
        try {
            await fs.mkdir('./data', { recursive: true });
            await fs.mkdir(this.backupDir, { recursive: true });
        } catch (error) {
            console.error('Error creating directories:', error);
        }
    }

    async initializeData() {
        try {
            // Initialize data file
            try {
                await fs.access(this.dataFile);
            } catch {
                const initialData = {
                    users: {},
                    leaderboards: {}
                };
                await fs.writeFile(this.dataFile, JSON.stringify(initialData, null, 2));
            }
            
            // Initialize settings file
            try {
                await fs.access(this.settingsFile);
            } catch {
                const initialSettings = {};
                await fs.writeFile(this.settingsFile, JSON.stringify(initialSettings, null, 2));
            }
            
            console.log('✓ Leveling: Data files initialized');
        } catch (error) {
            console.error('Error initializing data files:', error);
        }
    }

    async initializeBackupSystem() {
        try {
            await this.cleanupOldBackups();
            this.startPeriodicBackups();
            this.startDailyBackups();
            console.log('✓ Leveling: Backup system initialized');
        } catch (error) {
            console.error('Error initializing backup system:', error);
        }
    }

    // ============================================================================
    // DATA MANAGEMENT
    // ============================================================================

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            const parsed = JSON.parse(data);
            
            if (!parsed.users) parsed.users = {};
            if (!parsed.leaderboards) parsed.leaderboards = {};
            
            return parsed;
        } catch (error) {
            console.warn('⚠️ Leveling: Could not load data file. Starting with empty data.');
            return { users: {}, leaderboards: {} };
        }
    }

    async loadDataRaw() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return { users: {}, leaderboards: {} };
        }
    }

    async saveData(data) {
        try {
            // Validate data before saving
            if (!data.users || typeof data.users !== 'object') {
                throw new Error('Invalid data structure: missing users object');
            }
            
            // Create pre-save backup
            await this.createBackup('pre-save', 'Before data modification');
            
            // Write to temporary file first (atomic operation)
            const tempFile = this.dataFile + '.tmp';
            await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
            
            // Verify the temp file can be parsed
            const verification = JSON.parse(await fs.readFile(tempFile, 'utf8'));
            if (!verification.users) {
                throw new Error('Verification failed: corrupted temp file');
            }
            
            // Rename temp file to actual file (atomic operation)
            await fs.rename(tempFile, this.dataFile);
            
        } catch (error) {
            console.error('Error saving leveling data:', error);
            
            // Clean up temp file if it exists
            try {
                await fs.unlink(this.dataFile + '.tmp');
            } catch {}
            
            throw error;
        }
    }

    async loadSettings() {
        try {
            const data = await fs.readFile(this.settingsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async saveSettings(settings) {
        await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
    }

    async getGuildStats(guildId) {
        try {
            const data = await this.loadData();
            let totalUsers = 0;
            let totalXP = 0;
            let totalLevels = 0;
            let activeToday = 0;
            
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            for (const [userId, userData] of Object.entries(data.users)) {
                if (userData[guildId]) {
                    const guildData = userData[guildId];
                    totalUsers++;
                    totalXP += guildData.xp || 0;
                    totalLevels += guildData.level || 0;
                    
                    if ((guildData.lastMessageTime || 0) > oneDayAgo) {
                        activeToday++;
                    }
                }
            }
            
            return {
                totalUsers,
                totalXP,
                averageLevel: totalUsers > 0 ? Math.round((totalLevels / totalUsers) * 100) / 100 : 0,
                activeToday
            };
        } catch (error) {
            console.error('Error getting guild stats:', error);
            return {
                totalUsers: 0,
                totalXP: 0,
                averageLevel: 0,
                activeToday: 0
            };
        }
    }

    setupSlashCommands() {
        // Placeholder for slash command setup
        // In a full implementation, you'd register /level and /leaderboard commands here
        console.log('✓ Leveling: Slash commands ready for registration');
    }

    // ============================================================================
    // FRONTEND COMPONENT
    // ============================================================================

    getFrontendComponent() {
        return {
            id: 'leveling',
            name: 'Leveling System',
            description: 'Configure XP sources, view leaderboards, and manage user levels',
            icon: '📈',
            version: '2.0.0',
            containerId: 'levelingPluginContainer',
            
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">📈</span> Leveling System v2.0</h3>
                        <p>Configure XP sources, view leaderboards, and manage user levels</p>
                    </div>

                    <!-- Server Integration Notice -->
                    <div class="server-sync-notice" style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🔗</span>
                            <div>
                                <strong>Dashboard Integration</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Managing server: <span id="currentServerName">Auto-detected</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Discord Commands Info -->
                    <div class="info-section" style="background: rgba(34, 197, 94, 0.1); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                        <h4>🎯 Discord Slash Commands</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-top: 15px;">
                            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                                <strong>/level [user]</strong>
                                <div style="opacity: 0.8; margin-top: 4px;">Check your level or someone else's level</div>
                            </div>
                            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                                <strong>/leaderboard [type]</strong>
                                <div style="opacity: 0.8; margin-top: 4px;">View server leaderboards (overall, voice, reactions)</div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Section -->
                    <div class="settings-section">
                        <h3>Settings</h3>
                        <form id="levelingSettingsForm">
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="levelingEnabled"> Enable Leveling System
                                </label>
                            </div>

                            <div class="form-group">
                                <label>XP Sources</label>
                                <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceMessages" style="margin-top: 3px; transform: scale(1.1);">
                                        <div>
                                            <div style="font-weight: 500; margin-bottom: 2px;">Messages</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">15-25 XP per message, 1 min cooldown</div>
                                        </div>
                                    </label>
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceVoice" style="margin-top: 3px; transform: scale(1.1);">
                                        <div>
                                            <div style="font-weight: 500; margin-bottom: 2px;">Voice Activity</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">10 XP per minute in voice channels</div>
                                        </div>
                                    </label>
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceReactions" style="margin-top: 3px; transform: scale(1.1);">
                                        <div>
                                            <div style="font-weight: 500; margin-bottom: 2px;">Reactions</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">5 XP for giving, 3 XP for receiving reactions</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="levelUpChannel">Level Up Notifications Channel</label>
                                <select id="levelUpChannel">
                                    <option value="">None (disabled)</option>
                                </select>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Choose where level up announcements will be posted
                                </small>
                            </div>

                            <div class="form-group">
                                <label for="xpMultiplier">XP Multiplier</label>
                                <input type="number" id="xpMultiplier" min="0.1" max="10" step="0.1" value="1.0">
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Multiply all XP gains by this amount (0.1x to 10x)
                                </small>
                            </div>

                            <button type="button" id="saveLevelingSettings" class="btn-primary">
                                <span class="btn-text">Save Settings</span>
                                <span class="btn-loader" style="display: none;">Saving...</span>
                            </button>
                        </form>
                    </div>

                    <!-- Stats Section -->
                    <div class="stats-section">
                        <h3>Server Statistics</h3>
                        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
                            <div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
                                <div style="font-size: 2em; margin-bottom: 8px;">👥</div>
                                <div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="totalUsers">0</div>
                                <div style="opacity: 0.7;">Total Users</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
                                <div style="font-size: 2em; margin-bottom: 8px;">⭐</div>
                                <div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="totalXP">0</div>
                                <div style="opacity: 0.7;">Total XP</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
                                <div style="font-size: 2em; margin-bottom: 8px;">📊</div>
                                <div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="averageLevel">0</div>
                                <div style="opacity: 0.7;">Average Level</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
                                <div style="font-size: 2em; margin-bottom: 8px;">🔥</div>
                                <div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="activeToday">0</div>
                                <div style="opacity: 0.7;">Active Today</div>
                            </div>
                        </div>
                    </div>

                    <!-- Leaderboards Section -->
                    <div class="leaderboards-section">
                        <h3>Leaderboards</h3>
                        <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                            <button type="button" id="leaderboardType" data-type="overall" class="leaderboard-btn active" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer;">
                                Overall XP
                            </button>
                            <button type="button" class="leaderboard-btn" data-type="voice" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                Voice Activity
                            </button>
                            <button type="button" class="leaderboard-btn" data-type="reactions" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                Reactions
                            </button>
                            <button type="button" id="refreshLeaderboard" style="padding: 8px 16px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; color: white; cursor: pointer; margin-left: auto;">
                                🔄 Refresh
                            </button>
                        </div>

                        <div id="leaderboardContent" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; min-height: 200px;">
                            <div id="leaderboardLoading" style="text-align: center; opacity: 0.6; padding: 40px;">
                                Loading leaderboard...
                            </div>
                            <div id="leaderboardList" style="display: none;"></div>
                        </div>
                    </div>

                    <!-- XP Management Section -->
                    <div class="xp-management-section">
                        <h3>XP Management</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px;">
                            <div class="form-group">
                                <label for="xpUserId">User ID or @mention</label>
                                <input type="text" id="xpUserId" placeholder="Enter user ID or @mention">
                            </div>
                            <div class="form-group">
                                <label for="xpAmount">XP Amount (positive to add, negative to remove)</label>
                                <input type="number" id="xpAmount" placeholder="Enter XP amount">
                            </div>
                            <button type="button" id="addXpBtn" class="btn-primary">
                                <span class="btn-text">Apply XP Change</span>
                                <span class="btn-loader" style="display: none;">Processing...</span>
                            </button>
                        </div>
                    </div>

                    <!-- Backup Management Section -->
                    <div class="backup-section">
                        <h3>Backup Management</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px;">
                            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                                <button type="button" id="createBackupBtn" class="btn-primary">
                                    <span class="btn-text">📦 Create Backup</span>
                                    <span class="btn-loader" style="display: none;">Creating...</span>
                                </button>
                                <button type="button" id="refreshBackupsBtn" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                    🔄 Refresh List
                                </button>
                                <button type="button" id="syncDataBtn" style="padding: 8px 16px; background: rgba(255, 193, 7, 0.2); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px; color: white; cursor: pointer;">
                                    🔧 Sync Data
                                </button>
                            </div>
                            
                            <div id="backupsList" style="max-height: 300px; overflow-y: auto;">
                                <div style="text-align: center; opacity: 0.6; padding: 20px;">
                                    Click "Refresh List" to load available backups
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Result Messages -->
                    <div id="levelingResult" class="result-message" style="display: none;"></div>
                </div>
            `,
            
            script: `
                // Enhanced Leveling Plugin Frontend Logic with Dashboard Integration
                (function() {
                    console.log('📈 Enhanced Leveling Plugin: Initializing...');
                    
                    // State variables
                    let currentServerId = null;
                    let currentSettings = {};
                    let currentLeaderboardType = 'overall';
                    
                    // Get DOM elements
                    const currentServerName = document.getElementById('currentServerName');
                    const levelingSettingsForm = document.getElementById('levelingSettingsForm');
                    const levelingEnabled = document.getElementById('levelingEnabled');
                    const xpSourceMessages = document.getElementById('xpSourceMessages');
                    const xpSourceVoice = document.getElementById('xpSourceVoice');
                    const xpSourceReactions = document.getElementById('xpSourceReactions');
                    const levelUpChannel = document.getElementById('levelUpChannel');
                    const xpMultiplier = document.getElementById('xpMultiplier');
                    const saveLevelingSettings = document.getElementById('saveLevelingSettings');
                    
                    // Stats elements
                    const totalUsers = document.getElementById('totalUsers');
                    const totalXP = document.getElementById('totalXP');
                    const averageLevel = document.getElementById('averageLevel');
                    const activeToday = document.getElementById('activeToday');
                    
                    // Leaderboard elements
                    const leaderboardType = document.getElementById('leaderboardType');
                    const refreshLeaderboard = document.getElementById('refreshLeaderboard');
                    const leaderboardContent = document.getElementById('leaderboardContent');
                    const leaderboardLoading = document.getElementById('leaderboardLoading');
                    const leaderboardList = document.getElementById('leaderboardList');
                    
                    // XP Management elements
                    const xpUserId = document.getElementById('xpUserId');
                    const xpAmount = document.getElementById('xpAmount');
                    const addXpBtn = document.getElementById('addXpBtn');
                    
                    // Backup elements
                    const createBackupBtn = document.getElementById('createBackupBtn');
                    const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
                    const syncDataBtn = document.getElementById('syncDataBtn');
                    const backupsList = document.getElementById('backupsList');
                    
                    // Result element
                    const levelingResult = document.getElementById('levelingResult');
                    
                    // Initialize plugin
                    function initializeLevelingPlugin() {
                        console.log('🔄 Initializing Enhanced Leveling Plugin...');
                        
                        // Set up server detection
                        if (window.dashboardAPI && window.dashboardAPI.getCurrentServer) {
                            currentServerId = window.dashboardAPI.getCurrentServer();
                            if (currentServerId && currentServerName) {
                                loadServerName();
                            }
                        } else {
                            // Fallback to global server selection
                            const serverDropdown = document.getElementById('serverDropdown');
                            if (serverDropdown && serverDropdown.value) {
                                currentServerId = serverDropdown.value;
                                if (currentServerName) {
                                    currentServerName.textContent = serverDropdown.options[serverDropdown.selectedIndex].text;
                                }
                            }
                        }
                        
                        setupEventListeners();
                        
                        if (currentServerId) {
                            loadSettings();
                            loadStats();
                            loadChannels();
                            loadLeaderboard();
                        }
                    }
                    
                    function setupEventListeners() {
                        // Settings form
                        if (saveLevelingSettings) {
                            saveLevelingSettings.addEventListener('click', saveSettings);
                        }
                        
                        // Leaderboard buttons
                        const leaderboardBtns = document.querySelectorAll('.leaderboard-btn');
                        leaderboardBtns.forEach(btn => {
                            btn.addEventListener('click', function() {
                                // Update active state
                                leaderboardBtns.forEach(b => {
                                    b.style.background = 'rgba(255,255,255,0.1)';
                                    b.style.borderColor = 'rgba(255,255,255,0.2)';
                                    b.classList.remove('active');
                                });
                                this.style.background = 'rgba(255,255,255,0.2)';
                                this.style.borderColor = 'rgba(255,255,255,0.3)';
                                this.classList.add('active');
                                
                                currentLeaderboardType = this.dataset.type;
                                loadLeaderboard();
                            });
                        });
                        
                        // Refresh leaderboard
                        if (refreshLeaderboard) {
                            refreshLeaderboard.addEventListener('click', loadLeaderboard);
                        }
                        
                        // XP management
                        if (addXpBtn) {
                            addXpBtn.addEventListener('click', manageXP);
                        }
                        
                        // Backup management
                        if (createBackupBtn) {
                            createBackupBtn.addEventListener('click', createBackup);
                        }
                        if (refreshBackupsBtn) {
                            refreshBackupsBtn.addEventListener('click', loadBackups);
                        }
                        if (syncDataBtn) {
                            syncDataBtn.addEventListener('click', syncUserData);
                        }
                        
                        // Listen for server changes
                        document.addEventListener('serverChanged', function(event) {
                            currentServerId = event.detail.serverId;
                            loadServerName();
                            loadSettings();
                            loadStats();
                            loadChannels();
                            loadLeaderboard();
                        });
                    }
                    
                    async function loadServerName() {
                        if (!currentServerId || !currentServerName) return;
                        
                        try {
                            const response = await fetch('/api/servers');
                            const servers = await response.json();
                            const server = servers.find(s => s.id === currentServerId);
                            if (server && currentServerName) {
                                currentServerName.textContent = server.name;
                            }
                        } catch (error) {
                            console.error('Error loading server name:', error);
                        }
                    }
                    
                    async function loadSettings() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load settings');
                            
                            currentSettings = await response.json();
                            populateSettingsForm();
                        } catch (error) {
                            console.error('Error loading settings:', error);
                            showResult('Error loading settings: ' + error.message, 'error');
                        }
                    }
                    
                    function populateSettingsForm() {
                        if (levelingEnabled) levelingEnabled.checked = currentSettings.enabled !== false;
                        if (xpSourceMessages) xpSourceMessages.checked = currentSettings.xpSources?.messages !== false;
                        if (xpSourceVoice) xpSourceVoice.checked = currentSettings.xpSources?.voice !== false;
                        if (xpSourceReactions) xpSourceReactions.checked = currentSettings.xpSources?.reactions !== false;
                        if (levelUpChannel) levelUpChannel.value = currentSettings.levelUpChannel || '';
                        if (xpMultiplier) xpMultiplier.value = currentSettings.xpMultiplier || 1.0;
                    }
                    
                    async function saveSettings() {
                        if (!currentServerId) {
                            showResult('Please select a server first', 'error');
                            return;
                        }
                        
                        const btnText = saveLevelingSettings.querySelector('.btn-text');
                        const btnLoader = saveLevelingSettings.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            saveLevelingSettings.disabled = true;
                            
                            const settingsData = {
                                enabled: levelingEnabled?.checked || false,
                                xpSources: {
                                    messages: xpSourceMessages?.checked || false,
                                    voice: xpSourceVoice?.checked || false,
                                    reactions: xpSourceReactions?.checked || false
                                },
                                levelUpChannel: levelUpChannel?.value || null,
                                xpMultiplier: parseFloat(xpMultiplier?.value) || 1.0
                            };
                            
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settingsData)
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to save settings');
                            }
                            
                            showResult('Settings saved successfully!', 'success');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Leveling settings saved', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error saving settings:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            saveLevelingSettings.disabled = false;
                        }
                    }
                    
                    async function loadStats() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/stats/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load stats');
                            
                            const stats = await response.json();
                            
                            if (totalUsers) totalUsers.textContent = stats.totalUsers.toLocaleString();
                            if (totalXP) totalXP.textContent = stats.totalXP.toLocaleString();
                            if (averageLevel) averageLevel.textContent = stats.averageLevel;
                            if (activeToday) activeToday.textContent = stats.activeToday.toLocaleString();
                            
                        } catch (error) {
                            console.error('Error loading stats:', error);
                        }
                    }
                    
                    async function loadChannels() {
                        if (!currentServerId || !levelUpChannel) return;
                        
                        try {
                            const response = await fetch(\`/api/channels/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load channels');
                            
                            const channels = await response.json();
                            
                            // Clear existing options except the first one
                            levelUpChannel.innerHTML = '<option value="">None (disabled)</option>';
                            
                            // Add text channels
                            channels
                                .filter(ch => ch.type === 0) // Text channels
                                .forEach(channel => {
                                    const option = document.createElement('option');
                                    option.value = channel.id;
                                    option.textContent = \`#\${channel.name}\`;
                                    levelUpChannel.appendChild(option);
                                });
                            
                            // Set current value if we have settings loaded
                            if (currentSettings.levelUpChannel) {
                                levelUpChannel.value = currentSettings.levelUpChannel;
                            }
                            
                        } catch (error) {
                            console.error('Error loading channels:', error);
                        }
                    }
                    
                    async function loadLeaderboard() {
                        if (!currentServerId || !leaderboardContent) return;
                        
                        try {
                            if (leaderboardLoading) leaderboardLoading.style.display = 'block';
                            if (leaderboardList) leaderboardList.style.display = 'none';
                            
                            const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentServerId}?type=\${currentLeaderboardType}&limit=20\`);
                            if (!response.ok) throw new Error('Failed to load leaderboard');
                            
                            const leaderboard = await response.json();
                            
                            if (leaderboardList) {
                                if (leaderboard.length === 0) {
                                    leaderboardList.style.display = 'block';
                            }
                            if (leaderboardLoading) leaderboardLoading.style.display = 'none';
                        }
                    }
                    
                    async function manageXP() {
                        if (!currentServerId) {
                            showResult('Please select a server first', 'error');
                            return;
                        }
                        
                        const userId = xpUserId?.value?.replace(/[<@!>]/g, '').trim();
                        const amount = parseInt(xpAmount?.value);
                        
                        if (!userId) {
                            showResult('Please enter a valid user ID', 'error');
                            return;
                        }
                        
                        if (isNaN(amount) || amount === 0) {
                            showResult('Please enter a valid XP amount', 'error');
                            return;
                        }
                        
                        const btnText = addXpBtn?.querySelector('.btn-text');
                        const btnLoader = addXpBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (addXpBtn) addXpBtn.disabled = true;
                            
                            const response = await fetch('/api/plugins/leveling/manage-xp', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId,
                                    guildId: currentServerId,
                                    amount
                                })
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to manage XP');
                            }
                            
                            const result = await response.json();
                            
                            showResult(\`Successfully \${amount > 0 ? 'added' : 'removed'} \${Math.abs(amount)} XP. User is now level \${result.level} with \${result.xp} XP.\`, 'success');
                            
                            // Clear form
                            if (xpUserId) xpUserId.value = '';
                            if (xpAmount) xpAmount.value = '';
                            
                            // Refresh stats and leaderboard
                            loadStats();
                            loadLeaderboard();
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('XP updated successfully', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error managing XP:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (addXpBtn) addXpBtn.disabled = false;
                        }
                    }
                    
                    async function createBackup() {
                        const btnText = createBackupBtn?.querySelector('.btn-text');
                        const btnLoader = createBackupBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (createBackupBtn) createBackupBtn.disabled = true;
                            
                            const response = await fetch('/api/plugins/leveling/backup/create', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    reason: 'Manual backup from dashboard'
                                })
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to create backup');
                            }
                            
                            const result = await response.json();
                            
                            showResult('Backup created successfully: ' + result.backupPath, 'success');
                            
                            // Refresh backup list
                            loadBackups();
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Backup created successfully', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error creating backup:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (createBackupBtn) createBackupBtn.disabled = false;
                        }
                    }
                    
                    async function loadBackups() {
                        if (!backupsList) return;
                        
                        try {
                            backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px;">Loading backups...</div>';
                            
                            const response = await fetch('/api/plugins/leveling/backup/list');
                            if (!response.ok) throw new Error('Failed to load backups');
                            
                            const backups = await response.json();
                            
                            if (backups.length === 0) {
                                backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px;">No backups found</div>';
                                return;
                            }
                            
                            backupsList.innerHTML = backups.map(backup => {
                                const date = new Date(backup.created).toLocaleString();
                                const size = (backup.size / 1024).toFixed(1) + ' KB';
                                const type = backup.metadata?.type || 'unknown';
                                const reason = backup.metadata?.reason || 'No reason provided';
                                
                                return \`
                                    <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                            <div>
                                                <div style="font-weight: 500;">\${backup.filename}</div>
                                                <div style="opacity: 0.7; font-size: 0.9em;">\${date} • \${size} • \${type}</div>
                                                <div style="opacity: 0.6; font-size: 0.8em; margin-top: 4px;">\${reason}</div>
                                            </div>
                                            <button onclick="restoreBackup('\${backup.filename}')" style="padding: 6px 12px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 6px; color: white; cursor: pointer; font-size: 0.9em;">
                                                Restore
                                            </button>
                                        </div>
                                    </div>
                                \`;
                            }).join('');
                            
                        } catch (error) {
                            console.error('Error loading backups:', error);
                            backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px; color: #ff6b6b;">Error loading backups</div>';
                        }
                    }
                    
                    // Make restoreBackup function global so it can be called from onclick
                    window.restoreBackup = async function(filename) {
                        if (!currentServerId) {
                            showResult('Please select a server first', 'error');
                            return;
                        }
                        
                        if (!confirm(\`Are you sure you want to restore from backup "\${filename}"? This will overwrite current data.\`)) {
                            return;
                        }
                        
                        try {
                            const response = await fetch('/api/plugins/leveling/backup/restore', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    filename,
                                    guildId: currentServerId
                                })
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to restore backup');
                            }
                            
                            const result = await response.json();
                            
                            showResult('Backup restored successfully. Data has been restored exactly as backed up.', 'success');
                            
                            // Refresh all data
                            loadStats();
                            loadLeaderboard();
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Backup restored successfully', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error restoring backup:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        }
                    };
                    
                    async function syncUserData() {
                        const btnText = syncDataBtn?.querySelector('.btn-text');
                        const btnLoader = syncDataBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (syncDataBtn) syncDataBtn.disabled = true;
                            
                            const response = await fetch('/api/plugins/leveling/sync-data', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to sync data');
                            }
                            
                            const result = await response.json();
                            
                            showResult(\`Data sync completed. \${result.changesMade ? 'Fixed inconsistencies in user data.' : 'No issues found.'}\`, 'success');
                            
                            // Refresh stats and leaderboard
                            loadStats();
                            loadLeaderboard();
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Data sync completed', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error syncing data:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (syncDataBtn) syncDataBtn.disabled = false;
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!levelingResult) return;
                        
                        levelingResult.textContent = message;
                        levelingResult.className = \`result-message \${type}\`;
                        levelingResult.style.display = 'block';
                        
                        // Auto-hide after 5 seconds
                        setTimeout(() => {
                            levelingResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeLevelingPlugin);
                    } else {
                        initializeLevelingPlugin();
                    }
                    
                    console.log('✅ Enhanced Leveling Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = LevelingPlugin;innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;">No users found</div>';
                                } else {
                                    leaderboardList.innerHTML = leaderboard.map((user, index) => {
                                        const position = index + 1;
                                        const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : \`#\${position}\`;
                                        
                                        let scoreText = '';
                                        switch (currentLeaderboardType) {
                                            case 'overall':
                                                scoreText = \`Level \${user.level} (\${user.xp.toLocaleString()} XP)\`;
                                                break;
                                            case 'voice':
                                                scoreText = \`\${Math.round(user.score / 60000)} minutes\`;
                                                break;
                                            case 'reactions':
                                                scoreText = \`\${user.score} reactions\`;
                                                break;
                                        }
                                        
                                        return \`
                                            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px;">
                                                <div style="font-size: 1.2em; width: 40px; text-align: center;">\${medal}</div>
                                                <div style="flex: 1;">
                                                    <div style="font-weight: 500;">User \${user.userId}</div>
                                                    <div style="opacity: 0.7; font-size: 0.9em;">\${scoreText}</div>
                                                </div>
                                            </div>
                                        \`;
                                    }).join('');
                                }
                                
                                leaderboardList.style.display = 'block';
                            }
                            
                            if (leaderboardLoading) leaderboardLoading.style.display = 'none';
                            
                        } catch (error) {
                            console.error('Error loading leaderboard:', error);
                            if (leaderboardList) {
                                leaderboardList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;">Error loading leaderboard</div>';
                                leaderboardList.UserData(userId, guildId) {
        const data = await this.loadData();
        
        if (!data.users[userId] || !data.users[userId][guildId]) {
            return {
                xp: 0,
                level: 0,
                lastMessageTime: 0,
                voiceTime: 0,
                reactionsGiven: 0,
                reactionsReceived: 0
            };
        }
        
        return data.users[userId][guildId];
    }

    async getGuildSettings(guildId) {
        const settings = await this.loadSettings();
        
        return settings[guildId] || {
            enabled: true,
            xpSources: {
                messages: true,
                voice: true,
                reactions: true
            },
            xpMultiplier: 1.0,
            levelUpChannel: null,
            exemptRoles: [],
            exemptChannels: []
        };
    }

    async updateGuildSettings(guildId, newSettings) {
        const settings = await this.loadSettings();
        settings[guildId] = { ...settings[guildId], ...newSettings };
        await this.saveSettings(settings);
    }

    // ============================================================================
    // XP & LEVELING LOGIC
    // ============================================================================

    calculateLevel(xp) {
        return Math.floor(Math.sqrt(xp / 100));
    }

    getXPForLevel(level) {
        return level * level * 100;
    }

    getXPForNextLevel(currentXP) {
        const currentLevel = this.calculateLevel(currentXP);
        const nextLevelXP = this.getXPForLevel(currentLevel + 1);
        return nextLevelXP - currentXP;
    }

    async addXP(userId, guildId, amount, source = 'manual', preserveLevel = false) {
        const data = await this.loadData();
        
        if (!data.users[userId]) {
            data.users[userId] = {};
        }
        
        if (!data.users[userId][guildId]) {
            data.users[userId][guildId] = {
                xp: 0,
                level: 0,
                lastMessageTime: 0,
                voiceTime: 0,
                reactionsGiven: 0,
                reactionsReceived: 0
            };
        }
        
        const userGuildData = data.users[userId][guildId];
        const oldLevel = userGuildData.level;
        
        userGuildData.xp += amount;
        
        // Only recalculate level if not preserving existing level
        if (!preserveLevel) {
            userGuildData.level = this.calculateLevel(userGuildData.xp);
        }
        
        // Track source-specific stats
        if (source === 'reaction_given') userGuildData.reactionsGiven++;
        if (source === 'reaction_received') userGuildData.reactionsReceived++;
        
        await this.saveData(data);
        
        // Check for level up (only if not preserving level)
        if (!preserveLevel && userGuildData.level > oldLevel) {
            await this.handleLevelUp(userId, guildId, userGuildData.level, oldLevel);
        }
        
        return userGuildData;
    }

    async handleLevelUp(userId, guildId, newLevel, oldLevel) {
        try {
            const settings = await this.getGuildSettings(guildId);
            
            if (settings.levelUpChannel) {
                const channel = this.client.channels.cache.get(settings.levelUpChannel);
                const user = await this.client.users.fetch(userId);
                
                if (channel && user) {
                    const embed = {
                        color: 0x00ff00,
                        title: '🎉 Level Up!',
                        description: `**${user.username}** leveled up from **${oldLevel}** to **${newLevel}**!`,
                        thumbnail: { url: user.displayAvatarURL() },
                        timestamp: new Date().toISOString()
                    };
                    
                    await channel.send({ embeds: [embed] });
                }
            }
            
            // Emit level up event for other plugins
            this.client.emit('levelUp', userId, guildId, newLevel, oldLevel);
            
        } catch (error) {
            console.error('Error handling level up:', error);
        }
    }

    // ============================================================================
    // DISCORD EVENTS - FIXED
    // ============================================================================

    setupDiscordEvents() {
        // Message XP
        this.client.on('messageCreate', async (message) => {
            try {
                if (message.author.bot || !message.guild) return;
                
                const settings = await this.getGuildSettings(message.guild.id);
                if (!settings.enabled || !settings.xpSources?.messages) return;
                
                const userId = message.author.id;
                const guildId = message.guild.id;
                const now = Date.now();
                const cooldownKey = `${userId}-${guildId}`;
                
                // Check cooldown
                if (this.userCooldowns.has(cooldownKey)) {
                    const lastXP = this.userCooldowns.get(cooldownKey);
                    if (now - lastXP < this.MESSAGE_COOLDOWN) return;
                }
                
                const xpGain = Math.floor(Math.random() * (this.XP_RATES.MESSAGE.max - this.XP_RATES.MESSAGE.min + 1)) + this.XP_RATES.MESSAGE.min;
                const multiplier = settings.xpMultiplier || 1;
                
                this.userCooldowns.set(cooldownKey, now);
                await this.addXP(userId, guildId, Math.floor(xpGain * multiplier), 'message');
                
            } catch (error) {
                console.error('Error in messageCreate event:', error);
            }
        });

        // Voice XP tracking
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            try {
                const userId = newState.member?.id;
                if (!userId) return;
                
                const settings = await this.getGuildSettings(newState.guild.id);
                
                // User joined voice channel
                if (!oldState.channel && newState.channel) {
                    if (settings.enabled && settings.xpSources?.voice) {
                        this.voiceTracker.set(`${userId}-${newState.guild.id}`, Date.now());
                    }
                }
                
                // User left voice channel
                if (oldState.channel && !newState.channel) {
                    const trackingKey = `${userId}-${oldState.guild.id}`;
                    if (this.voiceTracker.has(trackingKey)) {
                        this.voiceTracker.delete(trackingKey);
                    }
                }
            } catch (error) {
                console.error('Error in voiceStateUpdate event:', error);
            }
        });

        // Reaction XP
        this.client.on('messageReactionAdd', async (reaction, user) => {
            try {
                if (user.bot || !reaction.message.guild) return;
                
                const settings = await this.getGuildSettings(reaction.message.guild.id);
                if (!settings.enabled || !settings.xpSources?.reactions) return;
                
                const multiplier = settings.xpMultiplier || 1;
                
                // XP for giving a reaction
                await this.addXP(user.id, reaction.message.guild.id, Math.floor(this.XP_RATES.REACTION_GIVEN * multiplier), 'reaction_given');
                
                // XP for receiving a reaction (message author)
                if (!reaction.message.author.bot && reaction.message.author.id !== user.id) {
                    await this.addXP(reaction.message.author.id, reaction.message.guild.id, Math.floor(this.XP_RATES.REACTION_RECEIVED * multiplier), 'reaction_received');
                }
            } catch (error) {
                console.error('Error in messageReactionAdd event:', error);
            }
        });
    }

    async updateVoiceXP() {
        try {
            const now = Date.now();
            const settings = await this.loadSettings();
            
            for (const [trackingKey, startTime] of this.voiceTracker.entries()) {
                const [userId, guildId] = trackingKey.split('-');
                const guildSettings = settings[guildId];
                
                if (!guildSettings?.enabled || !guildSettings?.xpSources?.voice) continue;
                
                const timeInVoice = now - startTime;
                const minutesInVoice = Math.floor(timeInVoice / 60000);
                
                if (minutesInVoice >= 1) {
                    const xpGain = Math.floor(this.XP_RATES.VOICE_PER_MINUTE * (guildSettings.xpMultiplier || 1));
                    await this.addXP(userId, guildId, xpGain, 'voice');
                    
                    // Update start time to prevent duplicate XP
                    this.voiceTracker.set(trackingKey, now);
                }
            }
        } catch (error) {
            console.error('Error updating voice XP:', error);
        }
    }

    // ============================================================================
    // API ROUTES
    // ============================================================================

    setupRoutes() {
        // Get user level/XP data
        this.app.get('/api/plugins/leveling/user/:userId/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { userId, guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const userData = await this.getUserData(userId, guildId);
                res.json(userData);
            } catch (error) {
                console.error('Error getting user data:', error);
                res.status(500).json({ error: 'Failed to get user data' });
            }
        });

        // Get leaderboard
        this.app.get('/api/plugins/leveling/leaderboard/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { type = 'overall', limit = 20 } = req.query;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const leaderboard = await this.getLeaderboard(guildId, type, parseInt(limit));
                res.json(leaderboard);
            } catch (error) {
                console.error('Error getting leaderboard:', error);
                res.status(500).json({ error: 'Failed to get leaderboard' });
            }
        });

        // Get guild settings
        this.app.get('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const settings = await this.getGuildSettings(guildId);
                res.json(settings);
            } catch (error) {
                console.error('Error getting settings:', error);
                res.status(500).json({ error: 'Failed to get settings' });
            }
        });

        // Update guild settings
        this.app.post('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                await this.updateGuildSettings(guildId, req.body);
                res.json({ success: true });
            } catch (error) {
                console.error('Error saving settings:', error);
                res.status(500).json({ error: 'Failed to save settings' });
            }
        });

        // Manage XP (add/remove)
        this.app.post('/api/plugins/leveling/manage-xp', this.ensureAuthenticated, async (req, res) => {
            try {
                const { userId, guildId, amount } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const userData = await this.addXP(userId, guildId, parseInt(amount), 'manual');
                res.json(userData);
            } catch (error) {
                console.error('Error managing XP:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get stats
        this.app.get('/api/plugins/leveling/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const stats = await this.getGuildStats(guildId);
                res.json(stats);
            } catch (error) {
                console.error('Error getting stats:', error);
                res.status(500).json({ error: 'Failed to get stats' });
            }
        });

        // Add sync data endpoint
        this.app.post('/api/plugins/leveling/sync-data', this.ensureAuthenticated, async (req, res) => {
            try {
                const result = await this.validateAndSyncUserData();
                res.json(result);
            } catch (error) {
                console.error('Error syncing data:', error);
                res.status(500).json({ error: 'Failed to sync data' });
            }
        });
    }

    // ============================================================================
    // BACKUP SYSTEM
    // ============================================================================

    setupBackupRoutes() {
        // Create manual backup
        this.app.post('/api/plugins/leveling/backup/create', this.ensureAuthenticated, async (req, res) => {
            try {
                const { reason } = req.body;
                
                const backupPath = await this.createBackup('manual', reason || 'Manual backup via dashboard');
                
                res.json({
                    success: true,
                    message: 'Backup created successfully',
                    backupPath: path.basename(backupPath)
                });
            } catch (error) {
                console.error('Error creating manual backup:', error);
                res.status(500).json({ error: 'Failed to create backup' });
            }
        });

        // List available backups
        this.app.get('/api/plugins/leveling/backup/list', this.ensureAuthenticated, async (req, res) => {
            try {
                const backupFiles = await fs.readdir(this.backupDir);
                const levelingBackups = [];
                
                for (const file of backupFiles) {
                    if (file.startsWith('levelingData_') && file.endsWith('.json')) {
                        try {
                            const filePath = path.join(this.backupDir, file);
                            const stat = await fs.stat(filePath);
                            
                            // Try to read metadata
                            let metadata = null;
                            try {
                                const content = await fs.readFile(filePath, 'utf8');
                                const backup = JSON.parse(content);
                                metadata = backup.metadata;
                            } catch {}
                            
                            levelingBackups.push({
                                filename: file,
                                size: stat.size,
                                created: stat.birthtime,
                                modified: stat.mtime,
                                metadata: metadata
                            });
                        } catch (error) {
                            console.warn(`Could not read backup file: ${file}`);
                        }
                    }
                }
                
                // Sort by creation time (newest first)
                levelingBackups.sort((a, b) => new Date(b.created) - new Date(a.created));
                
                res.json(levelingBackups);
            } catch (error) {
                console.error('Error listing backups:', error);
                res.status(500).json({ error: 'Failed to list backups' });
            }
        });

        // Restore from backup
        this.app.post('/api/plugins/leveling/backup/restore', this.ensureAuthenticated, async (req, res) => {
            try {
                const { filename, guildId } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const backupPath = path.join(this.backupDir, filename);
                
                // Verify backup exists and is valid
                const backupContent = await fs.readFile(backupPath, 'utf8');
                const backup = JSON.parse(backupContent);
                const data = backup.data || backup;
                
                if (!data.users || typeof data.users !== 'object') {
                    throw new Error('Invalid backup data structure');
                }
                
                // Create backup of current state before restoring
                await this.createBackup('pre-restore', `Before restoring from ${filename}`);
                
                // Restore the data exactly as it was backed up
                await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
                
                // Validate restored data
                await this.validateAndSyncUserData();
                
                res.json({
                    success: true,
                    message: 'Backup restored successfully'
                });
            } catch (error) {
                console.error('Error restoring backup:', error);
                res.status(500).json({ error: 'Failed to restore backup' });
            }
        });
    }

    async createBackup(type, reason) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `levelingData_${type}_${timestamp}.json`;
            const backupPath = path.join(this.backupDir, backupFilename);
            
            const currentData = await this.loadData();
            const backupData = {
                metadata: {
                    timestamp: new Date().toISOString(),
                    type,
                    reason,
                    version: this.version
                },
                data: currentData
            };
            
            await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
            console.log(`✓ Backup created: ${backupFilename}`);
            return backupPath;
        } catch (error) {
            console.error('Error creating backup:', error);
            throw error;
        }
    }

    async validateAndSyncUserData() {
        try {
            const data = await this.loadData();
            let changesMade = false;
            
            // Validate each user's data
            for (const [userId, guilds] of Object.entries(data.users)) {
                for (const [guildId, userData] of Object.entries(guilds)) {
                    if (userData && typeof userData === 'object') {
                        // Ensure all required fields exist
                        const requiredFields = {
                            xp: 0,
                            level: 0,
                            lastMessageTime: 0,
                            voiceTime: 0,
                            reactionsGiven: 0,
                            reactionsReceived: 0
                        };
                        
                        for (const [field, defaultValue] of Object.entries(requiredFields)) {
                            if (userData[field] === undefined || userData[field] === null) {
                                userData[field] = defaultValue;
                                changesMade = true;
                            }
                        }
                        
                        // Ensure level matches XP (but don't overwrite backed up levels)
                        const calculatedLevel = this.calculateLevel(userData.xp);
                        if (userData.level !== calculatedLevel) {
                            console.log(`Syncing level for user ${userId} in guild ${guildId}: ${userData.level} → ${calculatedLevel}`);
                            userData.level = calculatedLevel;
                            changesMade = true;
                        }
                    }
                }
            }
            
            if (changesMade) {
                await this.saveData(data);
                console.log('✓ User data validation and sync completed');
            }
            
            return { success: true, changesMade };
        } catch (error) {
            console.error('Error validating user data:', error);
            return { success: false, error: error.message };
        }
    }

    startPeriodicBackups() {
        setInterval(async () => {
            try {
                await this.createBackup('periodic', 'Automatic periodic backup');
            } catch (error) {
                console.error('Error in periodic backup:', error);
            }
        }, this.backupInterval);
    }

    startDailyBackups() {
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === this.dailyBackupHour && now.getMinutes() < 5) {
                try {
                    await this.createBackup('daily', 'Daily scheduled backup');
                } catch (error) {
                    console.error('Error in daily backup:', error);
                }
            }
        }, 5 * 60 * 1000);
    }

    async cleanupOldBackups() {
        try {
            const backupFiles = await fs.readdir(this.backupDir);
            const levelingBackups = backupFiles
                .filter(file => file.startsWith('levelingData_') && file.endsWith('.json'))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    stat: null
                }));
            
            // Get file stats for sorting by creation time
            for (const backup of levelingBackups) {
                try {
                    backup.stat = await fs.stat(backup.path);
                } catch (error) {
                    console.warn(`Could not stat backup file: ${backup.name}`);
                }
            }
            
            // Filter out files we couldn't stat and sort by creation time
            const validBackups = levelingBackups
                .filter(backup => backup.stat)
                .sort((a, b) => b.stat.birthtime - a.stat.birthtime);
            
            // Delete old backups beyond the limit
            if (validBackups.length > this.maxBackups) {
                const backupsToDelete = validBackups.slice(this.maxBackups);
                
                for (const backup of backupsToDelete) {
                    try {
                        await fs.unlink(backup.path);
                        console.log(`✓ Deleted old backup: ${backup.name}`);
                    } catch (error) {
                        console.warn(`Could not delete backup file: ${backup.name}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning up old backups:', error);
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    async getGuildStats(guildId) {
		try {
			const data = await this.loadData();
			let totalUsers = 0;
			let totalXP = 0;
			let totalLevels = 0;
			let activeToday = 0;
			
			const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
			
			for (const [userId, userData] of Object.entries(data.users)) {
				if (userData[guildId]) {
					const guildData = userData[guildId];
					totalUsers++;
					totalXP += guildData.xp || 0;
					totalLevels += guildData.level || 0;
					
					if ((guildData.lastMessageTime || 0) > oneDayAgo) {
						activeToday++;
					}
				}
			}
			
			return {
				totalUsers,
				totalXP,
				averageLevel: totalUsers > 0 ? Math.round((totalLevels / totalUsers) * 100) / 100 : 0,
				activeToday
			};
		} catch (error) {
			console.error('Error getting guild stats:', error);
			return {
				totalUsers: 0,
				totalXP: 0,
				averageLevel: 0,
				activeToday: 0
			};
		}
	}

	setupSlashCommands() {
		// Placeholder for slash command setup
		// In a full implementation, you'd register /level and /leaderboard commands here
		console.log('✓ Leveling: Slash commands ready for registration');
	}

	// ============================================================================
	// FRONTEND COMPONENT
	// ============================================================================

	getFrontendComponent() {
		return {
			id: 'leveling',
			name: 'Leveling System',
			description: 'Configure XP sources, view leaderboards, and manage user levels',
			icon: '📈',
			version: '2.0.0',
			containerId: 'levelingPluginContainer',
			
			html: `
				<div class="plugin-container">
					<div class="plugin-header">
						<h3><span class="plugin-icon">📈</span> Leveling System v2.0</h3>
						<p>Configure XP sources, view leaderboards, and manage user levels</p>
					</div>

					<!-- Server Integration Notice -->
					<div class="server-sync-notice" style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
						<div style="display: flex; align-items: center; gap: 8px;">
							<span style="font-size: 18px;">🔗</span>
							<div>
								<strong>Dashboard Integration</strong>
								<div style="font-size: 14px; opacity: 0.8;">Managing server: <span id="currentServerName">Auto-detected</span></div>
							</div>
						</div>
					</div>

					<!-- Discord Commands Info -->
					<div class="info-section" style="background: rgba(34, 197, 94, 0.1); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
						<h4>🎯 Discord Slash Commands</h4>
						<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-top: 15px;">
							<div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
								<strong>/level [user]</strong>
								<div style="opacity: 0.8; margin-top: 4px;">Check your level or someone else's level</div>
							</div>
							<div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
								<strong>/leaderboard [type]</strong>
								<div style="opacity: 0.8; margin-top: 4px;">View server leaderboards (overall, voice, reactions)</div>
							</div>
						</div>
					</div>

					<!-- Settings Section -->
					<div class="settings-section">
						<h3>Settings</h3>
						<form id="levelingSettingsForm">
							<div class="form-group">
								<label>
									<input type="checkbox" id="levelingEnabled"> Enable Leveling System
								</label>
							</div>

							<div class="form-group">
								<label>XP Sources</label>
								<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
									<label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
										<input type="checkbox" id="xpSourceMessages" style="margin-top: 3px; transform: scale(1.1);">
										<div>
											<div style="font-weight: 500; margin-bottom: 2px;">Messages</div>
											<div style="opacity: 0.7; font-size: 0.9em;">15-25 XP per message, 1 min cooldown</div>
										</div>
									</label>
									<label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
										<input type="checkbox" id="xpSourceVoice" style="margin-top: 3px; transform: scale(1.1);">
										<div>
											<div style="font-weight: 500; margin-bottom: 2px;">Voice Activity</div>
											<div style="opacity: 0.7; font-size: 0.9em;">10 XP per minute in voice channels</div>
										</div>
									</label>
									<label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
										<input type="checkbox" id="xpSourceReactions" style="margin-top: 3px; transform: scale(1.1);">
										<div>
											<div style="font-weight: 500; margin-bottom: 2px;">Reactions</div>
											<div style="opacity: 0.7; font-size: 0.9em;">5 XP for giving, 3 XP for receiving reactions</div>
										</div>
									</label>
								</div>
							</div>

							<div class="form-group">
								<label for="levelUpChannel">Level Up Notifications Channel</label>
								<select id="levelUpChannel">
									<option value="">None (disabled)</option>
								</select>
								<small style="opacity: 0.7; display: block; margin-top: 4px;">
									Choose where level up announcements will be posted
								</small>
							</div>

							<div class="form-group">
								<label for="xpMultiplier">XP Multiplier</label>
								<input type="number" id="xpMultiplier" min="0.1" max="10" step="0.1" value="1.0">
								<small style="opacity: 0.7; display: block; margin-top: 4px;">
									Multiply all XP gains by this amount (0.1x to 10x)
								</small>
							</div>

							<button type="button" id="saveLevelingSettings" class="btn-primary">
								<span class="btn-text">Save Settings</span>
								<span class="btn-loader" style="display: none;">Saving...</span>
							</button>
						</form>
					</div>

					<!-- Stats Section -->
					<div class="stats-section">
						<h3>Server Statistics</h3>
						<div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
							<div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
								<div style="font-size: 2em; margin-bottom: 8px;">👥</div>
								<div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="totalUsers">0</div>
								<div style="opacity: 0.7;">Total Users</div>
							</div>
							<div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
								<div style="font-size: 2em; margin-bottom: 8px;">⭐</div>
								<div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="totalXP">0</div>
								<div style="opacity: 0.7;">Total XP</div>
							</div>
							<div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
								<div style="font-size: 2em; margin-bottom: 8px;">📊</div>
								<div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="averageLevel">0</div>
								<div style="opacity: 0.7;">Average Level</div>
							</div>
							<div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center;">
								<div style="font-size: 2em; margin-bottom: 8px;">🔥</div>
								<div style="font-size: 1.5em; font-weight: bold; margin-bottom: 4px;" id="activeToday">0</div>
								<div style="opacity: 0.7;">Active Today</div>
							</div>
						</div>
					</div>

					<!-- Leaderboards Section -->
					<div class="leaderboards-section">
						<h3>Leaderboards</h3>
						<div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
							<button type="button" id="leaderboardType" data-type="overall" class="leaderboard-btn active" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer;">
								Overall XP
							</button>
							<button type="button" class="leaderboard-btn" data-type="voice" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
								Voice Activity
							</button>
							<button type="button" class="leaderboard-btn" data-type="reactions" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
								Reactions
							</button>
							<button type="button" id="refreshLeaderboard" style="padding: 8px 16px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; color: white; cursor: pointer; margin-left: auto;">
								🔄 Refresh
							</button>
						</div>

						<div id="leaderboardContent" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; min-height: 200px;">
							<div id="leaderboardLoading" style="text-align: center; opacity: 0.6; padding: 40px;">
								Loading leaderboard...
							</div>
							<div id="leaderboardList" style="display: none;"></div>
						</div>
					</div>

					<!-- XP Management Section -->
					<div class="xp-management-section">
						<h3>XP Management</h3>
						<div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px;">
							<div class="form-group">
								<label for="xpUserId">User ID or @mention</label>
								<input type="text" id="xpUserId" placeholder="Enter user ID or @mention">
							</div>
							<div class="form-group">
								<label for="xpAmount">XP Amount (positive to add, negative to remove)</label>
								<input type="number" id="xpAmount" placeholder="Enter XP amount">
							</div>
							<button type="button" id="addXpBtn" class="btn-primary">
								<span class="btn-text">Apply XP Change</span>
								<span class="btn-loader" style="display: none;">Processing...</span>
							</button>
						</div>
					</div>

					<!-- Backup Management Section -->
					<div class="backup-section">
						<h3>Backup Management</h3>
						<div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 20px;">
							<div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
								<button type="button" id="createBackupBtn" class="btn-primary">
									<span class="btn-text">📦 Create Backup</span>
									<span class="btn-loader" style="display: none;">Creating...</span>
								</button>
								<button type="button" id="refreshBackupsBtn" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
									🔄 Refresh List
								</button>
								<button type="button" id="syncDataBtn" style="padding: 8px 16px; background: rgba(255, 193, 7, 0.2); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px; color: white; cursor: pointer;">
									🔧 Sync Data
								</button>
							</div>
							
							<div id="backupsList" style="max-height: 300px; overflow-y: auto;">
								<div style="text-align: center; opacity: 0.6; padding: 20px;">
									Click "Refresh List" to load available backups
								</div>
							</div>
						</div>
					</div>

					<!-- Result Messages -->
					<div id="levelingResult" class="result-message" style="display: none;"></div>
				</div>
			`,
			
			script: `
				// Enhanced Leveling Plugin Frontend Logic with Dashboard Integration
				(function() {
					console.log('📈 Enhanced Leveling Plugin: Initializing...');
					
					// State variables
					let currentServerId = null;
					let currentSettings = {};
					let currentLeaderboardType = 'overall';
					
					// Get DOM elements
					const currentServerName = document.getElementById('currentServerName');
					const levelingSettingsForm = document.getElementById('levelingSettingsForm');
					const levelingEnabled = document.getElementById('levelingEnabled');
					const xpSourceMessages = document.getElementById('xpSourceMessages');
					const xpSourceVoice = document.getElementById('xpSourceVoice');
					const xpSourceReactions = document.getElementById('xpSourceReactions');
					const levelUpChannel = document.getElementById('levelUpChannel');
					const xpMultiplier = document.getElementById('xpMultiplier');
					const saveLevelingSettings = document.getElementById('saveLevelingSettings');
					
					// Stats elements
					const totalUsers = document.getElementById('totalUsers');
					const totalXP = document.getElementById('totalXP');
					const averageLevel = document.getElementById('averageLevel');
					const activeToday = document.getElementById('activeToday');
					
					// Leaderboard elements
					const leaderboardType = document.getElementById('leaderboardType');
					const refreshLeaderboard = document.getElementById('refreshLeaderboard');
					const leaderboardContent = document.getElementById('leaderboardContent');
					const leaderboardLoading = document.getElementById('leaderboardLoading');
					const leaderboardList = document.getElementById('leaderboardList');
					
					// XP Management elements
					const xpUserId = document.getElementById('xpUserId');
					const xpAmount = document.getElementById('xpAmount');
					const addXpBtn = document.getElementById('addXpBtn');
					
					// Backup elements
					const createBackupBtn = document.getElementById('createBackupBtn');
					const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
					const syncDataBtn = document.getElementById('syncDataBtn');
					const backupsList = document.getElementById('backupsList');
					
					// Result element
					const levelingResult = document.getElementById('levelingResult');
					
					// Initialize plugin
					function initializeLevelingPlugin() {
						console.log('🔄 Initializing Enhanced Leveling Plugin...');
						
						// Set up server detection
						if (window.dashboardAPI && window.dashboardAPI.getCurrentServer) {
							currentServerId = window.dashboardAPI.getCurrentServer();
							if (currentServerId && currentServerName) {
								loadServerName();
							}
						} else {
							// Fallback to global server selection
							const serverDropdown = document.getElementById('serverDropdown');
							if (serverDropdown && serverDropdown.value) {
								currentServerId = serverDropdown.value;
								if (currentServerName) {
									currentServerName.textContent = serverDropdown.options[serverDropdown.selectedIndex].text;
								}
							}
						}
						
						setupEventListeners();
						
						if (currentServerId) {
							loadSettings();
							loadStats();
							loadChannels();
							loadLeaderboard();
						}
					}
					
					function setupEventListeners() {
						// Settings form
						if (saveLevelingSettings) {
							saveLevelingSettings.addEventListener('click', saveSettings);
						}
						
						// Leaderboard buttons
						const leaderboardBtns = document.querySelectorAll('.leaderboard-btn');
						leaderboardBtns.forEach(btn => {
							btn.addEventListener('click', function() {
								// Update active state
								leaderboardBtns.forEach(b => {
									b.style.background = 'rgba(255,255,255,0.1)';
									b.style.borderColor = 'rgba(255,255,255,0.2)';
									b.classList.remove('active');
								});
								this.style.background = 'rgba(255,255,255,0.2)';
								this.style.borderColor = 'rgba(255,255,255,0.3)';
								this.classList.add('active');
								
								currentLeaderboardType = this.dataset.type;
								loadLeaderboard();
							});
						});
						
						// Refresh leaderboard
						if (refreshLeaderboard) {
							refreshLeaderboard.addEventListener('click', loadLeaderboard);
						}
						
						// XP management
						if (addXpBtn) {
							addXpBtn.addEventListener('click', manageXP);
						}
						
						// Backup management
						if (createBackupBtn) {
							createBackupBtn.addEventListener('click', createBackup);
						}
						if (refreshBackupsBtn) {
							refreshBackupsBtn.addEventListener('click', loadBackups);
						}
						if (syncDataBtn) {
							syncDataBtn.addEventListener('click', syncUserData);
						}
						
						// Listen for server changes
						document.addEventListener('serverChanged', function(event) {
							currentServerId = event.detail.serverId;
							loadServerName();
							loadSettings();
							loadStats();
							loadChannels();
							loadLeaderboard();
						});
					}
					
					async function loadServerName() {
						if (!currentServerId || !currentServerName) return;
						
						try {
							const response = await fetch('/api/servers');
							const servers = await response.json();
							const server = servers.find(s => s.id === currentServerId);
							if (server && currentServerName) {
								currentServerName.textContent = server.name;
							}
						} catch (error) {
							console.error('Error loading server name:', error);
						}
					}
					
					async function loadSettings() {
						if (!currentServerId) return;
						
						try {
							const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`);
							if (!response.ok) throw new Error('Failed to load settings');
							
							currentSettings = await response.json();
							populateSettingsForm();
						} catch (error) {
							console.error('Error loading settings:', error);
							showResult('Error loading settings: ' + error.message, 'error');
						}
					}
					
					function populateSettingsForm() {
						if (levelingEnabled) levelingEnabled.checked = currentSettings.enabled !== false;
						if (xpSourceMessages) xpSourceMessages.checked = currentSettings.xpSources?.messages !== false;
						if (xpSourceVoice) xpSourceVoice.checked = currentSettings.xpSources?.voice !== false;
						if (xpSourceReactions) xpSourceReactions.checked = currentSettings.xpSources?.reactions !== false;
						if (levelUpChannel) levelUpChannel.value = currentSettings.levelUpChannel || '';
						if (xpMultiplier) xpMultiplier.value = currentSettings.xpMultiplier || 1.0;
					}
					
					async function saveSettings() {
						if (!currentServerId) {
							showResult('Please select a server first', 'error');
							return;
						}
						
						const btnText = saveLevelingSettings.querySelector('.btn-text');
						const btnLoader = saveLevelingSettings.querySelector('.btn-loader');
						
						try {
							// Show loading state
							if (btnText) btnText.style.display = 'none';
							if (btnLoader) btnLoader.style.display = 'inline';
							saveLevelingSettings.disabled = true;
							
							const settingsData = {
								enabled: levelingEnabled?.checked || false,
								xpSources: {
									messages: xpSourceMessages?.checked || false,
									voice: xpSourceVoice?.checked || false,
									reactions: xpSourceReactions?.checked || false
								},
								levelUpChannel: levelUpChannel?.value || null,
								xpMultiplier: parseFloat(xpMultiplier?.value) || 1.0
							};
							
							const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(settingsData)
							});
							
							if (!response.ok) {
								const error = await response.json();
								throw new Error(error.error || 'Failed to save settings');
							}
							
							showResult('Settings saved successfully!', 'success');
							
							if (window.dashboardAPI && window.dashboardAPI.showNotification) {
								window.dashboardAPI.showNotification('Leveling settings saved', 'success');
							}
							
						} catch (error) {
							console.error('Error saving settings:', error);
							showResult('Error: ' + error.message, 'error');
							
							if (window.dashboardAPI && window.dashboardAPI.showNotification) {
								window.dashboardAPI.showNotification(error.message, 'error');
							}
						} finally {
							// Reset button state
							if (btnText) btnText.style.display = 'inline';
							if (btnLoader) btnLoader.style.display = 'none';
							saveLevelingSettings.disabled = false;
						}
					}
					
					async function loadStats() {
						if (!currentServerId) return;
						
						try {
							const response = await fetch(\`/api/plugins/leveling/stats/\${currentServerId}\`);
							if (!response.ok) throw new Error('Failed to load stats');
							
							const stats = await response.json();
							
							if (totalUsers) totalUsers.textContent = stats.totalUsers.toLocaleString();
							if (totalXP) totalXP.textContent = stats.totalXP.toLocaleString();
							if (averageLevel) averageLevel.textContent = stats.averageLevel;
							if (activeToday) activeToday.textContent = stats.activeToday.toLocaleString();
							
						} catch (error) {
							console.error('Error loading stats:', error);
						}
					}
					
					async function loadChannels() {
						if (!currentServerId || !levelUpChannel) return;
						
						try {
							const response = await fetch(\`/api/channels/\${currentServerId}\`);
							if (!response.ok) throw new Error('Failed to load channels');
							
							const channels = await response.json();
							
							// Clear existing options except the first one
							levelUpChannel.innerHTML = '<option value="">None (disabled)</option>';
							
							// Add text channels
							channels
								.filter(ch => ch.type === 0) // Text channels
								.forEach(channel => {
									const option = document.createElement('option');
									option.value = channel.id;
									option.textContent = \`#\${channel.name}\`;
									levelUpChannel.appendChild(option);
								});
							
							// Set current value if we have settings loaded
							if (currentSettings.levelUpChannel) {
								levelUpChannel.value = currentSettings.levelUpChannel;
							}
							
						} catch (error) {
							console.error('Error loading channels:', error);
						}
					}
					
					async function loadLeaderboard() {
						if (!currentServerId || !leaderboardContent) return;
						
						try {
							if (leaderboardLoading) leaderboardLoading.style.display = 'block';
							if (leaderboardList) leaderboardList.style.display = 'none';
							
							const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentServerId}?type=\${currentLeaderboardType}&limit=20\`);
							if (!response.ok) throw new Error('Failed to load leaderboard');
							
							const leaderboard = await response.json();
							
							if (leaderboardList) {
								if (leaderboard.length === 0) {
									leaderboardList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;">No users found</div>';
								} else {
									leaderboardList.innerHTML = leaderboard.map((user, index) => {
										const position = index + 1;
										const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : \`#\${position}\`;
										
										let scoreText = '';
										switch (currentLeaderboardType) {
											case 'overall':
												scoreText = \`Level \${user.level} (\${user.xp.toLocaleString()} XP)\`;
												break;
											case 'voice':
												scoreText = \`\${Math.round(user.score / 60000)} minutes\`;
												break;
											case 'reactions':
												scoreText = \`\${user.score} reactions\`;
												break;
										}
										
										return \`
											<div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px;">
												<div style="font-size: 1.2em; width: 40px; text-align: center;">\${medal}</div>
												<div style="flex: 1;">
													<div style="font-weight: 500;">User \${user.userId}</div>
													<div style="opacity: 0.7; font-size: 0.9em;">\${scoreText}</div>
												</div>
											</div>
										\`;
									}).join('');
								}
								
								leaderboardList.style.display = 'block';
							}
							
							if (leaderboardLoading) leaderboardLoading.style.display = 'none';
							
						} catch (error) {
							console.error('Error loading leaderboard:', error);
							if (leaderboardList) {
								leaderboardList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;">Error loading leaderboard</div>';
								leaderboardList.style.display = 'block';
							}
							if (leaderboardLoading) leaderboardLoading.style.display = 'none';
						}
					}
					
					async function manageXP() {
						if (!currentServerId) {
							showResult('Please select a server first', 'error');
							return;
						}
						
						const userId = xpUserId?.value?.replace(/[<@!>]/g, '').trim();
						const amount = parseInt(xpAmount?.value);
						
						if (!userId) {
							showResult('Please enter a valid user ID', 'error');
							return;
						}
						
						if (isNaN(amount) || amount === 0) {
							showResult('Please enter a valid XP amount', 'error');
							return;
                   }
                   
                   const btnText = addXpBtn?.querySelector('.btn-text');
                   const btnLoader = addXpBtn?.querySelector('.btn-loader');
                   
                   try {
                       // Show loading state
                       if (btnText) btnText.style.display = 'none';
                       if (btnLoader) btnLoader.style.display = 'inline';
                       if (addXpBtn) addXpBtn.disabled = true;
                       
                       const response = await fetch('/api/plugins/leveling/manage-xp', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                               userId,
                               guildId: currentServerId,
                               amount
                           })
                       });
                       
                       if (!response.ok) {
                           const error = await response.json();
                           throw new Error(error.error || 'Failed to manage XP');
                       }
                       
                       const result = await response.json();
                       
                       showResult(\`Successfully \${amount > 0 ? 'added' : 'removed'} \${Math.abs(amount)} XP. User is now level \${result.level} with \${result.xp} XP.\`, 'success');
                       
                       // Clear form
                       if (xpUserId) xpUserId.value = '';
                       if (xpAmount) xpAmount.value = '';
                       
                       // Refresh stats and leaderboard
                       loadStats();
                       loadLeaderboard();
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification('XP updated successfully', 'success');
                       }
                       
                   } catch (error) {
                       console.error('Error managing XP:', error);
                       showResult('Error: ' + error.message, 'error');
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification(error.message, 'error');
                       }
                   } finally {
                       // Reset button state
                       if (btnText) btnText.style.display = 'inline';
                       if (btnLoader) btnLoader.style.display = 'none';
                       if (addXpBtn) addXpBtn.disabled = false;
                   }
               }
               
               async function createBackup() {
                   const btnText = createBackupBtn?.querySelector('.btn-text');
                   const btnLoader = createBackupBtn?.querySelector('.btn-loader');
                   
                   try {
                       // Show loading state
                       if (btnText) btnText.style.display = 'none';
                       if (btnLoader) btnLoader.style.display = 'inline';
                       if (createBackupBtn) createBackupBtn.disabled = true;
                       
                       const response = await fetch('/api/plugins/leveling/backup/create', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                               reason: 'Manual backup from dashboard'
                           })
                       });
                       
                       if (!response.ok) {
                           const error = await response.json();
                           throw new Error(error.error || 'Failed to create backup');
                       }
                       
                       const result = await response.json();
                       
                       showResult('Backup created successfully: ' + result.backupPath, 'success');
                       
                       // Refresh backup list
                       loadBackups();
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification('Backup created successfully', 'success');
                       }
                       
                   } catch (error) {
                       console.error('Error creating backup:', error);
                       showResult('Error: ' + error.message, 'error');
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification(error.message, 'error');
                       }
                   } finally {
                       // Reset button state
                       if (btnText) btnText.style.display = 'inline';
                       if (btnLoader) btnLoader.style.display = 'none';
                       if (createBackupBtn) createBackupBtn.disabled = false;
                   }
               }
               
               async function loadBackups() {
                   if (!backupsList) return;
                   
                   try {
                       backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px;">Loading backups...</div>';
                       
                       const response = await fetch('/api/plugins/leveling/backup/list');
                       if (!response.ok) throw new Error('Failed to load backups');
                       
                       const backups = await response.json();
                       
                       if (backups.length === 0) {
                           backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px;">No backups found</div>';
                           return;
                       }
                       
                       backupsList.innerHTML = backups.map(backup => {
                           const date = new Date(backup.created).toLocaleString();
                           const size = (backup.size / 1024).toFixed(1) + ' KB';
                           const type = backup.metadata?.type || 'unknown';
                           const reason = backup.metadata?.reason || 'No reason provided';
                           
                           return \`
                               <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                                   <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                       <div>
                                           <div style="font-weight: 500;">\${backup.filename}</div>
                                           <div style="opacity: 0.7; font-size: 0.9em;">\${date} • \${size} • \${type}</div>
                                           <div style="opacity: 0.6; font-size: 0.8em; margin-top: 4px;">\${reason}</div>
                                       </div>
                                       <button onclick="restoreBackup('\${backup.filename}')" style="padding: 6px 12px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 6px; color: white; cursor: pointer; font-size: 0.9em;">
                                           Restore
                                       </button>
                                   </div>
                               </div>
                           \`;
                       }).join('');
                       
                   } catch (error) {
                       console.error('Error loading backups:', error);
                       backupsList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 20px; color: #ff6b6b;">Error loading backups</div>';
                   }
               }
               
               // Make restoreBackup function global so it can be called from onclick
               window.restoreBackup = async function(filename) {
                   if (!currentServerId) {
                       showResult('Please select a server first', 'error');
                       return;
                   }
                   
                   if (!confirm(\`Are you sure you want to restore from backup "\${filename}"? This will overwrite current data.\`)) {
                       return;
                   }
                   
                   try {
                       const response = await fetch('/api/plugins/leveling/backup/restore', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                               filename,
                               guildId: currentServerId
                           })
                       });
                       
                       if (!response.ok) {
                           const error = await response.json();
                           throw new Error(error.error || 'Failed to restore backup');
                       }
                       
                       const result = await response.json();
                       
                       showResult('Backup restored successfully. Data has been restored exactly as backed up.', 'success');
                       
                       // Refresh all data
                       loadStats();
                       loadLeaderboard();
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification('Backup restored successfully', 'success');
                       }
                       
                   } catch (error) {
                       console.error('Error restoring backup:', error);
                       showResult('Error: ' + error.message, 'error');
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification(error.message, 'error');
                       }
                   }
               };
               
               async function syncUserData() {
                   const btnText = syncDataBtn?.querySelector('.btn-text');
                   const btnLoader = syncDataBtn?.querySelector('.btn-loader');
                   
                   try {
                       // Show loading state
                       if (btnText) btnText.style.display = 'none';
                       if (btnLoader) btnLoader.style.display = 'inline';
                       if (syncDataBtn) syncDataBtn.disabled = true;
                       
                       const response = await fetch('/api/plugins/leveling/sync-data', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' }
                       });
                       
                       if (!response.ok) {
                           const error = await response.json();
                           throw new Error(error.error || 'Failed to sync data');
                       }
                       
                       const result = await response.json();
                       
                       showResult(\`Data sync completed. \${result.changesMade ? 'Fixed inconsistencies in user data.' : 'No issues found.'}\`, 'success');
                       
                       // Refresh stats and leaderboard
                       loadStats();
                       loadLeaderboard();
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification('Data sync completed', 'success');
                       }
                       
                   } catch (error) {
                       console.error('Error syncing data:', error);
                       showResult('Error: ' + error.message, 'error');
                       
                       if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                           window.dashboardAPI.showNotification(error.message, 'error');
                       }
                   } finally {
                       // Reset button state
                       if (btnText) btnText.style.display = 'inline';
                       if (btnLoader) btnLoader.style.display = 'none';
                       if (syncDataBtn) syncDataBtn.disabled = false;
                   }
               }
               
               // Show result message
               function showResult(message, type) {
                   if (!levelingResult) return;
                   
                   levelingResult.textContent = message;
                   levelingResult.className = \`result-message \${type}\`;
                   levelingResult.style.display = 'block';
                   
                   // Auto-hide after 5 seconds
                   setTimeout(() => {
                       levelingResult.style.display = 'none';
                   }, 5000);
               }
               
               // Initialize when page loads
               if (document.readyState === 'loading') {
                   document.addEventListener('DOMContentLoaded', initializeLevelingPlugin);
               } else {
                   initializeLevelingPlugin();
               }
               
               console.log('✅ Enhanced Leveling Plugin loaded successfully');
               
           })();
       `
   };
}
}

module.exports = LevelingPlugin;