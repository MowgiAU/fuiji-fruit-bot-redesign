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
        
        // Ensure directories exist
        this.ensureDirectories();
        
        // Setup routes and Discord events
        this.setupRoutes();
        this.setupDiscordEvents();
        
        console.log('✅ Leveling Plugin v2.0 loaded with dashboard integration');
    }

    async ensureDirectories() {
        try {
            await fs.mkdir('./data', { recursive: true });
            await fs.mkdir(this.backupDir, { recursive: true });
        } catch (error) {
            console.error('Error creating directories:', error);
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

        // Get settings
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

        // Update settings
        this.app.post('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                await this.updateGuildSettings(guildId, req.body);
                res.json({ success: true });
            } catch (error) {
                console.error('Error updating settings:', error);
                res.status(500).json({ error: 'Failed to update settings' });
            }
        });

        // Admin: Add/Remove XP
        this.app.post('/api/plugins/leveling/admin/xp', this.ensureAuthenticated, async (req, res) => {
            try {
                const { userId, guildId, amount } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const userData = await this.addXP(userId, guildId, amount, 'admin');
                res.json({ success: true, userData });
            } catch (error) {
                console.error('Error managing XP:', error);
                res.status(500).json({ error: 'Failed to manage XP' });
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

        // Backup routes
        this.app.post('/api/plugins/leveling/backup/create', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, reason } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const backupPath = await this.createBackup('manual', reason || 'Manual backup');
                res.json({ success: true, backupPath });
            } catch (error) {
                console.error('Error creating backup:', error);
                res.status(500).json({ error: 'Failed to create backup' });
            }
        });
    }

    // ============================================================================
    // DISCORD EVENTS
    // ============================================================================

    setupDiscordEvents() {
        // Message XP
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            
            const settings = await this.getGuildSettings(message.guild.id);
            if (!settings.enabled || !settings.xpSources.messages) return;
            
            // Check cooldown
            const userData = await this.getUserData(message.author.id, message.guild.id);
            const now = Date.now();
            if (now - userData.lastMessageTime < 60000) return; // 1 minute cooldown
            
            // Award XP
            const xpAmount = Math.floor(Math.random() * 11) + 15; // 15-25 XP
            await this.addXP(message.author.id, message.guild.id, xpAmount, 'message');
            await this.updateLastMessageTime(message.author.id, message.guild.id, now);
        });

        // Reaction XP
        this.client.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot) return;
            
            const message = reaction.message;
            if (!message.guild) return;
            
            const settings = await this.getGuildSettings(message.guild.id);
            if (!settings.enabled || !settings.xpSources.reactions) return;
            
            // Award XP to reaction giver
            await this.addXP(user.id, message.guild.id, 2, 'reaction_given');
            
            // Award XP to message author (if different)
            if (message.author.id !== user.id && !message.author.bot) {
                await this.addXP(message.author.id, message.guild.id, 1, 'reaction_received');
            }
        });

        // Voice XP (simplified - you may want to implement more sophisticated tracking)
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            const settings = await this.getGuildSettings(newState.guild.id);
            if (!settings.enabled || !settings.xpSources.voice) return;
            
            // Award voice XP when joining a voice channel
            if (!oldState.channel && newState.channel && !newState.member.user.bot) {
                await this.addXP(newState.member.id, newState.guild.id, 10, 'voice');
            }
        });
    }

    // ============================================================================
    // DATA MANAGEMENT
    // ============================================================================

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Return default structure if file doesn't exist
            return { users: {} };
        }
    }

    async saveData(data) {
        await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
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

    async getUserData(userId, guildId) {
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

    async updateLastMessageTime(userId, guildId, timestamp) {
        const data = await this.loadData();
        
        if (!data.users[userId]) data.users[userId] = {};
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
        
        data.users[userId][guildId].lastMessageTime = timestamp;
        await this.saveData(data);
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

    async addXP(userId, guildId, amount, source = 'manual') {
        const data = await this.loadData();
        
        if (!data.users[userId]) data.users[userId] = {};
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
        userGuildData.level = this.calculateLevel(userGuildData.xp);
        
        // Track source-specific stats
        if (source === 'reaction_given') userGuildData.reactionsGiven++;
        if (source === 'reaction_received') userGuildData.reactionsReceived++;
        
        await this.saveData(data);
        
        // Check for level up
        if (userGuildData.level > oldLevel) {
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
                        description: `${user} has reached **Level ${newLevel}**!`,
                        thumbnail: { url: user.displayAvatarURL() },
                        timestamp: new Date().toISOString()
                    };
                    
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (error) {
            console.error('Error handling level up:', error);
        }
    }

    // ============================================================================
    // LEADERBOARDS & STATS
    // ============================================================================

    async getLeaderboard(guildId, type = 'overall', limit = 20) {
        const data = await this.loadData();
        const users = [];
        
        for (const [userId, guilds] of Object.entries(data.users)) {
            if (guilds[guildId]) {
                const userData = guilds[guildId];
                let sortValue;
                
                switch (type) {
                    case 'voice':
                        sortValue = userData.voiceTime || 0;
                        break;
                    case 'reactions':
                        sortValue = (userData.reactionsGiven || 0) + (userData.reactionsReceived || 0);
                        break;
                    default: // overall
                        sortValue = userData.xp || 0;
                }
                
                users.push({
                    userId,
                    username: null, // Will be populated by frontend
                    avatar: null,   // Will be populated by frontend
                    xp: userData.xp || 0,
                    level: userData.level || 0,
                    voiceTime: userData.voiceTime || 0,
                    reactionsGiven: userData.reactionsGiven || 0,
                    reactionsReceived: userData.reactionsReceived || 0,
                    sortValue
                });
            }
        }
        
        // Sort and limit
        users.sort((a, b) => b.sortValue - a.sortValue);
        return users.slice(0, limit);
    }

    async getGuildStats(guildId) {
        const data = await this.loadData();
        let totalUsers = 0;
        let totalXP = 0;
        let averageLevel = 0;
        let activeToday = 0;
        
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        for (const [userId, guilds] of Object.entries(data.users)) {
            if (guilds[guildId]) {
                const userData = guilds[guildId];
                totalUsers++;
                totalXP += userData.xp || 0;
                averageLevel += userData.level || 0;
                
                if ((userData.lastMessageTime || 0) > oneDayAgo) {
                    activeToday++;
                }
            }
        }
        
        if (totalUsers > 0) {
            averageLevel = averageLevel / totalUsers;
        }
        
        return {
            totalUsers,
            totalXP,
            averageLevel: Math.round(averageLevel * 10) / 10,
            activeToday
        };
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

                    <!-- Stats Overview -->
                    <div class="stats-section" style="margin-bottom: 24px;">
                        <h4>Server Statistics</h4>
                        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div class="stat-card">
                                <div class="stat-value" id="totalUsers">0</div>
                                <div class="stat-label">Total Users</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="totalXP">0</div>
                                <div class="stat-label">Total XP</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="averageLevel">0</div>
                                <div class="stat-label">Average Level</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="activeToday">0</div>
                                <div class="stat-label">Active Today</div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Form -->
                    <form id="levelingSettingsForm" class="settings-form">
                        <div class="settings-section">
                            <h4>XP Settings</h4>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="levelingEnabled" checked>
                                    Enable Leveling System
                                </label>
                            </div>

                            <div class="form-group">
                                <label>XP Sources</label>
                                <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceMessages" checked style="margin-top: 3px;">
                                        <div>
                                            <div style="font-weight: 500;">Messages</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">15-25 XP per message, 1 min cooldown</div>
                                        </div>
                                    </label>
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceVoice" checked style="margin-top: 3px;">
                                        <div>
                                            <div style="font-weight: 500;">Voice Activity</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">10 XP for joining voice channels</div>
                                        </div>
                                    </label>
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceReactions" checked style="margin-top: 3px;">
                                        <div>
                                            <div style="font-weight: 500;">Reactions</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">2 XP for giving, 1 XP for receiving</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="levelUpChannel">Level Up Announcements Channel</label>
                                <select id="levelUpChannel" class="form-control">
                                    <option value="">No announcements</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="xpMultiplier">XP Multiplier</label>
                                <input type="number" id="xpMultiplier" class="form-control" min="0.1" max="10" step="0.1" value="1.0">
                                <small class="form-text">Multiply all XP gains by this amount</small>
                            </div>
                        </div>

                        <button type="submit" id="saveLevelingSettings" class="btn btn-primary">
                            <span class="btn-text">💾 Save Settings</span>
                            <span class="btn-loader" style="display: none;">⏳ Saving...</span>
                        </button>
                    </form>

                    <!-- Leaderboard Section -->
                    <div class="leaderboard-section" style="margin-top: 32px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4>🏆 Leaderboard</h4>
                            <div style="display: flex; gap: 8px;">
                                <select id="leaderboardType" class="form-control" style="width: auto;">
                                    <option value="overall">Overall XP</option>
                                    <option value="voice">Voice Time</option>
                                    <option value="reactions">Reactions</option>
                                </select>
                                <button type="button" id="refreshLeaderboard" class="btn btn-secondary btn-sm">🔄 Refresh</button>
                            </div>
                        </div>
                        
                        <div id="leaderboardContent">
                            <div id="leaderboardLoading" style="text-align: center; padding: 20px; opacity: 0.7;">
                                Loading leaderboard...
                            </div>
                            <div id="leaderboardList"></div>
                        </div>
                    </div>

                    <!-- Admin Tools -->
                    <div class="admin-section" style="margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <h4>⚙️ Admin Tools</h4>
                        
                        <div class="admin-tools-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                            <div class="admin-tool">
                                <h5>Manage User XP</h5>
                                <div class="form-group">
                                    <label for="adminUserId">User ID</label>
                                    <input type="text" id="adminUserId" class="form-control" placeholder="Enter user ID">
                                </div>
                                <div class="form-group">
                                    <label for="adminXpAmount">XP Amount (+ or -)</label>
                                    <input type="number" id="adminXpAmount" class="form-control" placeholder="e.g. 100 or -50">
                                </div>
                                <button type="button" id="adjustXpBtn" class="btn btn-primary btn-sm">
                                    <span class="btn-text">✏️ Adjust XP</span>
                                    <span class="btn-loader" style="display: none;">⏳</span>
                                </button>
                            </div>
                            
                            <div class="admin-tool">
                                <h5>Backup Management</h5>
                                <p style="opacity: 0.8; font-size: 0.9em;">Create backups of leveling data for safety.</p>
                                <button type="button" id="createBackupBtn" class="btn btn-secondary btn-sm">
                                    <span class="btn-text">💾 Create Backup</span>
                                    <span class="btn-loader" style="display: none;">⏳</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Command Reference -->
                    <div class="commands-section" style="margin-top: 32px; padding: 20px; background: rgba(79, 70, 229, 0.1); border-radius: 10px;">
                        <h4>🎮 Discord Commands</h4>
                        <p style="opacity: 0.8; margin-bottom: 16px;">Use these slash commands in your Discord server:</p>
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            <div>
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px;">/level [user]</code>
                                <span style="color: rgba(255, 255, 255, 0.8); margin-left: 10px;">Check your or someone else's level and XP</span>
                            </div>
                            <div>
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px;">/leaderboard [type] [limit]</code>
                                <span style="color: rgba(255, 255, 255, 0.8); margin-left: 10px;">View server leaderboards (overall, voice, reactions)</span>
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
                    
                    // Admin elements
                    const adminUserId = document.getElementById('adminUserId');
                    const adminXpAmount = document.getElementById('adminXpAmount');
                    const adjustXpBtn = document.getElementById('adjustXpBtn');
                    const createBackupBtn = document.getElementById('createBackupBtn');
                    
                    // Result message
                    const levelingResult = document.getElementById('levelingResult');
                    
                    // State variables
                    let currentServerId = null;
                    let currentSettings = {};
                    let channels = [];
                    
                    // Initialize plugin
                    function initializeLevelingPlugin() {
                        console.log('📈 Initializing Leveling Plugin...');
                        setupEventListeners();
                        
                        // Check for dashboard integration
                        if (window.dashboardAPI && window.dashboardAPI.getCurrentServer) {
                            currentServerId = window.dashboardAPI.getCurrentServer();
                            console.log('📈 Dashboard integration found, server:', currentServerId);
                            
                            if (currentServerId) {
                                loadServerData();
                            }
                        }
                        
                        // Listen for server changes
                        if (window.dashboardAPI) {
                            const originalHandleServerChange = window.dashboardAPI.handleServerChange;
                            
                            window.dashboardAPI.handleServerChange = function(serverId) {
                                if (originalHandleServerChange) {
                                    originalHandleServerChange.call(this, serverId);
                                }
                                
                                currentServerId = serverId;
                                console.log('📈 Leveling plugin: Server changed to', serverId);
                                
                                if (serverId) {
                                    loadServerData();
                                }
                            };
                        }
                    }
                    
                    // Setup event listeners
                    function setupEventListeners() {
                        // Settings form
                        if (levelingSettingsForm) {
                            levelingSettingsForm.addEventListener('submit', handleSettingsSave);
                        }
                        
                        // Leaderboard controls
                        if (leaderboardType) {
                            leaderboardType.addEventListener('change', loadLeaderboard);
                        }
                        
                        if (refreshLeaderboard) {
                            refreshLeaderboard.addEventListener('click', loadLeaderboard);
                        }
                        
                        // Admin tools
                        if (adjustXpBtn) {
                            adjustXpBtn.addEventListener('click', handleAdjustXP);
                        }
                        
                        if (createBackupBtn) {
                            createBackupBtn.addEventListener('click', handleCreateBackup);
                        }
                    }
                    
                    // Load all server data
                    async function loadServerData() {
                        if (!currentServerId) return;
                        
                        try {
                            updateServerDisplay();
                            await Promise.all([
                                loadChannels(),
                                loadSettings(),
                                loadStats(),
                                loadLeaderboard()
                            ]);
                        } catch (error) {
                            console.error('Error loading server data:', error);
                            showResult('Error loading server data: ' + error.message, 'error');
                        }
                    }
                    
                    // Update server display
                    function updateServerDisplay() {
                        if (currentServerName && window.dashboardAPI && window.dashboardAPI.getServerName) {
                            const serverName = window.dashboardAPI.getServerName(currentServerId);
                            currentServerName.textContent = serverName || 'Unknown Server';
                        }
                    }
                    
                    // Load channels for server
                    async function loadChannels() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/channels/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load channels');
                            
                            channels = await response.json();
                            populateChannelSelect();
                        } catch (error) {
                            console.error('Error loading channels:', error);
                        }
                    }
                    
                    // Populate channel select
                    function populateChannelSelect() {
                        if (!levelUpChannel) return;
                        
                        levelUpChannel.innerHTML = '<option value="">No announcements</option>';
                        
                        const textChannels = channels.filter(channel => channel.type === 0);
                        textChannels.forEach(channel => {
                            const option = document.createElement('option');
                            option.value = channel.id;
                            option.textContent = '#' + channel.name;
                            levelUpChannel.appendChild(option);
                        });
                    }
                    
                    // Load settings
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
                    
                    // Populate settings form
                    function populateSettingsForm() {
                        if (levelingEnabled) levelingEnabled.checked = currentSettings.enabled !== false;
                        if (xpSourceMessages) xpSourceMessages.checked = currentSettings.xpSources?.messages !== false;
                        if (xpSourceVoice) xpSourceVoice.checked = currentSettings.xpSources?.voice !== false;
                        if (xpSourceReactions) xpSourceReactions.checked = currentSettings.xpSources?.reactions !== false;
                        if (levelUpChannel) levelUpChannel.value = currentSettings.levelUpChannel || '';
                        if (xpMultiplier) xpMultiplier.value = currentSettings.xpMultiplier || 1.0;
                    }
                    
                    // Load stats
                    async function loadStats() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/stats/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load stats');
                            
                            const stats = await response.json();
                            displayStats(stats);
                        } catch (error) {
                            console.error('Error loading stats:', error);
                        }
                    }
                    
                    // Display stats
                    function displayStats(stats) {
                        if (totalUsers) totalUsers.textContent = stats.totalUsers?.toLocaleString() || '0';
                        if (totalXP) totalXP.textContent = stats.totalXP?.toLocaleString() || '0';
                        if (averageLevel) averageLevel.textContent = stats.averageLevel?.toString() || '0';
                        if (activeToday) activeToday.textContent = stats.activeToday?.toLocaleString() || '0';
                    }
                    
                    // Load leaderboard
                    async function loadLeaderboard() {
                        if (!currentServerId || !leaderboardType) return;
                        
                        try {
                            showLeaderboardLoading(true);
                            
                            const type = leaderboardType.value || 'overall';
                            const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentServerId}?type=\${type}&limit=20\`);
                            
                            if (!response.ok) throw new Error('Failed to load leaderboard');
                            
                            const leaderboard = await response.json();
                            await displayLeaderboard(leaderboard);
                        } catch (error) {
                            console.error('Error loading leaderboard:', error);
                            showEmptyLeaderboard('Error loading leaderboard');
                        } finally {
                            showLeaderboardLoading(false);
                        }
                    }
                    
                    // Show/hide leaderboard loading
                    function showLeaderboardLoading(show) {
                        if (leaderboardLoading) {
                            leaderboardLoading.style.display = show ? 'block' : 'none';
                        }
                        if (leaderboardList) {
                            leaderboardList.style.display = show ? 'none' : 'block';
                        }
                    }
                    
                    // Display leaderboard
                    async function displayLeaderboard(leaderboard) {
                        if (!leaderboardList || !leaderboard || leaderboard.length === 0) {
                            showEmptyLeaderboard('No users found in leaderboard');
                            return;
                        }
                        
                        leaderboardList.innerHTML = '';
                        
                        // Get user info for each entry
                        for (let i = 0; i < leaderboard.length; i++) {
                            const entry = leaderboard[i];
                            
                            // Try to get user info from Discord API
                            let userInfo = { username: 'Unknown User', avatar: null };
                            try {
                                if (window.dashboardAPI && window.dashboardAPI.getUserInfo) {
                                    userInfo = await window.dashboardAPI.getUserInfo(entry.userId);
                                }
                            } catch (error) {
                                console.warn('Could not fetch user info for', entry.userId);
                            }
                            
                            const rank = i + 1;
                            const level = entry.level || 0;
                            const xp = entry.xp || 0;
                            const nextLevelXP = Math.pow(level + 1, 2) * 100;
                            const currentLevelXP = Math.pow(level, 2) * 100;
                            const progress = ((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;
                            
                            const memberElement = document.createElement('div');
                            memberElement.className = 'leaderboard-item';
                            memberElement.style.cssText = \`
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                padding: 16px;
                                background: rgba(255, 255, 255, 0.05);
                                border-radius: 8px;
                                margin-bottom: 8px;
                                transition: all 0.2s ease;
                            \`;
                            
                            memberElement.innerHTML = \`
                                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                                    <div style="background: rgba(79, 70, 229, 0.2); color: #818CF8; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">
                                        #\${rank}
                                    </div>
                                    <div style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;">
                                        \${userInfo.avatar ? \`<img src="\${userInfo.avatar}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover;">\` : '👤'}
                                    </div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 500; margin-bottom: 2px;">\${userInfo.username}</div>
                                        <div style="opacity: 0.7; font-size: 0.9em;">Level \${level} • \${xp.toLocaleString()} XP</div>
                                    </div>
                                </div>
                                <div style="text-align: right; min-width: 100px;">
                                    <div style="font-size: 0.9em; opacity: 0.7; margin-bottom: 4px;">Progress</div>
                                    <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; width: 80px; overflow: hidden;">
                                        <div style="background: linear-gradient(90deg, #10B981, #34D399); height: 100%; width: \${Math.min(progress, 100)}%; transition: width 0.3s ease;"></div>
                                    </div>
                                </div>
                            \`;
                            
                            leaderboardList.appendChild(memberElement);
                        }
                    }
                    
                    // Show empty leaderboard
                    function showEmptyLeaderboard(message) {
                        if (!leaderboardList) return;
                        
                        leaderboardList.innerHTML = \`
                            <div style="text-align: center; opacity: 0.7; padding: 40px;">
                                <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
                                <div>\${message}</div>
                            </div>
                        \`;
                    }
                    
                    // Handle settings save
                    async function handleSettingsSave(e) {
                        e.preventDefault();
                        
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
                        const btnText = saveLevelingSettings?.querySelector('.btn-text');
                        const btnLoader = saveLevelingSettings?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (saveLevelingSettings) saveLevelingSettings.disabled = true;
                            
                            const settings = {
                                enabled: levelingEnabled?.checked !== false,
                                xpSources: {
                                    messages: xpSourceMessages?.checked !== false,
                                    voice: xpSourceVoice?.checked !== false,
                                    reactions: xpSourceReactions?.checked !== false
                                },
                                levelUpChannel: levelUpChannel?.value || null,
                                xpMultiplier: parseFloat(xpMultiplier?.value || 1.0)
                            };
                            
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settings)
                            });
                            
                            if (!response.ok) throw new Error('Failed to save settings');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult('Leveling settings saved successfully!', 'success');
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification('Leveling settings saved', 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', 'Leveling settings updated');
                                    }
                                }
                                
                                currentSettings = { ...currentSettings, ...settings };
                            } else {
                                throw new Error(result.error || 'Failed to save settings');
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
                            if (saveLevelingSettings) saveLevelingSettings.disabled = false;
                        }
                    }
                    
                    // Handle XP adjustment
                    async function handleAdjustXP() {
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
                        const userId = adminUserId?.value?.trim();
                        const amount = parseInt(adminXpAmount?.value);
                        
                        if (!userId || isNaN(amount)) {
                            showResult('Please enter valid User ID and XP amount', 'error');
                            return;
                        }
                        
                        const btnText = adjustXpBtn?.querySelector('.btn-text');
                        const btnLoader = adjustXpBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (adjustXpBtn) adjustXpBtn.disabled = true;
                            
                            const response = await fetch('/api/plugins/leveling/admin/xp', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId,
                                    guildId: currentServerId,
                                    amount
                                })
                            });
                            
                            if (!response.ok) throw new Error('Failed to adjust XP');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult(\`Successfully \${amount > 0 ? 'added' : 'removed'} \${Math.abs(amount)} XP \${amount > 0 ? 'to' : 'from'} user\`, 'success');
                                
                                // Clear form
                                if (adminUserId) adminUserId.value = '';
                                if (adminXpAmount) adminXpAmount.value = '';
                                
                                // Refresh leaderboard and stats
                                await Promise.all([loadStats(), loadLeaderboard()]);
                                
                                if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                    window.dashboardAPI.showNotification('XP adjusted successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to adjust XP');
                            }
                            
                        } catch (error) {
                            console.error('Error adjusting XP:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (adjustXpBtn) adjustXpBtn.disabled = false;
                        }
                    }
                    
                    // Handle backup creation
                    async function handleCreateBackup() {
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
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
                                    guildId: currentServerId,
                                    reason: 'Manual backup from dashboard'
                                })
                            });
                            
                            if (!response.ok) throw new Error('Failed to create backup');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult('Backup created successfully!', 'success');
                                
                                if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                    window.dashboardAPI.showNotification('Backup created successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to create backup');
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