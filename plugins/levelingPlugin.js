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
                
                let totalXP = 0;
                let totalVoiceTime = 0;
                let totalReactions = 0;
                let maxLevel = 0;
                
                Object.keys(data.users).forEach(userId => {
                    const userData = data.users[userId][guildId];
                    if (userData) {
                        totalXP += userData.xp || 0;
                        totalVoiceTime += userData.voiceTime || 0;
                        totalReactions += (userData.reactionsGiven || 0) + (userData.reactionsReceived || 0);
                        maxLevel = Math.max(maxLevel, userData.level || 0);
                    }
                });

                res.json({
                    serverUsers,
                    totalXP,
                    totalVoiceTime,
                    totalReactions,
                    maxLevel,
                    isEnabled: this.isLevelingEnabled(guildId, settings)
                });
            } catch (error) {
                console.error('Error fetching leveling stats:', error);
                res.status(500).json({ error: 'Failed to fetch leveling statistics' });
            }
        });

        // Get leveling settings
        this.app.get('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const settings = await this.loadSettings();
                const guildSettings = settings[guildId] || this.getDefaultSettings();
                
                res.json(guildSettings);
            } catch (error) {
                console.error('Error fetching leveling settings:', error);
                res.status(500).json({ error: 'Failed to fetch settings' });
            }
        });

        // Update leveling settings
        this.app.post('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const settings = await this.loadSettings();
                settings[guildId] = {
                    ...this.getDefaultSettings(),
                    ...req.body,
                    updatedAt: new Date().toISOString()
                };

                await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
                
                res.json({ success: true, message: 'Settings updated successfully' });
            } catch (error) {
                console.error('Error updating leveling settings:', error);
                res.status(500).json({ error: 'Failed to update settings' });
            }
        });

        // Get leaderboard data
        this.app.get('/api/plugins/leveling/leaderboard/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { type = 'overall', limit = 10 } = req.query;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const leaderboard = await this.generateLeaderboard(guildId, type, parseInt(limit));
                
                // Enrich with user data
                const enrichedLeaderboard = await Promise.all(
                    leaderboard.map(async (entry, index) => {
                        try {
                            const user = await this.client.users.fetch(entry.userId);
                            return {
                                rank: index + 1,
                                userId: entry.userId,
                                username: user.username,
                                displayName: user.displayName || user.username,
                                avatar: user.displayAvatarURL({ size: 64 }),
                                value: entry.value,
                                level: entry.level,
                                progressToNext: this.calculateProgress(entry.xp || entry.value)
                            };
                        } catch {
                            return {
                                rank: index + 1,
                                userId: entry.userId,
                                username: 'Unknown User',
                                displayName: 'Unknown User',
                                avatar: null,
                                value: entry.value,
                                level: entry.level,
                                progressToNext: 0
                            };
                        }
                    })
                );

                res.json(enrichedLeaderboard);
            } catch (error) {
                console.error('Error fetching leaderboard:', error);
                res.status(500).json({ error: 'Failed to fetch leaderboard' });
            }
        });

        // Admin XP management
        this.app.post('/api/plugins/leveling/manage-xp/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { userId, amount, action } = req.body; // action: 'add', 'remove', 'set'
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                
                if (!data.users[userId]) {
                    data.users[userId] = {};
                }
                
                if (!data.users[userId][guildId]) {
                    data.users[userId][guildId] = {
                        xp: 0, level: 0, voiceTime: 0, 
                        reactionsGiven: 0, reactionsReceived: 0
                    };
                }

                const userData = data.users[userId][guildId];
                const oldXP = userData.xp;
                
                switch (action) {
                    case 'add':
                        userData.xp += Math.max(0, parseInt(amount));
                        break;
                    case 'remove':
                        userData.xp = Math.max(0, userData.xp - Math.max(0, parseInt(amount)));
                        break;
                    case 'set':
                        userData.xp = Math.max(0, parseInt(amount));
                        break;
                    default:
                        return res.status(400).json({ error: 'Invalid action' });
                }

                // Recalculate level
                userData.level = this.calculateLevel(userData.xp);
                
                await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
                
                res.json({ 
                    success: true, 
                    message: `Successfully ${action}ed ${Math.abs(amount)} XP`,
                    oldXP,
                    newXP: userData.xp,
                    newLevel: userData.level
                });
            } catch (error) {
                console.error('Error managing XP:', error);
                res.status(500).json({ error: 'Failed to manage XP' });
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
                    users: Object.keys(data.users).reduce((acc, userId) => {
                        if (data.users[userId][guildId]) {
                            acc[userId] = data.users[userId][guildId];
                        }
                        return acc;
                    }, {})
                };

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="leveling-data-${guildId}-${Date.now()}.json"`);
                res.send(JSON.stringify(exportData, null, 2));
            } catch (error) {
                console.error('Error exporting data:', error);
                res.status(500).json({ error: 'Failed to export data' });
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
            
            await this.addXP(message.author.id, message.guild.id, 'message', guildSettings);
        });

        // Voice XP
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            const guildId = newState.guild?.id || oldState.guild?.id;
            if (!guildId) return;
            
            const settings = await this.loadSettings();
            const guildSettings = settings[guildId];
            
            if (!guildSettings?.xpSources?.voice) return;
            
            // User joined voice
            if (!oldState.channelId && newState.channelId) {
                this.voiceSessions = this.voiceSessions || {};
                this.voiceSessions[`${guildId}-${newState.id}`] = Date.now();
            }
            
            // User left voice
            if (oldState.channelId && !newState.channelId) {
                const sessionKey = `${guildId}-${newState.id}`;
                if (this.voiceSessions?.[sessionKey]) {
                    const sessionTime = Math.floor((Date.now() - this.voiceSessions[sessionKey]) / 60000); // minutes
                    delete this.voiceSessions[sessionKey];
                    
                    if (sessionTime >= 1) { // Minimum 1 minute
                        await this.addVoiceTime(newState.id, guildId, sessionTime, guildSettings);
                    }
                }
            }
        });

        // Reaction XP
        this.client.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot || !reaction.message.guild) return;
            
            const settings = await this.loadSettings();
            const guildSettings = settings[reaction.message.guild.id];
            
            if (!guildSettings?.xpSources?.reactions) return;
            
            await this.addReaction(user.id, reaction.message.guild.id, 'given', guildSettings);
            await this.addReaction(reaction.message.author.id, reaction.message.guild.id, 'received', guildSettings);
        });

        // Slash command handling
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            try {
                switch (interaction.commandName) {
                    case 'level':
                        await this.handleLevelCommand(interaction);
                        break;
                    case 'leaderboard':
                        await this.handleLeaderboardCommand(interaction);
                        break;
                }
            } catch (error) {
                console.error('Error handling slash command:', error);
                const errorMessage = 'An error occurred while processing this command.';
                
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            }
        });
    }

    async registerSlashCommands() {
        // Wait for client to be ready before registering commands
        if (!this.client.isReady()) {
            this.client.once('ready', () => {
                this.registerSlashCommands();
            });
            return;
        }

        const commands = [
            {
                name: 'level',
                description: 'Check your or someone else\'s level and XP',
                options: [{
                    name: 'user',
                    description: 'The user to check (defaults to yourself)',
                    type: 6, // USER
                    required: false
                }]
            },
            {
                name: 'leaderboard',
                description: 'View server leaderboards',
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
                    },
                    {
                        name: 'limit',
                        description: 'Number of users to show (1-25)',
                        type: 4, // INTEGER
                        required: false,
                        min_value: 1,
                        max_value: 25
                    }
                ]
            }
        ];

        try {
            await this.client.application.commands.set(commands);
            console.log('✅ Leveling slash commands registered');
        } catch (error) {
            console.error('❌ Error registering leveling commands:', error);
        }
    }

    // Helper methods
    getDefaultSettings() {
        return {
            xpSources: {
                messages: true,
                voice: true,
                reactions: true
            },
            xpMultiplier: 1.0,
            levelUpChannel: null,
            levelUpMessage: '🎉 {user} reached level {level}!',
            createdAt: new Date().toISOString()
        };
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return { users: {} };
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

    isLevelingEnabled(guildId, settings) {
        const guildSettings = settings[guildId];
        return guildSettings && (
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
        const baseXP = source === 'message' ? Math.floor(Math.random() * 15) + 10 : 5;
        const xpGain = Math.floor(baseXP * (guildSettings.xpMultiplier || 1));
        
        const oldLevel = userData.level;
        userData.xp += xpGain;
        userData.level = this.calculateLevel(userData.xp);

        // Level up notification
        if (userData.level > oldLevel && guildSettings.levelUpChannel) {
            try {
                const channel = await this.client.channels.fetch(guildSettings.levelUpChannel);
                const user = await this.client.users.fetch(userId);
                const message = (guildSettings.levelUpMessage || '🎉 {user} reached level {level}!')
                    .replace('{user}', `<@${userId}>`)
                    .replace('{level}', userData.level);
                await channel.send(message);
            } catch (error) {
                console.error('Error sending level up message:', error);
            }
        }

        await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
    }

    async addVoiceTime(userId, guildId, minutes, guildSettings) {
        const data = await this.loadData();
        
        if (!data.users[userId]) data.users[userId] = {};
        if (!data.users[userId][guildId]) {
            data.users[userId][guildId] = {
                xp: 0, level: 0, voiceTime: 0,
                reactionsGiven: 0, reactionsReceived: 0
            };
        }

        const userData = data.users[userId][guildId];
        userData.voiceTime += minutes;
        
        // Add XP for voice time (1 XP per minute)
        const xpGain = Math.floor(minutes * (guildSettings.xpMultiplier || 1));
        userData.xp += xpGain;
        userData.level = this.calculateLevel(userData.xp);

        await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
    }

    async addReaction(userId, guildId, type, guildSettings) {
        const data = await this.loadData();
        
        if (!data.users[userId]) data.users[userId] = {};
        if (!data.users[userId][guildId]) {
            data.users[userId][guildId] = {
                xp: 0, level: 0, voiceTime: 0,
                reactionsGiven: 0, reactionsReceived: 0
            };
        }

        const userData = data.users[userId][guildId];
        
        if (type === 'given') {
            userData.reactionsGiven++;
        } else {
            userData.reactionsReceived++;
        }
        
        // Add XP for reactions (2 XP per reaction)
        const xpGain = Math.floor(2 * (guildSettings.xpMultiplier || 1));
        userData.xp += xpGain;
        userData.level = this.calculateLevel(userData.xp);

        await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
    }

    async generateLeaderboard(guildId, type = 'overall', limit = 10) {
        const data = await this.loadData();
        const users = [];

        Object.keys(data.users).forEach(userId => {
            const userData = data.users[userId][guildId];
            if (!userData) return;

            let value;
            switch (type) {
                case 'voice':
                    value = userData.voiceTime || 0;
                    break;
                case 'reactions':
                    value = (userData.reactionsGiven || 0) + (userData.reactionsReceived || 0);
                    break;
                default:
                    value = userData.xp || 0;
            }

            if (value > 0) {
                users.push({
                    userId,
                    value,
                    level: userData.level || 0,
                    xp: userData.xp || 0
                });
            }
        });

        return users
            .sort((a, b) => b.value - a.value)
            .slice(0, limit);
    }

    async handleLevelCommand(interaction) {
        try {
            await interaction.deferReply();

            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guildId;

            if (!guildId) {
                return await interaction.editReply('This command can only be used in a server!');
            }

            // Check if leveling is enabled for this server
            const settings = await this.loadSettings();
            const guildSettings = settings[guildId];
            
            if (!guildSettings || (!guildSettings.xpSources?.messages && !guildSettings.xpSources?.voice && !guildSettings.xpSources?.reactions)) {
                return await interaction.editReply('❌ Leveling system is not enabled on this server.');
            }

            const data = await this.loadData();
            const userData = data.users[targetUser.id]?.[guildId] || {
                xp: 0, level: 0, voiceTime: 0, reactionsGiven: 0, reactionsReceived: 0
            };

            const xpNeeded = this.getXPNeededForNextLevel(userData.xp);
            const xpForCurrentLevel = this.getXPForLevel(userData.level);
            const xpProgress = userData.xp - xpForCurrentLevel;
            const xpForNextLevel = this.getXPForLevel(userData.level + 1) - xpForCurrentLevel;
            const progressPercentage = Math.floor((xpProgress / xpForNextLevel) * 100);

            const embed = {
                color: 0x4f46e5,
                title: `${targetUser.username}'s Level`,
                thumbnail: { url: targetUser.displayAvatarURL() },
                fields: [
                    { name: '📊 Level', value: userData.level.toString(), inline: true },
                    { name: '⭐ Total XP', value: userData.xp.toLocaleString(), inline: true },
                    { name: '🎯 XP to Next Level', value: xpNeeded.toLocaleString(), inline: true },
                    { name: '📈 Progress', value: `${xpProgress.toLocaleString()}/${xpForNextLevel.toLocaleString()} (${progressPercentage}%)`, inline: false }
                ],
                footer: { text: `Voice: ${userData.voiceTime}min | Reactions: ${userData.reactionsGiven + userData.reactionsReceived}` }
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error handling level command:', error);
            await interaction.editReply('❌ An error occurred while fetching level data.');
        }
    }

    async handleLeaderboardCommand(interaction) {
        try {
            await interaction.deferReply();

            const type = interaction.options.getString('type') || 'overall';
            const limit = interaction.options.getInteger('limit') || 10;
            const guildId = interaction.guildId;

            if (!guildId) {
                return await interaction.editReply('This command can only be used in a server!');
            }

            const leaderboard = await this.generateLeaderboard(guildId, type, limit);

            if (leaderboard.length === 0) {
                return await interaction.editReply('❌ No data available for the leaderboard.');
            }

            const enrichedLeaderboard = await Promise.all(
                leaderboard.map(async (entry, index) => {
                    try {
                        const user = await this.client.users.fetch(entry.userId);
                        return {
                            rank: index + 1,
                            username: user.username,
                            value: entry.value,
                            level: entry.level
                        };
                    } catch {
                        return {
                            rank: index + 1,
                            username: 'Unknown User',
                            value: entry.value,
                            level: entry.level
                        };
                    }
                })
            );

            const leaderboardText = enrichedLeaderboard
                .map(entry => {
                    const emoji = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '📍';
                    let valueText;
                    
                    switch (type) {
                        case 'voice':
                            valueText = `${entry.value} minutes`;
                            break;
                        case 'reactions':
                            valueText = `${entry.value} reactions`;
                            break;
                        default:
                            valueText = `${entry.value.toLocaleString()} XP (Level ${entry.level})`;
                    }
                    
                    return `${emoji} **${entry.rank}.** ${entry.username} - ${valueText}`;
                })
                .join('\n');

            const typeNames = {
                overall: 'Overall XP',
                voice: 'Voice Activity',
                reactions: 'Reactions'
            };

            const embed = {
                color: 0x22c55e,
                title: `🏆 ${typeNames[type]} Leaderboard`,
                description: leaderboardText,
                footer: { text: `Showing top ${enrichedLeaderboard.length} users` }
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error handling leaderboard command:', error);
            await interaction.editReply('❌ An error occurred while fetching leaderboard data.');
        }
    }

    getFrontendComponent() {
        return {
            id: 'leveling-system',
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
                                <div class="stat-icon" style="background: linear-gradient(135deg, #22c55e, #16a34a);">⭐</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="totalXPCount">0</div>
                                    <div class="stat-label">Total XP</div>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">🎯</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="maxLevelCount">0</div>
                                    <div class="stat-label">Highest Level</div>
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">🎤</div>
                                <div class="stat-content">
                                    <div class="stat-value" id="voiceTimeCount">0</div>
                                    <div class="stat-label">Voice Minutes</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Section -->
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
                                                <label for="xpSourceReactions" class="checkbox-label">😄 Reactions (2 XP each)</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="xpMultiplier">XP Multiplier</label>
                                        <input type="number" id="xpMultiplier" name="xpMultiplier" class="form-control" 
                                               min="0.1" max="10" step="0.1" value="1.0">
                                        <small style="color: var(--text-muted); font-size: 12px;">Multiply all XP gains (0.1x to 10x)</small>
                                    </div>
                                </div>
                                
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="levelUpChannel">Level Up Channel</label>
                                        <select id="levelUpChannel" name="levelUpChannel" class="form-control">
                                            <option value="">Select a channel...</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="levelUpMessage">Level Up Message</label>
                                        <input type="text" id="levelUpMessage" name="levelUpMessage" class="form-control" 
                                               placeholder="🎉 {user} reached level {level}!" 
                                               value="🎉 {user} reached level {level}!">
                                        <small style="color: var(--text-muted); font-size: 12px;">Use {user} and {level} placeholders</small>
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
                                <div id="leaderboardList" class="leaderboard-list"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Admin Management Section -->
                    <div class="widget">
                        <div class="widget-header">
                            <h3>👑 Admin Management</h3>
                        </div>
                        <div class="widget-content">
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="adminUserId">User ID</label>
                                    <input type="text" id="adminUserId" class="form-control" 
                                           placeholder="Enter Discord User ID">
                                </div>
                                <div class="form-group">
                                    <label for="adminXpAmount">XP Amount</label>
                                    <input type="number" id="adminXpAmount" class="form-control" 
                                           placeholder="Enter XP amount" min="1">
                                </div>
                            </div>

                            <div class="btn-group">
                                <button id="addXpBtn" class="btn btn-success" data-action="add">
                                    <span class="btn-icon">➕</span>
                                    Add XP
                                </button>
                                <button id="removeXpBtn" class="btn btn-warning" data-action="remove">
                                    <span class="btn-icon">➖</span>
                                    Remove XP
                                </button>
                                <button id="setXpBtn" class="btn btn-danger" data-action="set">
                                    <span class="btn-icon">🎯</span>
                                    Set XP
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            script: `
                (function() {
                    // Plugin state
                    let currentServerId = null;
                    let currentLeaderboardType = 'overall';
                    let settings = {};
                    
                    // DOM elements
                    const serverSelect = window.serverSelect;
                    const levelingSettingsForm = document.getElementById('levelingSettingsForm');
                    const leaderboardTabs = document.querySelectorAll('.tab-btn');
                    const leaderboardContent = document.getElementById('leaderboardContent');
                    const leaderboardLoading = document.getElementById('leaderboardLoading');
                    const leaderboardList = document.getElementById('leaderboardList');
                    const exportButton = document.getElementById('exportLevelingData');
                    const resetButton = document.getElementById('resetLevelingSettings');
                    
                    // XP management buttons
                    const addXpBtn = document.getElementById('addXpBtn');
                    const removeXpBtn = document.getElementById('removeXpBtn');
                    const setXpBtn = document.getElementById('setXpBtn');
                    const adminUserId = document.getElementById('adminUserId');
                    const adminXpAmount = document.getElementById('adminXpAmount');

                    // Initialize plugin
                    function init() {
                        setupEventListeners();
                        loadInitialData();
                    }

                    function setupEventListeners() {
                        // Server selection
                        if (serverSelect) {
                            serverSelect.addEventListener('change', handleServerChange);
                        }

                        // Settings form
                        if (levelingSettingsForm) {
                            levelingSettingsForm.addEventListener('submit', handleSettingsSave);
                        }

                        // Leaderboard tabs
                        leaderboardTabs.forEach(tab => {
                            tab.addEventListener('click', handleLeaderboardTabChange);
                        });

                        // Export button
                        if (exportButton) {
                            exportButton.addEventListener('click', handleExportData);
                        }

                        // Reset button
                        if (resetButton) {
                            resetButton.addEventListener('click', handleResetSettings);
                        }

                        // XP management buttons
                        [addXpBtn, removeXpBtn, setXpBtn].forEach(btn => {
                            if (btn) {
                                btn.addEventListener('click', handleXpManagement);
                            }
                        });

                        // Real-time updates
                        setInterval(updateStats, 30000); // Update stats every 30 seconds
                    }

                    async function loadInitialData() {
                        currentServerId = serverSelect?.value;
                        if (!currentServerId) return;

                        await Promise.all([
                            loadSettings(),
                            loadStats(),
                            loadChannels(),
                            loadLeaderboard()
                        ]);
                    }

                    async function handleServerChange() {
                        currentServerId = serverSelect.value;
                        if (!currentServerId) return;

                        showNotification('Loading server data...', 'info');
                        await loadInitialData();
                    }

                    async function loadSettings() {
                        if (!currentServerId) return;

                        try {
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load settings');

                            settings = await response.json();
                            populateSettingsForm();
                            updateStatusBadge();
                        } catch (error) {
                            console.error('Error loading settings:', error);
                            showNotification('Failed to load settings', 'error');
                        }
                    }

                    async function loadStats() {
                        if (!currentServerId) return;

                        try {
                            const response = await fetch(\`/api/plugins/leveling/stats/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load stats');

                            const stats = await response.json();
                            updateStatsDisplay(stats);
                        } catch (error) {
                            console.error('Error loading stats:', error);
                        }
                    }

                    async function loadChannels() {
                        if (!currentServerId) return;

                        try {
                            const response = await fetch(\`/api/channels/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load channels');

                            const channels = await response.json();
                            populateChannelSelect(channels);
                        } catch (error) {
                            console.error('Error loading channels:', error);
                        }
                    }

                    async function loadLeaderboard() {
                        if (!currentServerId) return;

                        leaderboardLoading.style.display = 'block';
                        leaderboardList.innerHTML = '';

                        try {
                            const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentServerId}?type=\${currentLeaderboardType}&limit=10\`);
                            if (!response.ok) throw new Error('Failed to load leaderboard');

                            const leaderboard = await response.json();
                            displayLeaderboard(leaderboard);
                        } catch (error) {
                            console.error('Error loading leaderboard:', error);
                            leaderboardList.innerHTML = '<div class="empty-state">Failed to load leaderboard</div>';
                        } finally {
                            leaderboardLoading.style.display = 'none';
                        }
                    }

                    function populateSettingsForm() {
                        // XP Sources
                        document.getElementById('xpSourceMessages').checked = settings.xpSources?.messages || false;
                        document.getElementById('xpSourceVoice').checked = settings.xpSources?.voice || false;
                        document.getElementById('xpSourceReactions').checked = settings.xpSources?.reactions || false;

                        // XP Multiplier
                        document.getElementById('xpMultiplier').value = settings.xpMultiplier || 1.0;

                        // Level up channel
                        document.getElementById('levelUpChannel').value = settings.levelUpChannel || '';

                        // Level up message
                        document.getElementById('levelUpMessage').value = settings.levelUpMessage || '🎉 {user} reached level {level}!';
                    }

                    function populateChannelSelect(channels) {
                        const channelSelect = document.getElementById('levelUpChannel');
                        if (!channelSelect) return;

                        channelSelect.innerHTML = '<option value="">Select a channel...</option>';
                        
                        channels.forEach(channel => {
                            if (channel.type === 0) { // Text channels only
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`#\${channel.name}\`;
                                channelSelect.appendChild(option);
                            }
                        });

                        // Set current value
                        if (settings.levelUpChannel) {
                            channelSelect.value = settings.levelUpChannel;
                        }
                    }

                    function updateStatsDisplay(stats) {
                        document.getElementById('activeUsersCount').textContent = stats.serverUsers.toLocaleString();
                        document.getElementById('totalXPCount').textContent = stats.totalXP.toLocaleString();
                        document.getElementById('maxLevelCount').textContent = stats.maxLevel;
                        document.getElementById('voiceTimeCount').textContent = Math.floor(stats.totalVoiceTime).toLocaleString();
                    }

                    function updateStatusBadge() {
                        const statusBadge = document.getElementById('levelingStatus');
                        if (!statusBadge) return;

                        const isEnabled = settings.xpSources?.messages || settings.xpSources?.voice || settings.xpSources?.reactions;
                        
                        if (isEnabled) {
                            statusBadge.textContent = 'Active';
                            statusBadge.className = 'status-badge status-active';
                        } else {
                            statusBadge.textContent = 'Disabled';
                            statusBadge.className = 'status-badge status-inactive';
                        }
                    }

                    function displayLeaderboard(leaderboard) {
                        if (!leaderboard || leaderboard.length === 0) {
                            leaderboardList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏆</div><div class="empty-state-title">No Data Available</div><div class="empty-state-description">Start gaining XP to appear on the leaderboard!</div></div>';
                            return;
                        }

                        const leaderboardHTML = leaderboard.map(entry => {
                            const rankEmoji = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '📍';
                            
                            let valueText;
                            switch (currentLeaderboardType) {
                                case 'voice':
                                    valueText = \`\${entry.value} minutes\`;
                                    break;
                                case 'reactions':
                                    valueText = \`\${entry.value} reactions\`;
                                    break;
                                default:
                                    valueText = \`\${entry.value.toLocaleString()} XP\`;
                            }

                            return \`
                                <div class="leaderboard-item">
                                    <div class="rank">\${rankEmoji}</div>
                                    <div class="member-info">
                                        <div class="member-avatar">
                                            \${entry.avatar ? \`<img src="\${entry.avatar}" alt="\${entry.displayName}">\` : entry.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div class="member-details">
                                            <div class="member-name">\${entry.displayName}</div>
                                            <div class="member-stats">\${valueText}</div>
                                        </div>
                                    </div>
                                    \${currentLeaderboardType === 'overall' ? \`
                                        <div class="member-progress">
                                            <div class="progress-bar">
                                                <div class="progress-fill" style="width: \${entry.progressToNext}%"></div>
                                            </div>
                                            <small style="color: var(--text-muted); font-size: 11px;">Level \${entry.level}</small>
                                        </div>
                                    \` : ''}
                                </div>
                            \`;
                        }).join('');

                        leaderboardList.innerHTML = leaderboardHTML;
                    }

                    async function handleSettingsSave(e) {
                        e.preventDefault();
                        if (!currentServerId) return;

                        const formData = new FormData(levelingSettingsForm);
                        const saveButton = document.getElementById('saveLevelingSettings');
                        
                        // Show loading state
                        saveButton.disabled = true;
                        saveButton.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

                        try {
                            const settingsData = {
                                xpSources: {
                                    messages: formData.get('xpSources.messages') === 'on',
                                    voice: formData.get('xpSources.voice') === 'on',
                                    reactions: formData.get('xpSources.reactions') === 'on'
                                },
                                xpMultiplier: parseFloat(formData.get('xpMultiplier')) || 1.0,
                                levelUpChannel: formData.get('levelUpChannel') || null,
                                levelUpMessage: formData.get('levelUpMessage') || '🎉 {user} reached level {level}!'
                            };

                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settingsData)
                            });

                            if (!response.ok) throw new Error('Failed to save settings');

                            settings = { ...settings, ...settingsData };
                            updateStatusBadge();
                            showNotification('Settings saved successfully!', 'success');
                        } catch (error) {
                            console.error('Error saving settings:', error);
                            showNotification('Failed to save settings', 'error');
                        } finally {
                            saveButton.disabled = false;
                            saveButton.innerHTML = '<span class="btn-icon">💾</span> Save Settings';
                        }
                    }

                    function handleLeaderboardTabChange(e) {
                        // Remove active class from all tabs
                        leaderboardTabs.forEach(tab => tab.classList.remove('active'));
                        
                        // Add active class to clicked tab
                        e.target.classList.add('active');
                        
                        // Update current type and reload leaderboard
                        currentLeaderboardType = e.target.dataset.type;
                        loadLeaderboard();
                    }

                    async function handleExportData() {
                        if (!currentServerId) return;

                        try {
                            exportButton.disabled = true;
                            exportButton.innerHTML = '<span class="btn-icon">⏳</span> Exporting...';

                            const response = await fetch(\`/api/plugins/leveling/export/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to export data');

                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = \`leveling-data-\${currentServerId}-\${Date.now()}.json\`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);

                            showNotification('Data exported successfully!', 'success');
                        } catch (error) {
                            console.error('Error exporting data:', error);
                            showNotification('Failed to export data', 'error');
                        } finally {
                            exportButton.disabled = false;
                            exportButton.innerHTML = '<span class="btn-icon">📤</span> Export Data';
                        }
                    }

                    function handleResetSettings() {
                        if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
                            return;
                        }

                        // Reset form to defaults
                        document.getElementById('xpSourceMessages').checked = true;
                        document.getElementById('xpSourceVoice').checked = true;
                        document.getElementById('xpSourceReactions').checked = true;
                        document.getElementById('xpMultiplier').value = 1.0;
                        document.getElementById('levelUpChannel').value = '';
                        document.getElementById('levelUpMessage').value = '🎉 {user} reached level {level}!';

                        showNotification('Settings reset to defaults. Remember to save!', 'info');
                    }

                    async function handleXpManagement(e) {
                        const action = e.target.closest('button').dataset.action;
                        const userId = adminUserId.value.trim();
                        const amount = parseInt(adminXpAmount.value);

                        if (!userId || !amount || amount < 1) {
                            showNotification('Please enter a valid User ID and XP amount', 'error');
                            return;
                        }

                        if (!currentServerId) {
                            showNotification('Please select a server first', 'error');
                            return;
                        }

                        const button = e.target.closest('button');
                        const originalHTML = button.innerHTML;
                        button.disabled = true;
                        button.innerHTML = '<span class="btn-icon">⏳</span> Processing...';

                        try {
                            const response = await fetch(\`/api/plugins/leveling/manage-xp/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId, amount, action })
                            });

                            const result = await response.json();

                            if (!response.ok) {
                                throw new Error(result.error || 'Failed to manage XP');
                            }

                            showNotification(result.message, 'success');
                            
                            // Clear form
                            adminUserId.value = '';
                            adminXpAmount.value = '';
                            
                            // Refresh stats and leaderboard
                            await Promise.all([loadStats(), loadLeaderboard()]);
                        } catch (error) {
                            console.error('Error managing XP:', error);
                            showNotification(error.message || 'Failed to manage XP', 'error');
                        } finally {
                            button.disabled = false;
                            button.innerHTML = originalHTML;
                        }
                    }

                    async function updateStats() {
                        if (currentServerId) {
                            await loadStats();
                        }
                    }

                    // Helper function for notifications
                    function showNotification(message, type = 'info') {
                        if (window.dashboardAPI?.showNotification) {
                            window.dashboardAPI.showNotification(message, type);
                        } else {
                            console.log(\`[\${type.toUpperCase()}] \${message}\`);
                        }
                    }

                    // Initialize plugin when DOM is ready
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', init);
                    } else {
                        init();
                    }
                })();
            `
        };
    }
}

module.exports = LevelingPlugin;