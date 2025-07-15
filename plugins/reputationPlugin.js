const fs = require('fs').promises;
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

class ReputationPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Reputation System';
        this.description = 'Advanced reputation system with categories, reasons, decay, and anti-abuse features';
        this.version = '2.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // File paths
        this.dataFile = './data/reputationData.json';
        this.settingsFile = './data/reputationSettings.json';
        this.auditFile = './data/reputationAudit.json';
        
        // Ensure data directory exists
        this.ensureDataDirectory();
        
        // Initialize data and setup
        this.initializeData();
        this.setupRoutes();
        this.setupDiscordListeners();
        
        console.log('✅ Reputation System Plugin v2.0 loaded with dashboard integration');
    }

    // ============================================================================
    // CENTRALIZED SLASH COMMANDS (for plugin loader)
    // ============================================================================

    getSlashCommands() {
        const { SlashCommandBuilder } = require('discord.js');
        
        return [
            new SlashCommandBuilder()
                .setName('rep')
                .setDescription('View or give reputation to a user')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('view')
                        .setDescription('View a users reputation')
                        .addUserOption(option => 
                            option.setName('user')
                                .setDescription('User to view reputation for')
                                .setRequired(false)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('give')
                        .setDescription('Give reputation to a user')
                        .addUserOption(option => 
                            option.setName('user')
                                .setDescription('User to give reputation to')
                                .setRequired(true))
                        .addStringOption(option =>
                            option.setName('category')
                                .setDescription('Category of reputation')
                                .setRequired(true)
                                .addChoices(
                                    { name: 'Helpfulness', value: 'helpfulness' },
                                    { name: 'Creativity', value: 'creativity' },
                                    { name: 'Reliability', value: 'reliability' },
                                    { name: 'Community Spirit', value: 'community' },
                                    { name: 'Legacy', value: 'legacy' }
                                ))
                        .addStringOption(option =>
                            option.setName('reason')
                                .setDescription('Reason for giving reputation')
                                .setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('leaderboard')
                        .setDescription('View reputation leaderboard')
                        .addStringOption(option =>
                            option.setName('type')
                                .setDescription('Type of leaderboard')
                                .setRequired(false)
                                .addChoices(
                                    { name: 'Overall', value: 'total' },
                                    { name: 'Helpfulness', value: 'helpfulness' },
                                    { name: 'Creativity', value: 'creativity' },
                                    { name: 'Reliability', value: 'reliability' },
                                    { name: 'Community Spirit', value: 'community' },
                                    { name: 'Legacy', value: 'legacy' }
                                )))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('history')
                        .setDescription('View your reputation history')),
            
            new SlashCommandBuilder()
                .setName('thanks')
                .setDescription('Thank a user and give them reputation')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to thank')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for thanking')
                        .setRequired(false))
        ].map(command => command.toJSON());
    }

    // ============================================================================
    // DISCORD EVENT LISTENERS
    // ============================================================================

    setupDiscordListeners() {
        // Handle slash command interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            
            if (interaction.commandName === 'rep' || interaction.commandName === 'thanks') {
                await this.handleSlashCommand(interaction);
            }
        });

        // Auto-detect thanks messages
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;
            
            const settings = await this.getGuildSettings(message.guild.id);
            if (!settings.enabled || !settings.autoThanks) return;
            
            await this.handleThanksMessage(message, settings);
        });

        // Reaction-based reputation
        this.client.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot || !reaction.message.guild) return;
            
            const settings = await this.getGuildSettings(reaction.message.guild.id);
            if (!settings.enabled || !settings.reactionRep) return;
            
            if (settings.repEmoji === reaction.emoji.name || settings.repEmoji === reaction.emoji.id) {
                try {
                    await this.giveReputation(
                        reaction.message.guild.id,
                        user.id,
                        reaction.message.author.id,
                        'helpfulness',
                        1,
                        'Helpful reaction',
                        'reaction'
                    );
                } catch (error) {
                    console.error('Error giving reaction reputation:', error);
                }
            }
        });

        // Handle button interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton() || !interaction.customId.startsWith('rep_')) return;
            await this.handleReputationInteraction(interaction);
        });

        // Handle modal interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isModalSubmit() || !interaction.customId.startsWith('rep_reason_')) return;
            await this.handleReasonModal(interaction);
        });
    }

    // ============================================================================
    // SLASH COMMAND HANDLERS
    // ============================================================================

    async handleSlashCommand(interaction) {
        const { commandName } = interaction;
        
        try {
            if (commandName === 'rep') {
                await this.handleRepCommand(interaction);
            } else if (commandName === 'thanks') {
                await this.handleThanksCommand(interaction);
            }
        } catch (error) {
            console.error(\`Error handling \${commandName} command:\`, error);
            
            try {
                const errorMessage = '❌ An error occurred while processing your command.';
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                console.error('Error sending error message:', replyError);
            }
        }
    }

    async handleRepCommand(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'view') {
            await this.handleRepView(interaction);
        } else if (subcommand === 'give') {
            await this.handleRepGive(interaction);
        } else if (subcommand === 'leaderboard') {
            await this.handleRepLeaderboard(interaction);
        } else if (subcommand === 'history') {
            await this.handleRepHistory(interaction);
        }
    }

    async handleRepView(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const data = await this.loadData();
        
        const userRep = this.getUserData(data, interaction.guild.id, targetUser.id);
        const settings = await this.getGuildSettings(interaction.guild.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(\`\${settings.customName || 'Reputation'} for \${targetUser.username}\`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Total', value: userRep.total.toString(), inline: true },
                { name: 'Given', value: userRep.given.toString(), inline: true },
                { name: 'Received', value: userRep.received.toString(), inline: true }
            )
            .setTimestamp();

        // Add category breakdown
        const categories = Object.entries(userRep.categories)
            .filter(([_, value]) => value > 0)
            .map(([category, value]) => \`\${this.getCategoryEmoji(category)} \${category}: \${value}\`)
            .join('\\n');

        if (categories) {
            embed.addFields({ name: 'Categories', value: categories, inline: false });
        }

        await interaction.reply({ embeds: [embed] });
    }

    async handleRepGive(interaction) {
        const targetUser = interaction.options.getUser('user');
        const category = interaction.options.getString('category');
        const reason = interaction.options.getString('reason');

        if (targetUser.id === interaction.user.id) {
            return await interaction.reply({ content: '❌ You cannot give reputation to yourself!', ephemeral: true });
        }

        if (targetUser.bot) {
            return await interaction.reply({ content: '❌ You cannot give reputation to bots!', ephemeral: true });
        }

        try {
            await this.giveReputation(
                interaction.guild.id,
                interaction.user.id,
                targetUser.id,
                category,
                1,
                reason,
                'command'
            );

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Reputation Given!')
                .setDescription(\`You gave **\${targetUser.username}** +1 \${category} reputation!\`)
                .addFields(
                    { name: 'Category', value: \`\${this.getCategoryEmoji(category)} \${category}\`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            await interaction.reply({ content: \`❌ \${error.message}\`, ephemeral: true });
        }
    }

    async handleRepLeaderboard(interaction) {
        const type = interaction.options.getString('type') || 'total';
        const leaderboard = await this.getLeaderboard(interaction.guild.id, type, 10);

        if (leaderboard.length === 0) {
            return await interaction.reply({ content: '📊 No reputation data found for this server.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(\`🏆 \${type.charAt(0).toUpperCase() + type.slice(1)} Reputation Leaderboard\`)
            .setTimestamp();

        const leaderboardText = leaderboard.map((entry, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : \`\${index + 1}.\`;
            return \`\${medal} <@\${entry.userId}> - \${entry.score} points\`;
        }).join('\\n');

        embed.setDescription(leaderboardText);

        await interaction.reply({ embeds: [embed] });
    }

    async handleRepHistory(interaction) {
        // Simplified history for now
        const data = await this.loadData();
        const userRep = this.getUserData(data, interaction.guild.id, interaction.user.id);

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('📋 Your Reputation History')
            .addFields(
                { name: 'Total Reputation', value: userRep.total.toString(), inline: true },
                { name: 'Times Given', value: userRep.given.toString(), inline: true },
                { name: 'Times Received', value: userRep.received.toString(), inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleThanksCommand(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Thanks!';

        if (targetUser.id === interaction.user.id) {
            return await interaction.reply({ content: '❌ You cannot thank yourself!', ephemeral: true });
        }

        if (targetUser.bot) {
            return await interaction.reply({ content: '❌ You cannot thank bots!', ephemeral: true });
        }

        try {
            await this.giveReputation(
                interaction.guild.id,
                interaction.user.id,
                targetUser.id,
                'helpfulness',
                1,
                reason,
                'thanks'
            );

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🙏 Thanks Given!')
                .setDescription(\`You thanked **\${targetUser.username}** and gave them +1 helpfulness reputation!\`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            await interaction.reply({ content: \`❌ \${error.message}\`, ephemeral: true });
        }
    }

    // ============================================================================
    // REPUTATION LOGIC
    // ============================================================================

    async giveReputation(guildId, fromUserId, toUserId, category, amount, reason, type = 'manual') {
        const settings = await this.getGuildSettings(guildId);
        
        if (!settings.enabled) {
            throw new Error('Reputation system is disabled for this server');
        }

        // Check cooldown
        const cooldownKey = \`\${fromUserId}-\${toUserId}\`;
        const now = Date.now();
        const lastGiven = this.userCooldowns?.get(cooldownKey) || 0;
        const cooldownTime = (settings.cooldownTime || 60) * 60 * 1000; // Convert minutes to milliseconds

        if (now - lastGiven < cooldownTime && type !== 'admin') {
            const remainingTime = Math.ceil((cooldownTime - (now - lastGiven)) / 60000);
            throw new Error(\`You must wait \${remainingTime} more minutes before giving reputation to this user again.\`);
        }

        // Check daily limit
        const dailyKey = \`\${fromUserId}-\${new Date().toDateString()}\`;
        const dailyCount = this.dailyLimits?.get(dailyKey) || 0;

        if (dailyCount >= (settings.dailyLimit || 10) && type !== 'admin') {
            throw new Error(\`You have reached your daily limit of \${settings.dailyLimit || 10} reputation given.\`);
        }

        // Update reputation
        await this.adjustReputation(guildId, fromUserId, toUserId, category, amount, reason, type);

        // Update cooldowns and limits (with safety checks)
        if (!this.userCooldowns) this.userCooldowns = new Map();
        if (!this.dailyLimits) this.dailyLimits = new Map();
        
        this.userCooldowns.set(cooldownKey, now);
        this.dailyLimits.set(dailyKey, dailyCount + 1);

        // Log the action
        await this.logAuditEvent(guildId, 'reputation_given', fromUserId, toUserId, {
            category,
            amount,
            reason,
            type
        });
    }

    async handleThanksMessage(message, settings) {
        // Check if message mentions users and contains thanks patterns
        const mentions = message.mentions.users.filter(user => !user.bot && user.id !== message.author.id);
        
        if (mentions.size === 0) return;

        const messageContent = message.content.toLowerCase();
        const thanksPatterns = [
            /\\b(thanks?|ty|thx|thank\\s+you|tysm|thks)\\b/i,
            /\\bgrateful\\b/i,
            /\\bappreciat/i,
            /\\bmuch\\s+appreciated\\b/i,
            /\\bthanks?\\s+(so\\s+)?much\\b/i
        ];
        
        const containsThanks = thanksPatterns.some(pattern => pattern.test(messageContent));

        if (!containsThanks) return;

        // For auto-thanks, we could implement a confirmation system here
        // For now, let's just log that thanks was detected
        console.log(\`Thanks detected from \${message.author.username} to \${mentions.size} users\`);
    }

    async handleReputationInteraction(interaction) {
        // Handle button interactions (if needed for future features)
        await interaction.deferUpdate();
    }

    async handleReasonModal(interaction) {
        // Handle modal interactions (if needed for future features)
        await interaction.deferReply();
    }

    getCategoryEmoji(category) {
        const emojis = { 
            helpfulness: '🤝', 
            creativity: '🎨', 
            reliability: '⭐', 
            community: '💝', 
            legacy: '🏛️'
        };
        return emojis[category] || '📊';
        const lastGiven = this.userCooldowns.get(cooldownKey) || 0;
        const cooldownTime = settings.cooldownTime * 60 * 1000; // Convert minutes to milliseconds

        if (now - lastGiven < cooldownTime && type !== 'admin') {
            const remainingTime = Math.ceil((cooldownTime - (now - lastGiven)) / 60000);
            throw new Error(`You must wait ${remainingTime} more minutes before giving reputation to this user again.`);
        }

        // Check daily limit
        const dailyKey = `${fromUserId}-${new Date().toDateString()}`;
        const dailyCount = this.dailyLimits.get(dailyKey) || 0;

        if (dailyCount >= settings.dailyLimit && type !== 'admin') {
            throw new Error(`You have reached your daily limit of ${settings.dailyLimit} reputation given.`);
        }

        // Update reputation
        await this.adjustReputation(guildId, fromUserId, toUserId, category, amount, reason, type);

        // Update cooldowns and limits
        this.userCooldowns.set(cooldownKey, now);
        this.dailyLimits.set(dailyKey, dailyCount + 1);

        // Log the action
        await this.logAuditEvent(guildId, 'reputation_given', fromUserId, toUserId, {
            category,
            amount,
            reason,
            type
        });
    }

    async handleThanksMessage(message, settings) {
        // Check if message mentions users and contains thanks patterns
        const mentions = message.mentions.users.filter(user => !user.bot && user.id !== message.author.id);
        
        if (mentions.size === 0) return;

        const messageContent = message.content.toLowerCase();
        const containsThanks = this.THANKS_PATTERNS.some(pattern => pattern.test(messageContent));

        if (!containsThanks) return;

        // For auto-thanks, we could implement a confirmation system here
        // For now, let's just log that thanks was detected
        console.log(`Thanks detected from ${message.author.username} to ${mentions.size} users`);
    }

    async handleReputationInteraction(interaction) {
        // Handle button interactions (if needed for future features)
        await interaction.deferUpdate();
    }

    async handleReasonModal(interaction) {
        // Handle modal interactions (if needed for future features)
        await interaction.deferReply();
    }

    getCategoryEmoji(category) {
        const emojis = { 
            helpfulness: '🤝', 
            creativity: '🎨', 
            reliability: '⭐', 
            community: '💝', 
            legacy: '🏛️'
        };
        return emojis[category] || '📊';

    async ensureDataDirectory() {
        try {
            await fs.mkdir('./data', { recursive: true });
        } catch (error) {
            console.error('Error creating data directory:', error);
        }
    }

    // ============================================================================
    // DATA MANAGEMENT
    // ============================================================================

    async initializeData() {
        try {
            // Initialize data files if they don't exist
            try {
                await fs.access(this.dataFile);
            } catch {
                await fs.writeFile(this.dataFile, JSON.stringify({
                    users: {},
                    history: {},
                    leaderboards: {}
                }, null, 2));
            }

            try {
                await fs.access(this.settingsFile);
            } catch {
                await fs.writeFile(this.settingsFile, JSON.stringify({}, null, 2));
            }

            try {
                await fs.access(this.auditFile);
            } catch {
                await fs.writeFile(this.auditFile, JSON.stringify({
                    events: []
                }, null, 2));
            }
        } catch (error) {
            console.error('Error initializing reputation data:', error);
        }
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return { users: {}, history: {}, leaderboards: {} };
        }
    }

    async saveData(data) {
        await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
    }

    async loadSettings() {
        try {
            const settings = await fs.readFile(this.settingsFile, 'utf8');
            return JSON.parse(settings);
        } catch (error) {
            return {};
        }
    }

    async saveSettings(settings) {
        await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
    }

    async loadAuditLog() {
        try {
            const audit = await fs.readFile(this.auditFile, 'utf8');
            return JSON.parse(audit);
        } catch (error) {
            return { events: [] };
        }
    }

    async saveAuditLog(auditData) {
        await fs.writeFile(this.auditFile, JSON.stringify(auditData, null, 2));
    }

    getDefaultSettings() {
        return {
            enabled: true,
            autoThanks: false,
            reactionRep: false,
            repEmoji: '👍',
            customName: 'Reputation',
            cooldownTime: 60,
            dailyLimit: 10,
            requireReason: true,
            allowNegative: true,
            logChannel: null,
            roles: {}
        };
    }

    getDefaultUserRep() {
        return {
            total: 0,
            categories: {
                helpfulness: 0,
                creativity: 0,
                reliability: 0,
                community: 0,
                legacy: 0
            },
            given: 0,
            received: 0,
            lastGiven: {},
            dailyGiven: 0,
            dailyReceived: 0,
            lastReset: Date.now()
        };
    }

    getUserData(data, guildId, userId) {
        if (!data.users[userId]) data.users[userId] = {};
        if (!data.users[userId][guildId]) {
            data.users[userId][guildId] = this.getDefaultUserRep();
        }
        return data.users[userId][guildId];
    }

    async getGuildSettings(guildId) {
        const settings = await this.loadSettings();
        return settings[guildId] || this.getDefaultSettings();
    }

    async updateGuildSettings(guildId, newSettings) {
        const settings = await this.loadSettings();
        settings[guildId] = { ...settings[guildId], ...newSettings };
        await this.saveSettings(settings);
    }

    // ============================================================================
    // REPUTATION LOGIC
    // ============================================================================

    async adjustReputation(guildId, fromUserId, toUserId, category, amount, reason, type = 'manual') {
        const data = await this.loadData();
        const settings = await this.getGuildSettings(guildId);
        
        if (!settings.enabled) {
            throw new Error('Reputation system is disabled for this server');
        }

        // Get user data
        const toUserData = this.getUserData(data, guildId, toUserId);
        const fromUserData = fromUserId ? this.getUserData(data, guildId, fromUserId) : null;

        // Validate category
        if (!toUserData.categories.hasOwnProperty(category)) {
            throw new Error('Invalid reputation category');
        }

        // Apply changes
        toUserData.categories[category] += amount;
        toUserData.total += amount;
        toUserData.received++;

        if (fromUserData) {
            fromUserData.given++;
            fromUserData.dailyGiven++;
        }

        // Log audit event
        await this.logAuditEvent(guildId, 'reputation_change', fromUserId, toUserId, {
            category,
            amount,
            reason,
            type
        });

        await this.saveData(data);
        return toUserData;
    }

    async logAuditEvent(guildId, action, fromUserId, toUserId, details, type = 'user') {
        try {
            const auditData = await this.loadAuditLog();
            const event = {
                id: Date.now().toString(),
                guildId,
                action,
                fromUserId,
                toUserId,
                details,
                type,
                timestamp: new Date().toISOString()
            };
            
            auditData.events.unshift(event);
            
            // Keep only last 1000 events
            if (auditData.events.length > 1000) {
                auditData.events = auditData.events.slice(0, 1000);
            }
            
            await this.saveAuditLog(auditData);
        } catch (error) {
            console.error('Error logging audit event:', error);
        }
    }

    // ============================================================================
    // LEADERBOARD & STATS
    // ============================================================================

    async getLeaderboard(guildId, category = 'total', limit = 20) {
        const data = await this.loadData();
        const users = [];
        
        for (const [userId, guilds] of Object.entries(data.users)) {
            if (guilds[guildId]) {
                const userData = guilds[guildId];
                let score;
                
                if (category === 'total') {
                    score = userData.total || 0;
                } else if (userData.categories && userData.categories[category] !== undefined) {
                    score = userData.categories[category];
                } else {
                    continue;
                }
                
                if (score > 0) {
                    users.push({
                        userId,
                        username: null, // Will be populated by frontend
                        avatar: null,   // Will be populated by frontend
                        score,
                        categories: userData.categories || {},
                        total: userData.total || 0
                    });
                }
            }
        }
        
        // Sort by score and limit
        users.sort((a, b) => b.score - a.score);
        return users.slice(0, limit);
    }

    async getServerStats(guildId) {
        const data = await this.loadData();
        let totalUsers = 0;
        let totalReputation = 0;
        let categoriesStats = {
            helpfulness: 0,
            creativity: 0,
            reliability: 0,
            community: 0,
            legacy: 0
        };
        
        for (const [userId, guilds] of Object.entries(data.users)) {
            if (guilds[guildId]) {
                const userData = guilds[guildId];
                totalUsers++;
                totalReputation += userData.total || 0;
                
                for (const [category, amount] of Object.entries(userData.categories || {})) {
                    if (categoriesStats[category] !== undefined) {
                        categoriesStats[category] += amount;
                    }
                }
            }
        }
        
        const averageReputation = totalUsers > 0 ? Math.round(totalReputation / totalUsers * 10) / 10 : 0;
        
        return {
            totalUsers,
            totalReputation,
            averageReputation,
            categoriesStats,
            mostActiveCategory: Object.entries(categoriesStats)
                .sort(([,a], [,b]) => b - a)[0]?.[0] || 'helpfulness'
        };
    }

    // ============================================================================
    // API ROUTES
    // ============================================================================

    setupRoutes() {
        // Get user reputation data
        this.app.get('/api/plugins/reputation/user/:guildId/:userId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, userId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, userId);
                res.json(userData);
            } catch (error) {
                console.error('Error getting user reputation:', error);
                res.status(500).json({ error: 'Failed to get user reputation' });
            }
        });

        // Get leaderboard
        this.app.get('/api/plugins/reputation/leaderboard/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { category = 'total', limit = 20 } = req.query;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const leaderboard = await this.getLeaderboard(guildId, category, parseInt(limit));
                res.json(leaderboard);
            } catch (error) {
                console.error('Error getting leaderboard:', error);
                res.status(500).json({ error: 'Failed to get leaderboard' });
            }
        });

        // Get settings
        this.app.get('/api/plugins/reputation/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
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
        this.app.post('/api/plugins/reputation/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
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

        // Adjust reputation (admin)
        this.app.post('/api/plugins/reputation/adjust/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { userId, category, amount, reason } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                await this.adjustReputation(guildId, req.user.id, userId, category, amount, reason, 'admin');
                res.json({ success: true });
            } catch (error) {
                console.error('Error adjusting reputation:', error);
                res.status(500).json({ error: 'Failed to adjust reputation' });
            }
        });

        // Get server stats
        this.app.get('/api/plugins/reputation/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const stats = await this.getServerStats(guildId);
                res.json(stats);
            } catch (error) {
                console.error('Error getting stats:', error);
                res.status(500).json({ error: 'Failed to get stats' });
            }
        });

        // Get audit log
        this.app.get('/api/plugins/reputation/audit/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const { limit = 50 } = req.query;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const auditData = await this.loadAuditLog();
                const guildEvents = auditData.events
                    .filter(event => event.guildId === guildId)
                    .slice(0, parseInt(limit));
                
                res.json(guildEvents);
            } catch (error) {
                console.error('Error getting audit log:', error);
                res.status(500).json({ error: 'Failed to get audit log' });
            }
        });
    }

    // ============================================================================
    // FRONTEND COMPONENT
    // ============================================================================

    getFrontendComponent() {
        return {
            id: 'reputation-system',
            name: 'Reputation System',
            description: 'Advanced reputation system with categories, reasons, decay, and anti-abuse features',
            icon: '🏆',
            version: '2.0.0',
            containerId: 'reputationPluginContainer',

            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🏆</span> Reputation System v2.0</h3>
                        <p>Advanced reputation system with categories, reasons, decay, and anti-abuse features</p>
                    </div>

                    <!-- Server Integration Notice -->
                    <div class="server-sync-notice" style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🔗</span>
                            <div>
                                <strong>Dashboard Integration</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Managing server: <span id="currentServerName">Auto-detected</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Server Stats -->
                    <div class="stats-section" style="margin-bottom: 24px;">
                        <h4>📊 Server Statistics</h4>
                        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div class="stat-card">
                                <div class="stat-value" id="totalUsers">0</div>
                                <div class="stat-label">Active Users</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="totalReputation">0</div>
                                <div class="stat-label">Total Reputation</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="averageReputation">0</div>
                                <div class="stat-label">Average Rep</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="mostActiveCategory">-</div>
                                <div class="stat-label">Top Category</div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Form -->
                    <form id="reputationSettingsForm" class="settings-form">
                        <div class="settings-section">
                            <h4>⚙️ Settings</h4>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="repEnabled" checked>
                                    Enable Reputation System
                                </label>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="autoThanks">
                                    Auto-detect Thanks Messages
                                </label>
                                <small class="form-text">Automatically prompt for reputation when users thank each other</small>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="reactionRep">
                                    Reaction-based Reputation
                                </label>
                                <div style="margin-top: 8px;">
                                    <label for="repEmoji">Reputation Emoji</label>
                                    <input type="text" id="repEmoji" class="form-control" placeholder="👍" style="width: 80px; display: inline-block; margin-left: 8px;">
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="customName">Custom Name</label>
                                <input type="text" id="customName" class="form-control" placeholder="Reputation">
                                <small class="form-text">Customize what reputation is called in your server</small>
                            </div>

                            <div class="form-group">
                                <label for="cooldownTime">Cooldown (minutes)</label>
                                <input type="number" id="cooldownTime" class="form-control" min="1" max="1440" value="60">
                                <small class="form-text">Time between giving reputation to the same user</small>
                            </div>

                            <div class="form-group">
                                <label for="dailyLimit">Daily Limit</label>
                                <input type="number" id="dailyLimit" class="form-control" min="1" max="100" value="10">
                                <small class="form-text">Maximum reputation a user can give per day</small>
                            </div>

                            <div class="form-group">
                                <label for="logChannel">Log Channel</label>
                                <select id="logChannel" class="form-control">
                                    <option value="">No logging</option>
                                </select>
                                <small class="form-text">Channel where reputation changes will be logged</small>
                            </div>
                        </div>

                        <button type="submit" id="saveReputationSettings" class="btn btn-primary">
                            <span class="btn-text">💾 Save Settings</span>
                            <span class="btn-loader" style="display: none;">⏳ Saving...</span>
                        </button>
                    </form>

                    <!-- Leaderboard Section -->
                    <div class="leaderboard-section" style="margin-top: 32px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4>🏆 Leaderboard</h4>
                            <div style="display: flex; gap: 8px;">
                                <select id="leaderboardCategory" class="form-control" style="width: auto;">
                                    <option value="total">Overall</option>
                                    <option value="helpfulness">Helpfulness</option>
                                    <option value="creativity">Creativity</option>
                                    <option value="reliability">Reliability</option>
                                    <option value="community">Community</option>
                                    <option value="legacy">Legacy</option>
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
                        <h4>🛠️ Admin Tools</h4>
                        
                        <div class="admin-tools-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                            <div class="admin-tool">
                                <h5>Adjust User Reputation</h5>
                                <div class="form-group">
                                    <label for="adminUserId">User ID</label>
                                    <input type="text" id="adminUserId" class="form-control" placeholder="Enter user ID">
                                </div>
                                <div class="form-group">
                                    <label for="adminCategory">Category</label>
                                    <select id="adminCategory" class="form-control">
                                        <option value="helpfulness">Helpfulness</option>
                                        <option value="creativity">Creativity</option>
                                        <option value="reliability">Reliability</option>
                                        <option value="community">Community</option>
                                        <option value="legacy">Legacy</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="adminAmount">Amount (+ or -)</label>
                                    <input type="number" id="adminAmount" class="form-control" placeholder="e.g. 5 or -2">
                                </div>
                                <div class="form-group">
                                    <label for="adminReason">Reason</label>
                                    <input type="text" id="adminReason" class="form-control" placeholder="Reason for adjustment">
                                </div>
                                <button type="button" id="adjustRepBtn" class="btn btn-primary btn-sm">
                                    <span class="btn-text">✏️ Adjust Reputation</span>
                                    <span class="btn-loader" style="display: none;">⏳</span>
                                </button>
                            </div>
                            
                            <div class="admin-tool">
                                <h5>User Lookup</h5>
                                <div class="form-group">
                                    <label for="lookupUserId">User ID</label>
                                    <input type="text" id="lookupUserId" class="form-control" placeholder="Enter user ID">
                                </div>
                                <button type="button" id="lookupUserBtn" class="btn btn-secondary btn-sm">
                                    <span class="btn-text">🔍 Lookup User</span>
                                    <span class="btn-loader" style="display: none;">⏳</span>
                                </button>
                                <div id="userLookupResult" style="margin-top: 12px;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Result Messages -->
                    <div id="reputationResult" class="result-message" style="display: none;"></div>
                </div>
            `,
            
            script: `
                // Enhanced Reputation System Plugin Frontend Logic
                (function() {
                    console.log('🏆 Enhanced Reputation System Plugin: Initializing...');
                    
                    // Get DOM elements
                    const currentServerName = document.getElementById('currentServerName');
                    const reputationSettingsForm = document.getElementById('reputationSettingsForm');
                    const repEnabled = document.getElementById('repEnabled');
                    const autoThanks = document.getElementById('autoThanks');
                    const reactionRep = document.getElementById('reactionRep');
                    const repEmoji = document.getElementById('repEmoji');
                    const customName = document.getElementById('customName');
                    const cooldownTime = document.getElementById('cooldownTime');
                    const dailyLimit = document.getElementById('dailyLimit');
                    const logChannel = document.getElementById('logChannel');
                    const saveReputationSettings = document.getElementById('saveReputationSettings');
                    
                    // Stats elements
                    const totalUsers = document.getElementById('totalUsers');
                    const totalReputation = document.getElementById('totalReputation');
                    const averageReputation = document.getElementById('averageReputation');
                    const mostActiveCategory = document.getElementById('mostActiveCategory');
                    
                    // Leaderboard elements
                    const leaderboardCategory = document.getElementById('leaderboardCategory');
                    const refreshLeaderboard = document.getElementById('refreshLeaderboard');
                    const leaderboardContent = document.getElementById('leaderboardContent');
                    const leaderboardLoading = document.getElementById('leaderboardLoading');
                    const leaderboardList = document.getElementById('leaderboardList');
                    
                    // Admin elements
                    const adminUserId = document.getElementById('adminUserId');
                    const adminCategory = document.getElementById('adminCategory');
                    const adminAmount = document.getElementById('adminAmount');
                    const adminReason = document.getElementById('adminReason');
                    const adjustRepBtn = document.getElementById('adjustRepBtn');
                    const lookupUserId = document.getElementById('lookupUserId');
                    const lookupUserBtn = document.getElementById('lookupUserBtn');
                    const userLookupResult = document.getElementById('userLookupResult');
                    
                    // Result message
                    const reputationResult = document.getElementById('reputationResult');
                    
                    // State variables
                    let currentServerId = null;
                    let currentSettings = {};
                    let channels = [];
                    
                    // Initialize plugin
                    function initializeReputationPlugin() {
                        console.log('🏆 Initializing Reputation Plugin...');
                        setupEventListeners();
                        
                        // Check for dashboard integration
                        if (window.dashboardAPI && window.dashboardAPI.getCurrentServer) {
                            currentServerId = window.dashboardAPI.getCurrentServer();
                            console.log('🏆 Dashboard integration found, server:', currentServerId);
                            
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
                                console.log('🏆 Reputation plugin: Server changed to', serverId);
                                
                                if (serverId) {
                                    loadServerData();
                                }
                            };
                        }
                    }
                    
                    // Setup event listeners
                    function setupEventListeners() {
                        // Settings form
                        if (reputationSettingsForm) {
                            reputationSettingsForm.addEventListener('submit', handleSettingsSave);
                        }
                        
                        // Leaderboard controls
                        if (leaderboardCategory) {
                            leaderboardCategory.addEventListener('change', loadLeaderboard);
                        }
                        
                        if (refreshLeaderboard) {
                            refreshLeaderboard.addEventListener('click', loadLeaderboard);
                        }
                        
                        // Admin tools
                        if (adjustRepBtn) {
                            adjustRepBtn.addEventListener('click', handleAdjustReputation);
                        }
                        
                        if (lookupUserBtn) {
                            lookupUserBtn.addEventListener('click', handleUserLookup);
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
                        if (!logChannel) return;
                        
                        logChannel.innerHTML = '<option value="">No logging</option>';
                        
                        const textChannels = channels.filter(channel => channel.type === 0);
                        textChannels.forEach(channel => {
                            const option = document.createElement('option');
                            option.value = channel.id;
                            option.textContent = '#' + channel.name;
                            logChannel.appendChild(option);
                        });
                    }
                    
                    // Load settings
                    async function loadSettings() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/reputation/settings/\${currentServerId}\`);
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
                        if (repEnabled) repEnabled.checked = currentSettings.enabled !== false;
                        if (autoThanks) autoThanks.checked = currentSettings.autoThanks === true;
                        if (reactionRep) reactionRep.checked = currentSettings.reactionRep === true;
                        if (repEmoji) repEmoji.value = currentSettings.repEmoji || '👍';
                        if (customName) customName.value = currentSettings.customName || 'Reputation';
                        if (cooldownTime) cooldownTime.value = currentSettings.cooldownTime || 60;
                        if (dailyLimit) dailyLimit.value = currentSettings.dailyLimit || 10;
                        if (logChannel) logChannel.value = currentSettings.logChannel || '';
                    }
                    
                    // Load stats
                    async function loadStats() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/reputation/stats/\${currentServerId}\`);
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
                        if (totalReputation) totalReputation.textContent = stats.totalReputation?.toLocaleString() || '0';
                        if (averageReputation) averageReputation.textContent = stats.averageReputation?.toString() || '0';
                        if (mostActiveCategory) {
                            const categoryName = stats.mostActiveCategory || 'helpfulness';
                            const emoji = getCategoryEmoji(categoryName);
                            mostActiveCategory.textContent = \`\${emoji} \${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)}\`;
                        }
                    }
                    
                    // Get category emoji
                    function getCategoryEmoji(category) {
                        const emojis = { 
                            helpfulness: '🤝', 
                            creativity: '🎨', 
                            reliability: '⭐', 
                            community: '💝', 
                            legacy: '🏛️'
                        };
                        return emojis[category] || '📊';
                    }
                    
                    // Load leaderboard
                    async function loadLeaderboard() {
                        if (!currentServerId || !leaderboardCategory) return;
                        
                        try {
                            showLeaderboardLoading(true);
                            
                            const category = leaderboardCategory.value || 'total';
                            const response = await fetch(\`/api/plugins/reputation/leaderboard/\${currentServerId}?category=\${category}&limit=20\`);
                            
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
                            const score = entry.score || 0;
                            const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : \`#\${rank}\`;
                            
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
                                    <div style="background: rgba(251, 191, 36, 0.2); color: #FBBF24; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">
                                        \${emoji}
                                    </div>
                                    <div style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;">
                                        \${userInfo.avatar ? \`<img src="\${userInfo.avatar}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover;">\` : '👤'}
                                    </div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 500; margin-bottom: 2px;">\${userInfo.username}</div>
                                        <div style="opacity: 0.7; font-size: 0.9em;">Total: \${entry.total?.toLocaleString() || 0} reputation</div>
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 18px; font-weight: bold; color: #FBBF24;">\${score.toLocaleString()}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">Points</div>
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
                                <div style="font-size: 24px; margin-bottom: 8px;">🏆</div>
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
                        
                        const btnText = saveReputationSettings?.querySelector('.btn-text');
                        const btnLoader = saveReputationSettings?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (saveReputationSettings) saveReputationSettings.disabled = true;
                            
                            const settings = {
                                enabled: repEnabled?.checked !== false,
                                autoThanks: autoThanks?.checked === true,
                                reactionRep: reactionRep?.checked === true,
                                repEmoji: repEmoji?.value || '👍',
                                customName: customName?.value || 'Reputation',
                                cooldownTime: parseInt(cooldownTime?.value || 60),
                                dailyLimit: parseInt(dailyLimit?.value || 10),
                                logChannel: logChannel?.value || null
                            };
                            
                            const response = await fetch(\`/api/plugins/reputation/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settings)
                            });
                            
                            if (!response.ok) throw new Error('Failed to save settings');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult('Reputation settings saved successfully!', 'success');
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification('Reputation settings saved', 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', 'Reputation settings updated');
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
                            if (saveReputationSettings) saveReputationSettings.disabled = false;
                        }
                    }
                    
                    // Handle reputation adjustment
                    async function handleAdjustReputation() {
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
                        const userId = adminUserId?.value?.trim()?.replace(/[<@!>]/g, '');
                        const category = adminCategory?.value;
                        const amount = parseInt(adminAmount?.value);
                        const reason = adminReason?.value?.trim();
                        
                        if (!userId || !category || isNaN(amount) || !reason) {
                            showResult('Please fill in all fields', 'error');
                            return;
                        }
                        
                        const btnText = adjustRepBtn?.querySelector('.btn-text');
                        const btnLoader = adjustRepBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (adjustRepBtn) adjustRepBtn.disabled = true;
                            
                            const response = await fetch(\`/api/plugins/reputation/adjust/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId, category, amount, reason })
                            });
                            
                            if (!response.ok) throw new Error('Failed to adjust reputation');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult(\`Successfully \${amount > 0 ? 'added' : 'removed'} \${Math.abs(amount)} reputation \${amount > 0 ? 'to' : 'from'} user\`, 'success');
                                
                                // Clear form
                                if (adminUserId) adminUserId.value = '';
                                if (adminAmount) adminAmount.value = '';
                                if (adminReason) adminReason.value = '';
                                
                                // Refresh data
                                await Promise.all([loadStats(), loadLeaderboard()]);
                                
                                if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                    window.dashboardAPI.showNotification('Reputation adjusted successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to adjust reputation');
                            }
                            
                        } catch (error) {
                            console.error('Error adjusting reputation:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (adjustRepBtn) adjustRepBtn.disabled = false;
                        }
                    }
                    
                    // Handle user lookup
                    async function handleUserLookup() {
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
                        const userId = lookupUserId?.value?.trim()?.replace(/[<@!>]/g, '');
                        
                        if (!userId) {
                            showResult('Please enter a user ID', 'error');
                            return;
                        }
                        
                        const btnText = lookupUserBtn?.querySelector('.btn-text');
                        const btnLoader = lookupUserBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (lookupUserBtn) lookupUserBtn.disabled = true;
                            
                            const response = await fetch(\`/api/plugins/reputation/user/\${currentServerId}/\${userId}\`);
                            
                            if (!response.ok) throw new Error('Failed to lookup user');
                            
                            const userData = await response.json();
                            
                            // Display user data
                            if (userLookupResult) {
                                userLookupResult.innerHTML = \`
                                    <div style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; margin-top: 12px;">
                                        <h6>User Reputation Data</h6>
                                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px;">
                                            <div style="text-align: center; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
                                                <div style="font-weight: bold; color: #FBBF24;">\${userData.total || 0}</div>
                                                <div style="font-size: 12px; opacity: 0.7;">Total</div>
                                            </div>
                                            <div style="text-align: center; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
                                                <div style="font-weight: bold; color: #10B981;">\${userData.received || 0}</div>
                                                <div style="font-size: 12px; opacity: 0.7;">Received</div>
                                            </div>
                                            <div style="text-align: center; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
                                                <div style="font-weight: bold; color: #3B82F6;">\${userData.given || 0}</div>
                                                <div style="font-size: 12px; opacity: 0.7;">Given</div>
                                            </div>
                                        </div>
                                        <div>
                                            <strong>Categories:</strong>
                                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 8px;">
                                                \${Object.entries(userData.categories || {}).map(([cat, val]) => \`
                                                    <div style="font-size: 13px; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                                                        \${getCategoryEmoji(cat)} \${cat}: \${val || 0}
                                                    </div>
                                                \`).join('')}
                                            </div>
                                        </div>
                                    </div>
                                \`;
                            }
                            
                        } catch (error) {
                            console.error('Error looking up user:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (userLookupResult) {
                                userLookupResult.innerHTML = \`
                                    <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px; margin-top: 12px;">
                                        <strong style="color: #EF4444;">Error:</strong> \${error.message}
                                    </div>
                                \`;
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (lookupUserBtn) lookupUserBtn.disabled = false;
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!reputationResult) return;
                        
                        reputationResult.textContent = message;
                        reputationResult.className = \`result-message \${type}\`;
                        reputationResult.style.display = 'block';
                        
                        // Auto-hide after 5 seconds
                        setTimeout(() => {
                            reputationResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeReputationPlugin);
                    } else {
                        initializeReputationPlugin();
                    }
                    
                    console.log('✅ Enhanced Reputation System Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = ReputationPlugin;