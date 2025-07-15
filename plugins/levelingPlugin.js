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
            try {
                await fs.access(this.dataPath);
            } catch {
                await fs.writeFile(this.dataPath, JSON.stringify({ users: {} }, null, 2));
            }

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
        // Get leveling statistics
        this.app.get('/api/plugins/leveling/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                const data = await this.loadData();
                const settings = await this.loadSettings();
                
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
                const { userId, amount, action } = req.body;
                
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
            
            if (!oldState.channelId && newState.channelId) {
                this.voiceSessions = this.voiceSessions || {};
                this.voiceSessions[`${guildId}-${newState.id}`] = Date.now();
            }
            
            if (oldState.channelId && !newState.channelId) {
                const sessionKey = `${guildId}-${newState.id}`;
                if (this.voiceSessions?.[sessionKey]) {
                    const sessionTime = Math.floor((Date.now() - this.voiceSessions[sessionKey]) / 60000);
                    delete this.voiceSessions[sessionKey];
                    
                    if (sessionTime >= 1) {
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

        // Slash commands
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
                    type: 6,
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
                        type: 3,
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
                        type: 4,
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
            id: 'leveling',
            name: 'Leveling System',
            description: 'XP and leveling system with multiple sources and leaderboards',
            icon: '📈',
            containerId: 'levelingPluginContainer',
            html: `<div class="plugin-container"><div class="page-header"><div><h1 class="page-title">Leveling System</h1><p class="page-subtitle">Configure XP sources, view leaderboards, and manage user levels</p></div><div><button id="exportLevelingData" class="btn btn-secondary">📤 Export Data</button></div></div><div class="stats-section"><div class="stats-grid"><div class="stat-card"><div class="stat-icon" style="background: linear-gradient(135deg, #4f46e5, #7c3aed);">📊</div><div class="stat-content"><div class="stat-value" id="activeUsersCount">0</div><div class="stat-label">Active Users</div></div></div><div class="stat-card"><div class="stat-icon" style="background: linear-gradient(135deg, #22c55e, #16a34a);">⭐</div><div class="stat-content"><div class="stat-value" id="totalXPCount">0</div><div class="stat-label">Total XP</div></div></div><div class="stat-card"><div class="stat-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">🎯</div><div class="stat-content"><div class="stat-value" id="maxLevelCount">0</div><div class="stat-label">Highest Level</div></div></div><div class="stat-card"><div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">🎤</div><div class="stat-content"><div class="stat-value" id="voiceTimeCount">0</div><div class="stat-label">Voice Minutes</div></div></div></div></div><div class="widget"><div class="widget-header"><h3>⚙️ Leveling Settings</h3><span id="levelingStatus" class="status-badge status-inactive">Disabled</span></div><div class="widget-content"><form id="levelingSettingsForm"><div class="form-row"><div class="form-group"><label>XP Sources</label><div class="checkbox-group"><label><input type="checkbox" id="xpSourceMessages"> 💬 Messages (10-25 XP)</label><label><input type="checkbox" id="xpSourceVoice"> 🎤 Voice Activity (1 XP/min)</label><label><input type="checkbox" id="xpSourceReactions"> 😄 Reactions (2 XP each)</label></div></div><div class="form-group"><label for="xpMultiplier">XP Multiplier</label><input type="number" id="xpMultiplier" class="form-control" min="0.1" max="10" step="0.1" value="1.0"><small>Multiply all XP gains (0.1x to 10x)</small></div></div><div class="form-row"><div class="form-group"><label for="levelUpChannel">Level Up Channel</label><select id="levelUpChannel" class="form-control"><option value="">Select a channel...</option></select></div><div class="form-group"><label for="levelUpMessage">Level Up Message</label><input type="text" id="levelUpMessage" class="form-control" placeholder="🎉 {user} reached level {level}!" value="🎉 {user} reached level {level}!"><small>Use {user} and {level} placeholders</small></div></div><div class="btn-group"><button type="submit" id="saveLevelingSettings" class="btn btn-primary">💾 Save Settings</button><button type="button" id="resetLevelingSettings" class="btn btn-secondary">🔄 Reset</button></div></form></div></div><div class="widget"><div class="widget-header"><h3>🏆 Leaderboards</h3><div class="leaderboard-tabs"><button class="tab-btn active" data-type="overall">Overall XP</button><button class="tab-btn" data-type="voice">Voice Activity</button><button class="tab-btn" data-type="reactions">Reactions</button></div></div><div class="widget-content"><div id="leaderboardContent"><div id="leaderboardLoading" style="display: none;">Loading leaderboard...</div><div id="leaderboardList"></div></div></div></div><div class="widget"><div class="widget-header"><h3>👑 Admin Management</h3></div><div class="widget-content"><div class="form-row"><div class="form-group"><label for="adminUserId">User ID</label><input type="text" id="adminUserId" class="form-control" placeholder="Enter Discord User ID"></div><div class="form-group"><label for="adminXpAmount">XP Amount</label><input type="number" id="adminXpAmount" class="form-control" placeholder="Enter XP amount" min="1"></div></div><div class="btn-group"><button id="addXpBtn" class="btn btn-success" data-action="add">➕ Add XP</button><button id="removeXpBtn" class="btn btn-warning" data-action="remove">➖ Remove XP</button><button id="setXpBtn" class="btn btn-danger" data-action="set">🎯 Set XP</button></div></div></div></div>`,
            script: `(function(){console.log("📈 Leveling Plugin script starting...");let a=null,b="overall",c={};const d=document.getElementById("serverDropdown");function e(){console.log("🚀 Leveling Plugin initializing..."),f(),d&&d.value&&(a=d.value,g())}function f(){d&&d.addEventListener("change",h);const e=document.getElementById("levelingSettingsForm");e&&e.addEventListener("submit",i),document.addEventListener("click",function(a){const c=a.target.closest(".tab-btn");c&&c.dataset.type&&j(a)});const f=document.getElementById("exportLevelingData");f&&f.addEventListener("click",k);const g=document.getElementById("resetLevelingSettings");g&&g.addEventListener("click",l);["addXpBtn","removeXpBtn","setXpBtn"].forEach(a=>{const b=document.getElementById(a);b&&b.addEventListener("click",m)}),setInterval(n,3e4)}async function g(){a&&await Promise.all([o(),p(),q(),r()])}async function h(){a=d.value,a&&await g()}async function o(){if(!a)return;try{const b=await fetch("/api/plugins/leveling/settings/"+a);if(!b.ok)throw new Error("Failed to load settings");c=await b.json(),s(),t()}catch(a){console.error("Error loading settings:",a)}}async function p(){if(!a)return;try{const b=await fetch("/api/plugins/leveling/stats/"+a);if(!b.ok)throw new Error("Failed to load stats");const c=await b.json();u(c)}catch(a){console.error("Error loading stats:",a)}}async function q(){if(!a)return;try{const b=await fetch("/api/channels/"+a);if(!b.ok)throw new Error("Failed to load channels");const c=await b.json();v(c)}catch(a){console.error("Error loading channels:",a)}}async function r(){if(!a)return;const c=document.getElementById("leaderboardLoading"),d=document.getElementById("leaderboardList");c&&(c.style.display="block"),d&&(d.innerHTML="");try{const c=await fetch("/api/plugins/leveling/leaderboard/"+a+"?type="+b+"&limit=10");if(!c.ok)throw new Error("Failed to load leaderboard");const e=await c.json();w(e)}catch(a){console.error("Error loading leaderboard:",a),d&&(d.innerHTML='<div class="empty-state">Failed to load leaderboard</div>')}finally{c&&(c.style.display="none")}}function s(){const a={xpSourceMessages:c.xpSources?.messages||!1,xpSourceVoice:c.xpSources?.voice||!1,xpSourceReactions:c.xpSources?.reactions||!1,xpMultiplier:c.xpMultiplier||1,levelUpChannel:c.levelUpChannel||"",levelUpMessage:c.levelUpMessage||"🎉 {user} reached level {level}!"};Object.keys(a).forEach(b=>{const c=document.getElementById(b);c&&("checkbox"===c.type?c.checked=a[b]:c.value=a[b])})}function v(a){const b=document.getElementById("levelUpChannel");b&&(b.innerHTML='<option value="">Select a channel...</option>',a.forEach(a=>{if(0===a.type){const c=document.createElement("option");c.value=a.id,c.textContent="#"+a.name,b.appendChild(c)}}),c.levelUpChannel&&(b.value=c.levelUpChannel))}function u(a){const b={activeUsersCount:a.serverUsers||0,totalXPCount:a.totalXP||0,maxLevelCount:a.maxLevel||0,voiceTimeCount:Math.floor(a.totalVoiceTime||0)};Object.keys(b).forEach(a=>{const c=document.getElementById(a);if(c){const d=b[a];c.textContent="number"==typeof d?d.toLocaleString():d}})}function t(){const a=document.getElementById("levelingStatus");if(!a)return;const b=c.xpSources?.messages||c.xpSources?.voice||c.xpSources?.reactions;b?(a.textContent="Active",a.className="status-badge status-active"):(a.textContent="Disabled",a.className="status-badge status-inactive")}function w(a){const c=document.getElementById("leaderboardList");if(!c)return;if(!a||0===a.length)return void(c.innerHTML='<div class="empty-state">No data available</div>');const d=a.map((a,c)=>{const d=c+1,e=1===d?"🥇":2===d?"🥈":3===d?"🥉":"📍",f=a.value||0;let g;switch(b){case"voice":g=f+" minutes";break;case"reactions":g=f+" reactions";break;default:g=f.toLocaleString()+" XP"}const h=a.displayName||a.username||"Unknown User",i=a.avatar,j=a.level||0,k=a.progressToNext||0;return'<div class="leaderboard-item"><div class="rank">'+e+'</div><div class="member-info"><div class="member-avatar">'+(i?'<img src="'+i+'" alt="'+h+'">':h.charAt(0).toUpperCase())+'</div><div class="member-details"><div class="member-name">'+h+'</div><div class="member-stats">'+g+"</div></div></div>"+("overall"===b?'<div class="member-progress"><div class="progress-bar"><div class="progress-fill" style="width: '+k+'%"></div></div><small style="color: var(--text-muted); font-size: 11px;">Level '+j+"</small></div>":"")+"</div>"}).join("");c.innerHTML=d}async function i(b){if(b.preventDefault(),!a)return;const d=document.getElementById("saveLevelingSettings");d&&(d.disabled=!0,d.textContent="Saving...");try{const b={xpSources:{messages:document.getElementById("xpSourceMessages").checked,voice:document.getElementById("xpSourceVoice").checked,reactions:document.getElementById("xpSourceReactions").checked},xpMultiplier:parseFloat(document.getElementById("xpMultiplier").value)||1,levelUpChannel:document.getElementById("levelUpChannel").value||null,levelUpMessage:document.getElementById("levelUpMessage").value||"🎉 {user} reached level {level}!"},e=await fetch("/api/plugins/leveling/settings/"+a,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});if(!e.ok)throw new Error("Failed to save settings");c=Object.assign(c,b),t(),x("Settings saved successfully!","success")}catch(a){console.error("Error saving settings:",a),x("Failed to save settings","error")}finally{d&&(d.disabled=!1,d.textContent="💾 Save Settings")}}function j(a){document.querySelectorAll(".tab-btn").forEach(a=>{a.classList.remove("active")}),a.target.classList.add("active"),b=a.target.dataset.type,r()}async function k(){if(!a)return;try{const b=document.getElementById("exportLevelingData");b&&(b.disabled=!0,b.textContent="Exporting...");const c=await fetch("/api/plugins/leveling/export/"+a);if(!c.ok)throw new Error("Failed to export data");const d=await c.blob(),e=window.URL.createObjectURL(d),f=document.createElement("a");f.href=e,f.download="leveling-data-"+a+"-"+Date.now()+".json",document.body.appendChild(f),f.click(),document.body.removeChild(f),window.URL.revokeObjectURL(e),x("Data exported successfully!","success")}catch(a){console.error("Error exporting data:",a),x("Failed to export data","error")}finally{const a=document.getElementById("exportLevelingData");a&&(a.disabled=!1,a.textContent="📤 Export Data")}}function l(){confirm("Are you sure you want to reset all settings to defaults?")&&(document.getElementById("xpSourceMessages").checked=!0,document.getElementById("xpSourceVoice").checked=!0,document.getElementById("xpSourceReactions").checked=!0,document.getElementById("xpMultiplier").value=1,document.getElementById("levelUpChannel").value="",document.getElementById("levelUpMessage").value="🎉 {user} reached level {level}!",x("Settings reset to defaults. Remember to save!","info"))}async function m(b){const c=b.target.dataset.action,d=document.getElementById("adminUserId").value.trim(),e=parseInt(document.getElementById("adminXpAmount").value);if(!d||!e||e<1)return void x("Please enter a valid User ID and XP amount","error");if(!a)return void x("Please select a server first","error");const f=b.target,g=f.textContent;f.disabled=!0,f.textContent="Processing...";try{const b=await fetch("/api/plugins/leveling/manage-xp/"+a,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:d,amount:e,action:c})}),g=await b.json();if(!b.ok)throw new Error(g.error||"Failed to manage XP");x(g.message,"success"),document.getElementById("adminUserId").value="",document.getElementById("adminXpAmount").value="",await Promise.all([p(),r()])}catch(a){console.error("Error managing XP:",a),x(a.message||"Failed to manage XP","error")}finally{f.disabled=!1,f.textContent=g}}async function n(){a&&await p()}function x(a,b){window.dashboardAPI&&window.dashboardAPI.showNotification?window.dashboardAPI.showNotification(a,b):console.log("["+b.toUpperCase()+"] "+a)}setTimeout(e,200)})();`
        };
    }
}

module.exports = LevelingPlugin;