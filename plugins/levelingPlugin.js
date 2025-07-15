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
        
        this.dataPath = path.join(__dirname, '../data/levelingData.json');
        this.settingsPath = path.join(__dirname, '../data/levelingSettings.json');
        
        // Cooldowns to prevent XP spam
        this.messageCooldowns = new Map();
        this.voiceTracker = new Map();
        
        this.initializeData();
        this.setupRoutes();
        this.setupEventListeners();
        this.registerSlashCommands();
    }

    async initializeData() {
        try {
            // Initialize leveling data file
            try {
                await fs.access(this.dataPath);
            } catch {
                await fs.writeFile(this.dataPath, JSON.stringify({ users: {} }, null, 2));
            }

            // Initialize settings file
            try {
                await fs.access(this.settingsPath);
            } catch {
                await fs.writeFile(this.settingsPath, JSON.stringify({}, null, 2));
            }

            console.log('✅ Leveling system data initialized');
        } catch (error) {
            console.error('Error initializing leveling data:', error);
        }
    }

    setupRoutes() {
        // Get leveling statistics for dashboard
        this.app.get('/api/plugins/leveling/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                const settings = await this.loadSettings();
                
                // Calculate server statistics
                const serverUsers = Object.keys(data.users).filter(userId => 
                    data.users[userId][guildId]
                ).length;

                const totalXP = Object.keys(data.users).reduce((total, userId) => {
                    const userGuildData = data.users[userId][guildId];
                    return total + (userGuildData?.xp || 0);
                }, 0);

                const averageLevel = serverUsers > 0 ? Math.floor(
                    Object.keys(data.users).reduce((total, userId) => {
                        const userGuildData = data.users[userId][guildId];
                        return total + (userGuildData?.level || 0);
                    }, 0) / serverUsers
                ) : 0;

                const guildSettings = settings[guildId] || {};
                const isEnabled = this.isLevelingEnabled(guildId, settings);

                res.json({
                    activeUsers: serverUsers,
                    totalXp: totalXP,
                    averageLevel: averageLevel,
                    enabled: isEnabled,
                    xpSources: guildSettings.xpSources || {},
                    settings: guildSettings
                });
            } catch (error) {
                console.error('Error getting leveling stats:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get leaderboard
        this.app.get('/api/plugins/leveling/leaderboard/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { type = 'overall', limit = 50 } = req.query;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                const guild = await this.client.guilds.fetch(guildId);
                
                // Get all users for this guild
                const guildUsers = [];
                for (const userId in data.users) {
                    const userGuildData = data.users[userId][guildId];
                    if (userGuildData) {
                        try {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (member) {
                                guildUsers.push({
                                    userId,
                                    username: member.user.username,
                                    displayName: member.displayName,
                                    avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
                                    ...userGuildData
                                });
                            }
                        } catch (error) {
                            // User not in guild anymore
                        }
                    }
                }

                // Sort based on type
                let sortedUsers = [];
                switch (type) {
                    case 'voice':
                        sortedUsers = guildUsers.sort((a, b) => (b.voiceTime || 0) - (a.voiceTime || 0));
                        break;
                    case 'reactions':
                        sortedUsers = guildUsers.sort((a, b) => (b.reactionsGiven || 0) - (a.reactionsGiven || 0));
                        break;
                    default: // overall
                        sortedUsers = guildUsers.sort((a, b) => b.xp - a.xp);
                }

                res.json(sortedUsers.slice(0, parseInt(limit)));
            } catch (error) {
                console.error('Error getting leaderboard:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get settings
        this.app.get('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const settings = await this.loadSettings();
                const guildSettings = settings[guildId] || {
                    enabled: true,
                    xpSources: {
                        messages: true,
                        voice: false,
                        reactions: false
                    },
                    xpMultiplier: 1,
                    levelUpChannel: null,
                    levelUpMessage: '🎉 {user} reached level {level}!',
                    excludedChannels: [],
                    excludedRoles: []
                };

                res.json(guildSettings);
            } catch (error) {
                console.error('Error getting settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Save settings
        this.app.post('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const settings = await this.loadSettings();
                settings[guildId] = {
                    ...settings[guildId],
                    ...req.body,
                    updatedAt: new Date().toISOString()
                };

                await this.saveSettings(settings);
                res.json({ success: true });
            } catch (error) {
                console.error('Error saving settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Admin XP management
        this.app.post('/api/plugins/leveling/admin/:action', this.ensureAuthenticated, async (req, res) => {
            try {
                const { action } = req.params;
                const { userId, guildId, amount } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                
                if (!data.users[userId]) data.users[userId] = {};
                if (!data.users[userId][guildId]) {
                    data.users[userId][guildId] = {
                        xp: 0, level: 0, voiceTime: 0,
                        reactionsGiven: 0, reactionsReceived: 0
                    };
                }

                const userData = data.users[userId][guildId];
                
                switch (action) {
                    case 'add':
                        userData.xp += amount;
                        break;
                    case 'remove':
                        userData.xp = Math.max(0, userData.xp - amount);
                        break;
                    case 'set':
                        userData.xp = Math.max(0, amount);
                        break;
                    default:
                        return res.status(400).json({ error: 'Invalid action' });
                }

                userData.level = this.calculateLevel(userData.xp);
                await this.saveData(data);
                
                res.json({ success: true, newXP: userData.xp, newLevel: userData.level });
            } catch (error) {
                console.error('Error managing XP:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Export data
        this.app.get('/api/plugins/leveling/export/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                const settings = await this.loadSettings();
                
                const exportData = {
                    guildId,
                    exportedAt: new Date().toISOString(),
                    settings: settings[guildId] || {},
                    users: {}
                };

                // Extract only this guild's user data
                for (const userId in data.users) {
                    if (data.users[userId][guildId]) {
                        exportData.users[userId] = data.users[userId][guildId];
                    }
                }

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename=leveling-data-${guildId}.json`);
                res.json(exportData);
            } catch (error) {
                console.error('Error exporting data:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Reset settings
        this.app.post('/api/plugins/leveling/reset/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const settings = await this.loadSettings();
                delete settings[guildId];
                await this.saveSettings(settings);
                
                res.json({ success: true });
            } catch (error) {
                console.error('Error resetting settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

    setupEventListeners() {
        // Message XP
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;

            const settings = await this.loadSettings();
            const guildSettings = settings[message.guild.id];
            
            if (!guildSettings?.xpSources?.messages) return;

            // Check cooldown (60 seconds)
            const userId = message.author.id;
            const cooldownKey = `${userId}-${message.guild.id}`;
            const now = Date.now();
            
            if (this.messageCooldowns.has(cooldownKey)) {
                const lastMessage = this.messageCooldowns.get(cooldownKey);
                if (now - lastMessage < 60000) return; // 60 second cooldown
            }

            this.messageCooldowns.set(cooldownKey, now);
            await this.addXP(userId, message.guild.id, 'message', guildSettings);
        });

        // Voice XP tracking
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            const settings = await this.loadSettings();
            const guildId = newState.guild?.id || oldState.guild?.id;
            if (!guildId) return;

            const guildSettings = settings[guildId];
            if (!guildSettings?.xpSources?.voice) return;

            const userId = newState.member?.id || oldState.member?.id;
            if (!userId) return;

            const now = Date.now();

            // User joined voice
            if (!oldState.channel && newState.channel) {
                this.voiceTracker.set(`${userId}-${guildId}`, now);
            }
            // User left voice
            else if (oldState.channel && !newState.channel) {
                const joinTime = this.voiceTracker.get(`${userId}-${guildId}`);
                if (joinTime) {
                    const timeSpent = Math.floor((now - joinTime) / 60000); // minutes
                    if (timeSpent > 0) {
                        const data = await this.loadData();
                        if (!data.users[userId]) data.users[userId] = {};
                        if (!data.users[userId][guildId]) {
                            data.users[userId][guildId] = {
                                xp: 0, level: 0, voiceTime: 0,
                                reactionsGiven: 0, reactionsReceived: 0
                            };
                        }

                        const userData = data.users[userId][guildId];
                        const oldLevel = userData.level;
                        
                        userData.voiceTime += timeSpent;
                        userData.xp += timeSpent; // 1 XP per minute
                        userData.level = this.calculateLevel(userData.xp);

                        await this.saveData(data);

                        // Level up check
                        if (userData.level > oldLevel && guildSettings.levelUpChannel) {
                            await this.sendLevelUpMessage(userId, guildId, userData.level, guildSettings);
                        }
                    }
                    this.voiceTracker.delete(`${userId}-${guildId}`);
                }
            }
        });

        // Reaction XP
        this.client.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot || !reaction.message.guild) return;

            const settings = await this.loadSettings();
            const guildSettings = settings[reaction.message.guild.id];
            
            if (!guildSettings?.xpSources?.reactions) return;

            await this.addXP(user.id, reaction.message.guild.id, 'reaction', guildSettings);
            
            // Also give XP to the message author (reaction received)
            if (reaction.message.author && !reaction.message.author.bot) {
                const data = await this.loadData();
                const authorId = reaction.message.author.id;
                const guildId = reaction.message.guild.id;
                
                if (!data.users[authorId]) data.users[authorId] = {};
                if (!data.users[authorId][guildId]) {
                    data.users[authorId][guildId] = {
                        xp: 0, level: 0, voiceTime: 0,
                        reactionsGiven: 0, reactionsReceived: 0
                    };
                }

                data.users[authorId][guildId].reactionsReceived += 1;
                data.users[authorId][guildId].xp += 2; // 2 XP for receiving reaction
                data.users[authorId][guildId].level = this.calculateLevel(data.users[authorId][guildId].xp);
                
                await this.saveData(data);
            }
        });
    }

    async registerSlashCommands() {
        try {
            const commands = [
                {
                    name: 'level',
                    description: 'Check your or someone else\'s level',
                    options: [
                        {
                            name: 'user',
                            description: 'User to check level for',
                            type: 6, // USER
                            required: false
                        }
                    ]
                },
                {
                    name: 'leaderboard',
                    description: 'Show the server leaderboard',
                    options: [
                        {
                            name: 'type',
                            description: 'Type of leaderboard',
                            type: 3, // STRING
                            required: false,
                            choices: [
                                { name: 'Overall XP', value: 'overall' },
                                { name: 'Voice Activity', value: 'voice' },
                                { name: 'Reactions', value: 'reactions' }
                            ]
                        }
                    ]
                }
            ];

            for (const guild of this.client.guilds.cache.values()) {
                try {
                    await guild.commands.set(commands);
                } catch (error) {
                    console.error(`Failed to register commands for guild ${guild.id}:`, error);
                }
            }

            console.log('✅ Leveling slash commands registered');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    async addXP(userId, guildId, source, guildSettings) {
        const data = await this.loadData();
        
        if (!data.users[userId]) data.users[userId] = {};
        if (!data.users[userId][guildId]) {
            data.users[userId][guildId] = {
                xp: 0, level: 0, voiceTime: 0,
                reactionsGiven: 0, reactionsReceived: 0
            };
        }

        const userData = data.users[userId][guildId];
        const baseXP = source === 'message' ? Math.floor(Math.random() * 15) + 10 : 
                      source === 'reaction' ? 5 : 1;
        const xpGain = Math.floor(baseXP * (guildSettings.xpMultiplier || 1));
        
        const oldLevel = userData.level;
        userData.xp += xpGain;
        userData.level = this.calculateLevel(userData.xp);

        if (source === 'reaction') {
            userData.reactionsGiven += 1;
        }

        await this.saveData(data);

        // Level up notification
        if (userData.level > oldLevel && guildSettings.levelUpChannel) {
            await this.sendLevelUpMessage(userId, guildId, userData.level, guildSettings);
        }

        return { xpGain, newLevel: userData.level, leveledUp: userData.level > oldLevel };
    }

    async sendLevelUpMessage(userId, guildId, level, guildSettings) {
        try {
            const channel = await this.client.channels.fetch(guildSettings.levelUpChannel);
            const user = await this.client.users.fetch(userId);
            const message = (guildSettings.levelUpMessage || '🎉 {user} reached level {level}!')
                .replace('{user}', `<@${userId}>`)
                .replace('{level}', level);

            await channel.send(message);
        } catch (error) {
            console.error('Error sending level up message:', error);
        }
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return { users: {} };
        }
    }

    async saveData(data) {
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving leveling data:', error);
        }
    }

    async loadSettings() {
        try {
            const data = await fs.readFile(this.settingsPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return {};
        }
    }

    async saveSettings(settings) {
        try {
            await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    isLevelingEnabled(guildId, settings) {
        const guildSettings = settings[guildId];
        return guildSettings && guildSettings.enabled && (
            guildSettings.xpSources?.messages || 
            guildSettings.xpSources?.voice || 
            guildSettings.xpSources?.reactions
        );
    }

    calculateLevel(xp) {
        return Math.floor(Math.sqrt(xp / 100));
    }

    getXPForLevel(level) {
        return level * level * 100;
    }

    getXPNeededForNextLevel(currentXP) {
        const currentLevel = this.calculateLevel(currentXP);
        const nextLevelXP = this.getXPForLevel(currentLevel + 1);
        return nextLevelXP - currentXP;
    }

    calculateProgress(xp) {
        const level = this.calculateLevel(xp);
        const currentLevelXP = this.getXPForLevel(level);
        const nextLevelXP = this.getXPForLevel(level + 1);
        const progress = xp - currentLevelXP;
        const total = nextLevelXP - currentLevelXP;
        return Math.floor((progress / total) * 100);
    }

    getFrontendComponent() {
        return {
            id: 'leveling',  // Changed to match the page ID in dashboard.html
            name: 'Leveling System',
            description: 'XP and leveling system with multiple sources and leaderboards',
            icon: '📈',
            containerId: 'levelingPluginContainer',
            html: `
                <div class="plugin-container">
                    <div class="page-header">
                        <div>
                            <h1 class="page-title">Leveling System</h1>
                            <p class="page-subtitle">Configure XP sources, view leaderboards, and manage user levels</p>
                        </div>
                        <div class="btn-group">
                            <button id="exportLevelingData" class="btn btn-secondary">
                                <span class="btn-icon">📤</span>
                                Export Data
                            </button>
                        </div>
                    </div>

                    <!-- Statistics Cards -->
                    <div class="stats-section">
                        <div class="stats-grid" id="levelingStatsGrid">
                            <div class="stat-card">
                                <div class="stat-icon" style="background: linear-gradient(135deg, #4f46e5, #7c3aed);">📊</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="activeUsersCount">0</div>
                                    <div class="stat-label">Active Users</div>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon" style="background: linear-gradient(135deg, #059669, #0d9488);">🎯</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="totalXpGiven">0</div>
                                    <div class="stat-label">Total XP Given</div>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon" style="background: linear-gradient(135deg, #dc2626, #ea580c);">⭐</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="averageLevel">0</div>
                                    <div class="stat-label">Average Level</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Widget -->
                    <div class="widget">
                        <div class="widget-header">
                            <h3>⚙️ Leveling Settings</h3>
                            <div class="widget-controls">
                                <span id="levelingStatus" class="status-badge status-inactive">Disabled</span>
                            </div>
                        </div>
                        <div class="widget-content">
                            <form id="levelingSettingsForm">
                                <div class="form-row">
                                    <div class="form-group">
                                        <label>XP Sources</label>
                                        <div class="checkbox-group">
                                            <div class="checkbox-group-item">
                                                <input type="checkbox" id="xpSourceMessages" name="xpSources.messages">
                                                <label for="xpSourceMessages" class="checkbox-label">💬 Messages (10-25 XP)</label>
                                            </div>
                                            <div class="checkbox-group-item">
                                                <input type="checkbox" id="xpSourceVoice" name="xpSources.voice">
                                                <label for="xpSourceVoice" class="checkbox-label">🎤 Voice Activity (1 XP/min)</label>
                                            </div>
                                            <div class="checkbox-group-item">
                                                <input type="checkbox" id="xpSourceReactions" name="xpSources.reactions">
                                                <label for="xpSourceReactions" class="checkbox-label">⭐ Reactions (5 XP given, 2 XP received)</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="xpMultiplier">XP Multiplier</label>
                                        <input type="number" id="xpMultiplier" name="xpMultiplier" class="form-control" min="0.1" max="10" step="0.1" value="1">
                                        <small class="form-text">Multiply all XP gains by this amount</small>
                                    </div>
                                </div>

                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="levelUpChannel">Level Up Channel</label>
                                        <select id="levelUpChannel" name="levelUpChannel" class="form-control">
                                            <option value="">No notifications</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="levelUpMessage">Level Up Message</label>
                                        <input type="text" id="levelUpMessage" name="levelUpMessage" class="form-control" placeholder="🎉 {user} reached level {level}!">
                                        <small class="form-text">Use {user} and {level} placeholders</small>
                                    </div>
                                </div>

                                <div class="btn-group">
                                    <button type="submit" id="saveLevelingSettings" class="btn btn-primary">
                                        <span class="btn-icon">💾</span>
                                        Save Settings
                                    </button>
                                    <button type="button" id="resetLevelingSettings" class="btn btn-secondary">
                                        <span class="btn-icon">🔄</span>
                                        Reset to Defaults
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- XP Management Section -->
                    <div class="widget">
                        <div class="widget-header">
                            <h3>🛠️ XP Management</h3>
                        </div>
                        <div class="widget-content" id="xpAdminSection">
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="adminUserId">User ID</label>
                                    <input type="text" id="adminUserId" class="form-control" placeholder="Enter Discord User ID">
                                </div>
                                <div class="form-group">
                                    <label for="adminXpAmount">XP Amount</label>
                                    <input type="number" id="adminXpAmount" class="form-control" min="1" placeholder="Enter XP amount">
                                </div>
                            </div>
                            <div class="btn-group">
                                <button id="addXpBtn" class="btn btn-success">
                                    <span class="btn-icon">➕</span>
                                    Add XP
                                </button>
                                <button id="removeXpBtn" class="btn btn-warning">
                                    <span class="btn-icon">➖</span>
                                    Remove XP
                                </button>
                                <button id="setXpBtn" class="btn btn-info">
                                    <span class="btn-icon">🎯</span>
                                    Set XP
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Leaderboards Section -->
                    <div class="widget">
                        <div class="widget-header">
                            <h3>🏆 Leaderboards</h3>
                            <div class="leaderboard-tabs">
                                <button class="tab-btn active" data-type="overall">Overall XP</button>
                                <button class="tab-btn" data-type="voice">Voice Activity</button>
                                <button class="tab-btn" data-type="reactions">Reactions</button>
                            </div>
                        </div>
                        <div class="widget-content">
                            <div id="leaderboardContent">
                                <div id="leaderboardLoading" class="plugin-loading" style="display: none;">
                                    Loading leaderboard...
                                </div>
                                <div id="leaderboardList" class="leaderboard-list">
                                    <div class="empty-state">
                                        <div class="empty-icon">📊</div>
                                        <div class="empty-text">No leveling data available</div>
                                        <div class="empty-subtext">Users will appear here as they gain XP</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            script: `
                (function() {
                    console.log("⚡ Leveling Plugin: Initializing frontend component...");
                    
                    // Plugin state
                    let currentServerId = null;
                    let currentLeaderboardType = 'overall';
                    let settings = {};
                    
                    // Utility functions for safe DOM operations
                    function safeGetElement(selector) {
                        const element = document.querySelector(selector);
                        if (!element) {
                            console.warn(\`⚠️ Element not found: \${selector}\`);
                        }
                        return element;
                    }
                    
                    function safeGetElements(selector) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length === 0) {
                            console.warn(\`⚠️ No elements found: \${selector}\`);
                        }
                        return elements;
                    }
                    
                    function safeAddClass(element, className) {
                        if (element && element.classList) {
                            element.classList.add(className);
                        }
                    }
                    
                    function safeRemoveClass(element, className) {
                        if (element && element.classList) {
                            element.classList.remove(className);
                        }
                    }
                    
                    // DOM elements
                    let serverSelect = null;
                    let levelingSettingsForm = null;
                    let leaderboardTabs = null;
                    let leaderboardContent = null;
                    let leaderboardLoading = null;
                    let leaderboardList = null;
                    let exportButton = null;
                    let resetButton = null;
                    
                    // XP management elements
                    let addXpBtn = null;
                    let removeXpBtn = null;
                    let setXpBtn = null;
                    let adminUserId = null;
                    let adminXpAmount = null;

                    // Initialize plugin
                    function init() {
                        if (document.readyState === 'loading') {
                            document.addEventListener('DOMContentLoaded', initializeElements);
                        } else {
                            initializeElements();
                        }
                    }
                    
                    function initializeElements() {
                        console.log("🔄 Leveling Plugin: Initializing elements...");
                        
                        // Get DOM elements safely - but don't cache tabs since they might change
                        serverSelect = window.serverSelect || safeGetElement('#serverSelect, #ccServerSelect');
                        levelingSettingsForm = safeGetElement('#levelingSettingsForm');
                        leaderboardContent = safeGetElement('#leaderboardContent');
                        leaderboardLoading = safeGetElement('#leaderboardLoading');
                        leaderboardList = safeGetElement('#leaderboardList');
                        exportButton = safeGetElement('#exportLevelingData');
                        resetButton = safeGetElement('#resetLevelingSettings');
                        
                        // XP management buttons
                        addXpBtn = safeGetElement('#addXpBtn');
                        removeXpBtn = safeGetElement('#removeXpBtn');
                        setXpBtn = safeGetElement('#setXpBtn');
                        adminUserId = safeGetElement('#adminUserId');
                        adminXpAmount = safeGetElement('#adminXpAmount');
                        
                        setupEventListeners();
                        loadInitialData();
                    }

                    function setupEventListeners() {
                        console.log("🔄 Leveling Plugin: Setting up event listeners...");
                        
                        // Server selection
                        if (serverSelect) {
                            serverSelect.addEventListener('change', handleServerChange);
                        }

                        // Form submission
                        if (levelingSettingsForm) {
                            levelingSettingsForm.addEventListener('submit', handleSettingsSubmit);
                        }

                        // Leaderboard tabs with event delegation - using the most specific container
                        setTimeout(() => {
                            const leaderboardSection = document.querySelector('.widget:has(.leaderboard-tabs)') || 
                                                      document.querySelector('#leaderboardContent')?.closest('.widget') ||
                                                      document.querySelector('.widget');
                            
                            if (leaderboardSection) {
                                // Remove any existing listeners to prevent duplicates
                                leaderboardSection.removeEventListener('click', handleTabClick);
                                // Add the listener
                                leaderboardSection.addEventListener('click', handleTabClick);
                                console.log('✅ Leaderboard tab listeners setup with event delegation');
                            } else {
                                console.warn('⚠️ Could not find leaderboard widget for event delegation');
                            }
                        }, 100);
                        
                        function handleTabClick(e) {
                            const clickedTab = e.target.closest('.tab-btn');
                            if (clickedTab && clickedTab.closest('.leaderboard-tabs')) {
                                e.preventDefault();
                                e.stopPropagation();
                                const tabType = clickedTab.getAttribute('data-tab') || clickedTab.getAttribute('data-type');
                                if (tabType) {
                                    console.log(\`🎯 Tab clicked: \${tabType}\`);
                                    switchLeaderboardTab(tabType);
                                }
                            }
                        }

                        // Export button
                        if (exportButton) {
                            exportButton.addEventListener('click', handleExportData);
                        }

                        // Reset button
                        if (resetButton) {
                            resetButton.addEventListener('click', handleResetSettings);
                        }

                        // XP management buttons
                        if (addXpBtn) {
                            addXpBtn.addEventListener('click', () => handleXpAction('add'));
                        }
                        if (removeXpBtn) {
                            removeXpBtn.addEventListener('click', () => handleXpAction('remove'));
                        }
                        if (setXpBtn) {
                            setXpBtn.addEventListener('click', () => handleXpAction('set'));
                        }
                        
                        console.log("✅ Leveling Plugin: Event listeners setup complete");
                    }

                    function loadInitialData() {
                        // Check if we have a current server selected
                        if (window.currentSelectedServer) {
                            currentServerId = window.currentSelectedServer;
                            loadServerData();
                        } else if (serverSelect && serverSelect.value) {
                            currentServerId = serverSelect.value;
                            loadServerData();
                        }
                    }

                    function handleServerChange(event) {
                        const newServerId = event?.target?.value || serverSelect?.value;
                        if (newServerId && newServerId !== currentServerId) {
                            currentServerId = newServerId;
                            loadServerData();
                        }
                    }

                    async function loadServerData() {
                        if (!currentServerId) {
                            console.log("⚠️ No server selected for leveling plugin");
                            return;
                        }
                        
                        console.log(\`🔄 Loading leveling data for server: \${currentServerId}\`);
                        
                        try {
                            await Promise.allSettled([
                                loadSettings(),
                                loadLeaderboard(),
                                loadStats(),
                                loadChannels()
                            ]);
                        } catch (error) {
                            console.error('Error loading server data:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading leveling data', 'error');
                            }
                        }
                    }

                    async function loadSettings() {
                        try {
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`);
                            if (response.ok) {
                                settings = await response.json();
                                updateSettingsForm();
                                updateStatus();
                                console.log("✅ Leveling settings loaded");
                            }
                        } catch (error) {
                            console.error('Error loading settings:', error);
                        }
                    }

                    async function loadChannels() {
                        try {
                            const response = await fetch(\`/api/channels/\${currentServerId}\`);
                            if (response.ok) {
                                const channels = await response.json();
                                updateChannelSelect(channels);
                            }
                        } catch (error) {
                            console.error('Error loading channels:', error);
                        }
                    }

                    async function loadLeaderboard() {
                        if (!leaderboardContent) return;
                        
                        try {
                            // Show loading state
                            if (leaderboardLoading) {
                                leaderboardLoading.style.display = 'block';
                            }
                            if (leaderboardList) {
                                leaderboardList.style.display = 'none';
                            }
                            
                            const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentServerId}?type=\${currentLeaderboardType}&limit=50\`);
                            
                            if (response.ok) {
                                const data = await response.json();
                                displayLeaderboard(data);
                                console.log(\`✅ Leaderboard loaded: \${data.length} users\`);
                            } else {
                                console.warn('Failed to load leaderboard:', response.status);
                                displayEmptyLeaderboard();
                            }
                        } catch (error) {
                            console.error('Error loading leaderboard:', error);
                            displayEmptyLeaderboard();
                        } finally {
                            // Hide loading state
                            if (leaderboardLoading) {
                                leaderboardLoading.style.display = 'none';
                            }
                            if (leaderboardList) {
                                leaderboardList.style.display = 'block';
                            }
                        }
                    }

                    async function loadStats() {
                        try {
                            const response = await fetch(\`/api/plugins/leveling/stats/\${currentServerId}\`);
                            if (response.ok) {
                                const stats = await response.json();
                                updateStatsDisplay(stats);
                                console.log("✅ Leveling stats loaded");
                            }
                        } catch (error) {
                            console.error('Error loading stats:', error);
                        }
                    }

                    function switchLeaderboardTab(tabType) {
                        console.log(\`🔄 Switching leaderboard tab to: \${tabType}\`);
                        
                        try {
                            // Wait a moment for DOM to be stable
                            requestAnimationFrame(() => {
                                // Find the leaderboard tabs container with multiple fallbacks
                                let tabsContainer = document.querySelector('.leaderboard-tabs');
                                
                                if (!tabsContainer) {
                                    // Fallback: look for any tabs in the leveling plugin container
                                    const pluginContainer = document.getElementById('levelingPluginContainer');
                                    if (pluginContainer) {
                                        tabsContainer = pluginContainer.querySelector('.leaderboard-tabs');
                                    }
                                }
                                
                                if (!tabsContainer) {
                                    console.warn('⚠️ Leaderboard tabs container not found');
                                    return;
                                }
                                
                                // Get all tab buttons within the container
                                const currentTabs = tabsContainer.querySelectorAll('.tab-btn');
                                console.log(\`Found \${currentTabs.length} tab buttons\`);
                                
                                // Update tab buttons safely
                                currentTabs.forEach((tab, index) => {
                                    try {
                                        if (tab && typeof tab.classList !== 'undefined') {
                                            tab.classList.remove('active');
                                            const tabTypeAttr = tab.getAttribute('data-tab') || tab.getAttribute('data-type');
                                            if (tabTypeAttr === tabType) {
                                                tab.classList.add('active');
                                                console.log(\`✅ Activated tab \${index}: \${tabType}\`);
                                            }
                                        }
                                    } catch (tabError) {
                                        console.warn(\`Warning updating tab \${index}:\`, tabError);
                                    }
                                });

                                // Update current type and reload
                                currentLeaderboardType = tabType;
                                if (currentServerId) {
                                    loadLeaderboard();
                                } else {
                                    console.warn('⚠️ No server selected for leaderboard load');
                                }
                            });
                        } catch (error) {
                            console.error('Error switching leaderboard tab:', error);
                        }
                    }

                    function updateSettingsForm() {
                        if (!levelingSettingsForm || !settings) return;
                        
                        // Update form fields based on settings
                        const xpSourcesMessages = safeGetElement('#xpSourceMessages');
                        const xpSourcesVoice = safeGetElement('#xpSourceVoice');
                        const xpSourcesReactions = safeGetElement('#xpSourceReactions');
                        const xpMultiplier = safeGetElement('#xpMultiplier');
                        const levelUpChannel = safeGetElement('#levelUpChannel');
                        const levelUpMessage = safeGetElement('#levelUpMessage');
                        
                        if (xpSourcesMessages) {
                            xpSourcesMessages.checked = settings.xpSources?.messages !== false;
                        }
                        if (xpSourcesVoice) {
                            xpSourcesVoice.checked = settings.xpSources?.voice === true;
                        }
                        if (xpSourcesReactions) {
                            xpSourcesReactions.checked = settings.xpSources?.reactions === true;
                        }
                        if (xpMultiplier) {
                            xpMultiplier.value = settings.xpMultiplier || 1;
                        }
                        if (levelUpChannel) {
                            levelUpChannel.value = settings.levelUpChannel || '';
                        }
                        if (levelUpMessage) {
                            levelUpMessage.value = settings.levelUpMessage || '🎉 {user} reached level {level}!';
                        }
                        
                        console.log("✅ Settings form updated");
                    }

                    function updateChannelSelect(channels) {
                        const levelUpChannel = safeGetElement('#levelUpChannel');
                        if (!levelUpChannel) return;
                        
                        levelUpChannel.innerHTML = '<option value="">No notifications</option>';
                        
                        channels.forEach(channel => {
                            if (channel.type === 0) { // Text channels only
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`#\${channel.name}\`;
                                levelUpChannel.appendChild(option);
                            }
                        });
                        
                        // Restore selected value
                        if (settings.levelUpChannel) {
                            levelUpChannel.value = settings.levelUpChannel;
                        }
                    }

                    function updateStatus() {
                        const statusElement = safeGetElement('#levelingStatus');
                        if (statusElement) {
                            const isEnabled = settings.enabled !== false && (
                                settings.xpSources?.messages || 
                                settings.xpSources?.voice || 
                                settings.xpSources?.reactions
                            );
                            statusElement.textContent = isEnabled ? 'Enabled' : 'Disabled';
                            safeRemoveClass(statusElement, 'status-active');
                            safeRemoveClass(statusElement, 'status-inactive');
                            safeAddClass(statusElement, isEnabled ? 'status-active' : 'status-inactive');
                        }
                    }

                    function updateStatsDisplay(stats) {
                        // Update stats cards safely
                        const activeUsersElement = safeGetElement('#activeUsersCount');
                        const totalXpElement = safeGetElement('#totalXpGiven');
                        const avgLevelElement = safeGetElement('#averageLevel');
                        
                        if (activeUsersElement) {
                            activeUsersElement.textContent = stats.activeUsers || '0';
                        }
                        if (totalXpElement) {
                            totalXpElement.textContent = (stats.totalXp || 0).toLocaleString();
                        }
                        if (avgLevelElement) {
                            avgLevelElement.textContent = stats.averageLevel || '0';
                        }
                    }

                    function displayLeaderboard(data) {
                        if (!leaderboardList) return;
                        
                        if (!data || data.length === 0) {
                            displayEmptyLeaderboard();
                            return;
                        }
                        
                        const leaderboardHTML = data.map((user, index) => {
                            const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : \`#\${index + 1}\`;
                            const progressWidth = user.xp > 0 ? calculateProgress(user.xp) : 0;
                            
                            return \`
                                <div class="leaderboard-item">
                                    <div class="rank">\${rankEmoji}</div>
                                    <div class="user-info">
                                        <img src="\${user.avatar || '/default-avatar.png'}" alt="Avatar" class="user-avatar" loading="lazy">
                                        <div class="user-details">
                                            <div class="user-name">\${user.displayName || user.username || 'Unknown User'}</div>
                                            <div class="user-stats">
                                                Level \${user.level || 0} • \${(user.xp || 0).toLocaleString()} XP
                                                \${currentLeaderboardType === 'voice' ? \` • \${Math.floor((user.voiceTime || 0) / 60)}h voice\` : ''}
                                                \${currentLeaderboardType === 'reactions' ? \` • \${user.reactionsGiven || 0} reactions\` : ''}
                                            </div>
                                            <div class="progress-bar">
                                                <div class="progress-fill" style="width: \${progressWidth}%"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="user-actions">
                                        <button class="action-btn" onclick="editUserXp('\${user.userId}', \${user.xp || 0})">
                                            ✏️ Edit
                                        </button>
                                    </div>
                                </div>
                            \`;
                        }).join('');
                        
                        leaderboardList.innerHTML = leaderboardHTML;
                    }

                    function displayEmptyLeaderboard() {
                        if (!leaderboardList) return;
                        
                        leaderboardList.innerHTML = \`
                            <div class="empty-state">
                                <div class="empty-icon">📊</div>
                                <div class="empty-text">No leveling data available</div>
                                <div class="empty-subtext">Users will appear here as they gain XP</div>
                            </div>
                        \`;
                    }

                    function calculateProgress(xp) {
                        const level = Math.floor(Math.sqrt(xp / 100));
                        const currentLevelXP = level * level * 100;
                        const nextLevelXP = (level + 1) * (level + 1) * 100;
                        const progress = xp - currentLevelXP;
                        const total = nextLevelXP - currentLevelXP;
                        return Math.floor((progress / total) * 100);
                    }

                    async function handleSettingsSubmit(event) {
                        event.preventDefault();
                        
                        if (!currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        const formData = new FormData(levelingSettingsForm);
                        const newSettings = {
                            enabled: true,
                            xpSources: {
                                messages: formData.has('xpSources.messages'),
                                voice: formData.has('xpSources.voice'),
                                reactions: formData.has('xpSources.reactions')
                            },
                            xpMultiplier: parseFloat(formData.get('xpMultiplier')) || 1,
                            levelUpChannel: formData.get('levelUpChannel') || null,
                            levelUpMessage: formData.get('levelUpMessage') || '🎉 {user} reached level {level}!'
                        };
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(newSettings)
                            });
                            
                            if (response.ok) {
                                settings = { ...settings, ...newSettings };
                                updateStatus();
                                if (window.showNotification) {
                                    window.showNotification('Settings saved successfully!', 'success');
                                }
                                console.log("✅ Settings saved");
                            } else {
                                throw new Error('Failed to save settings');
                            }
                        } catch (error) {
                            console.error('Error saving settings:', error);
                            if (window.showNotification) {
                                window.showNotification('Error saving settings', 'error');
                            }
                        }
                    }

                    async function handleXpAction(action) {
                        const userId = adminUserId?.value?.trim();
                        const amount = parseInt(adminXpAmount?.value) || 0;
                        
                        if (!userId || amount <= 0) {
                            if (window.showNotification) {
                                window.showNotification('Please enter a valid user ID and amount', 'error');
                            }
                            return;
                        }
                        
                        if (!currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/admin/\${action}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    userId,
                                    guildId: currentServerId,
                                    amount
                                })
                            });
                            
                            if (response.ok) {
                                const result = await response.json();
                                if (window.showNotification) {
                                    window.showNotification(
                                        \`Successfully \${action === 'set' ? 'set' : action + 'ed'} XP! New: \${result.newXP} XP (Level \${result.newLevel})\`, 
                                        'success'
                                    );
                                }
                                // Clear form
                                if (adminUserId) adminUserId.value = '';
                                if (adminXpAmount) adminXpAmount.value = '';
                                // Reload leaderboard and stats
                                loadLeaderboard();
                                loadStats();
                            } else {
                                throw new Error(\`Failed to \${action} XP\`);
                            }
                        } catch (error) {
                            console.error(\`Error \${action}ing XP:\`, error);
                            if (window.showNotification) {
                                window.showNotification(\`Error \${action}ing XP\`, 'error');
                            }
                        }
                    }

                    async function handleExportData() {
                        if (!currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/export/\${currentServerId}\`);
                            if (response.ok) {
                                const blob = await response.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = \`leveling-data-\${currentServerId}-\${new Date().toISOString().split('T')[0]}.json\`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                                
                                if (window.showNotification) {
                                    window.showNotification('Data exported successfully!', 'success');
                                }
                            } else {
                                throw new Error('Export failed');
                            }
                        } catch (error) {
                            console.error('Error exporting data:', error);
                            if (window.showNotification) {
                                window.showNotification('Error exporting data', 'error');
                            }
                        }
                    }

                    async function handleResetSettings() {
                        if (!confirm('Are you sure you want to reset all leveling settings? This cannot be undone.')) {
                            return;
                        }
                        
                        if (!currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/leveling/reset/\${currentServerId}\`, {
                                method: 'POST'
                            });
                            
                            if (response.ok) {
                                settings = {};
                                updateSettingsForm();
                                updateStatus();
                                loadLeaderboard();
                                loadStats();
                                
                                if (window.showNotification) {
                                    window.showNotification('Settings reset successfully!', 'success');
                                }
                            } else {
                                throw new Error('Reset failed');
                            }
                        } catch (error) {
                            console.error('Error resetting settings:', error);
                            if (window.showNotification) {
                                window.showNotification('Error resetting settings', 'error');
                            }
                        }
                    }

                    // Global function for editing user XP (called from leaderboard)
                    window.editUserXp = function(userId, currentXp) {
                        if (adminUserId) {
                            adminUserId.value = userId;
                        }
                        if (adminXpAmount) {
                            adminXpAmount.value = currentXp;
                        }
                        
                        // Scroll to admin section
                        const adminSection = safeGetElement('#xpAdminSection');
                        if (adminSection) {
                            adminSection.scrollIntoView({ behavior: 'smooth' });
                        }
                    };

                    // Handle server changes from global context
                    window.addEventListener('serverChanged', function(event) {
                        if (event.detail && event.detail.serverId) {
                            currentServerId = event.detail.serverId;
                            loadServerData();
                        }
                    });

                    // Listen for global server selection changes
                    if (window.currentSelectedServer) {
                        currentServerId = window.currentSelectedServer;
                    }

                    // Initialize when script loads
                    init();
                    
                    console.log("✅ Leveling Plugin: Frontend component initialized successfully");
                })();
            `
        };
    }
}

module.exports = LevelingPlugin;