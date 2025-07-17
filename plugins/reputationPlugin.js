const fs = require('fs').promises;
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

class ReputationPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Reputation System';
        this.description = 'Advanced reputation system with categories, reasons, decay, and anti-abuse features';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // File paths
        this.dataFile = path.join(__dirname, '../data/reputationData.json');
        this.settingsFile = path.join(__dirname, '../data/reputationSettings.json');
        this.auditFile = path.join(__dirname, '../data/reputationAudit.json');
        
        // Constants
        this.REP_CATEGORIES = ['helpfulness', 'creativity', 'reliability', 'community', 'legacy'];
        this.DEFAULT_COOLDOWN = 3600000; // 1 hour
        this.DEFAULT_DAILY_LIMIT = 10;
        this.DEFAULT_WEEKLY_LIMIT = 50;
        this.DECAY_INTERVAL = 86400000; // 24 hours
        this.DECAY_RATE = 0.995; // 0.5% decay per day
        
        // Maps for tracking cooldowns and limits
        this.userCooldowns = new Map();
        this.dailyLimits = new Map();
        this.weeklyLimits = new Map();
        
        // Thanks patterns
        this.THANKS_PATTERNS = [
            /\b(thanks?|ty|thx|thank\s+you|tysm|thks)\b/i,
            /\bgrateful\b/i,
            /\bappreciat/i,
            /\bmuch\s+appreciated\b/i,
            /\bthanks?\s+(so\s+)?much\b/i
        ];
        
        this.initializeData();
        this.setupRoutes();
        this.setupDiscordListeners();
        this.setupSlashCommands();
        
        // Start decay interval
        this.decayInterval = setInterval(() => this.processDecay(), this.DECAY_INTERVAL);
        
        // Reset daily/weekly limits
        this.resetLimitsDaily();
        this.resetLimitsWeekly();
    }

    async initializeData() {
        try {
            const dataDir = path.dirname(this.dataFile);
            await fs.mkdir(dataDir, { recursive: true });
            await fs.access(this.dataFile).catch(() => fs.writeFile(this.dataFile, JSON.stringify({ users: {}, history: {}, leaderboards: {} }, null, 2)));
            await fs.access(this.settingsFile).catch(() => fs.writeFile(this.settingsFile, JSON.stringify({}, null, 2)));
            await fs.access(this.auditFile).catch(() => fs.writeFile(this.auditFile, JSON.stringify({ events: [] }, null, 2)));
        } catch (error) {
            console.error('Error initializing reputation data:', error);
        }
    }

    // --- Data Loading and Saving ---
    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading reputation data:', error);
            return { users: {}, history: {}, leaderboards: {} };
        }
    }

    async saveData(data) {
        try {
            await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving reputation data:', error);
        }
    }

    async loadSettings() {
        try {
            const data = await fs.readFile(this.settingsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading reputation settings:', error);
            return {};
        }
    }

    async saveSettings(settings) {
        try {
            await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
        } catch (error) {
            console.error('Error saving reputation settings:', error);
        }
    }

    async logAuditEvent(guildId, type, userId, targetId = null, details = {}, moderator = null) {
        try {
            const auditData = JSON.parse(await fs.readFile(this.auditFile, 'utf8').catch(() => '{"events":[]}'));
            auditData.events.unshift({ timestamp: Date.now(), guildId, type, userId, targetId, details, moderator });
            if (auditData.events.length > 10000) {
                auditData.events = auditData.events.slice(0, 10000);
            }
            await fs.writeFile(this.auditFile, JSON.stringify(auditData, null, 2));
        } catch (error) {
            console.error('Error logging audit event:', error);
        }
    }

    // --- API Routes ---
    setupRoutes() {
        this.app.post('/api/plugins/reputation/repair/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const result = await this.repairReputationData(serverId);
                res.json(result);
            } catch (error) {
                console.error('Error repairing reputation data:', error);
                res.status(500).json({ error: 'Failed to repair reputation data' });
            }
        });

        this.app.get('/api/plugins/reputation/data/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const data = await this.loadData();
                const settings = await this.loadSettings();
                res.json({
                    settings: settings[serverId] || this.getDefaultSettings(),
                    leaderboard: data.leaderboards[serverId] || {},
                    stats: this.getServerStats(data, serverId)
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch reputation data' });
            }
        });

        this.app.post('/api/plugins/reputation/settings/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const settings = await this.loadSettings();
                settings[serverId] = { ...this.getDefaultSettings(), ...req.body };
                await this.saveSettings(settings);
                res.json({ success: true, settings: settings[serverId] });
            } catch (error) {
                res.status(500).json({ error: 'Failed to update settings' });
            }
        });

        this.app.get('/api/plugins/reputation/leaderboard/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                const { type = 'overall', limit = 10 } = req.query;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const leaderboard = await this.generateLeaderboard(serverId, type, parseInt(limit));
                res.json(leaderboard);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch leaderboard' });
            }
        });

        this.app.post('/api/plugins/reputation/adjust/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                const { userId, category, amount, reason } = req.body;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                await this.adjustReputation(serverId, userId, req.user.id, category, parseInt(amount), reason, 'admin_adjust');
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to adjust reputation' });
            }
        });

        this.app.get('/api/plugins/reputation/user/:serverId/:userId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId, userId } = req.params;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const data = await this.loadData();
                const userRep = data.users[userId]?.[serverId] || this.getDefaultUserRep();
                const history = data.history[serverId]?.[userId] || [];
                res.json({ reputation: userRep, history });
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch user reputation' });
            }
        });

        this.app.get('/api/plugins/reputation/audit/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                const { limit = 100 } = req.query;
                if (!await this.hasAdminPermissions(req.user.id, serverId)) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                const auditData = JSON.parse(await fs.readFile(this.auditFile, 'utf8').catch(() => '{"events":[]}'));
                const serverEvents = auditData.events.filter(e => e.guildId === serverId).slice(0, parseInt(limit));
                res.json(serverEvents);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch audit logs' });
            }
        });
    }

    // --- Discord Listeners and Slash Command handlers ---
    setupDiscordListeners() {
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;
            const settings = await this.loadSettings();
            const guildSettings = settings[message.guild.id];
            if (!guildSettings?.enabled || !guildSettings?.autoThanks) return;
            await this.handleThanksMessage(message, guildSettings);
        });

		this.client.on('messageReactionAdd', async (reaction, user) => {
			if (user.bot || !reaction.message.guild) return;
			const settings = await this.loadSettings();
			const guildSettings = settings[reaction.message.guild.id];
			if (!guildSettings?.enabled || !guildSettings?.reactionRep) return;
			if (guildSettings.repEmoji === reaction.emoji.name || guildSettings.repEmoji === reaction.emoji.id) {
				await this.giveReputation(
					reaction.message.guild.id, 
					user.id, 
					reaction.message.author.id, 
					'helpfulness', 
					1, 
					'Helpful reaction', 
					'reaction',
					reaction.message.channel.id // Pass channel ID for public announcement
				);
			}
		});

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton() || !interaction.customId.startsWith('rep_')) return;
            await this.handleReputationInteraction(interaction);
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isModalSubmit() || !interaction.customId.startsWith('rep_reason_')) return;
            await this.handleReasonModal(interaction);
        });
    }

    setupSlashCommands() {
        this.client.once('ready', async () => {
            try {
                const commands = this.getSlashCommands();
                const guilds = this.client.guilds.cache;
                for (const guild of guilds.values()) {
                    try {
                        await guild.commands.set(commands);
                        console.log(`✓ Registered Reputation commands for guild: ${guild.name}`);
                    } catch (err) {
                        console.error(`❌ Failed to register Reputation commands for guild ${guild.name}:`, err.rawError ? err.rawError.errors : err);
                    }
                }
            } catch (error) {
                console.error('Error registering Reputation slash commands:', error);
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            const commandNames = this.getSlashCommands().map(cmd => cmd.name);
            if (commandNames.includes(interaction.commandName)) {
                await this.handleSlashCommand(interaction);
            }
        });
    }

    getSlashCommands() {
		return [
			{
				name: 'rep',
				description: 'View or give reputation to a user',
				options: [
					{
						name: 'view',
						description: 'View a users reputation',
						type: 1, // SUB_COMMAND
						options: [
							{
								name: 'user',
								description: 'User to view reputation for',
								type: 6, // USER
								required: false
							}
						]
					},
					{
						name: 'give',
						description: 'Give reputation to a user',
						type: 1, // SUB_COMMAND
						options: [
							{
								name: 'user',
								description: 'User to give reputation to',
								type: 6, // USER
								required: true
							},
							{
								name: 'category',
								description: 'Category of reputation',
								type: 3, // STRING
								required: true,
								choices: [
									{ name: 'Helpfulness', value: 'helpfulness' },
									{ name: 'Creativity', value: 'creativity' },
									{ name: 'Reliability', value: 'reliability' },
									{ name: 'Community Spirit', value: 'community' }
								]
							},
							{
								name: 'reason',
								description: 'Reason for giving reputation',
								type: 3, // STRING
								required: true
							}
						]
					},
					{
						name: 'leaderboard',
						description: 'View reputation leaderboard',
						type: 1, // SUB_COMMAND
						options: [
							{
								name: 'type',
								description: 'Type of leaderboard',
								type: 3, // STRING
								required: false,
								choices: [
									{ name: 'Overall', value: 'overall' },
									{ name: 'Helpfulness', value: 'helpfulness' },
									{ name: 'Creativity', value: 'creativity' },
									{ name: 'Reliability', value: 'reliability' },
									{ name: 'Community Spirit', value: 'community' },
									{ name: 'Weekly', value: 'weekly' },
									{ name: 'Monthly', value: 'monthly' },
                                    { name: 'Legacy', value: 'legacy' }
								]
							}
						]
					},
					{
						name: 'history',
						description: 'View your reputation history',
						type: 1 // SUB_COMMAND
					}
				]
			},
			{
				name: 'thanks',
				description: 'Thank a user and give them reputation',
				options: [
					{
						name: 'user',
						description: 'User to thank',
						type: 6, // USER
						required: true
					},
					{
						name: 'reason',
						description: 'Reason for thanking',
						type: 3, // STRING
						required: false
					}
				]
			}
		];
	}

	async handleSlashCommand(interaction) {
		const { commandName } = interaction;
		if (commandName === 'rep') {
			await this.handleRepCommand(interaction);
		} else if (commandName === 'thanks') {
			await this.handleThanksCommand(interaction);
		}
	}


    async handleThanksMessage(message, settings) {
        const hasThanks = this.THANKS_PATTERNS.some(pattern => pattern.test(message.content));
        if (!hasThanks) return;

        let targetUser = null;

        if (message.reference?.messageId) {
            try {
                const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (repliedMessage.author.id !== message.author.id) {
                    targetUser = repliedMessage.author;
                }
            } catch (error) { /* Ignore */ }
        }

        if (!targetUser && message.mentions.users.size === 1) {
            const mentionedUser = message.mentions.users.first();
            if (mentionedUser.id !== message.author.id) {
                targetUser = mentionedUser;
            }
        }

        if (targetUser) {
            await this.showReputationModal(message, targetUser);
        }
    }

    async showReputationModal(message, targetUser) {
        const authorId = message.author.id;
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`rep_quick_${targetUser.id}_helpfulness_${authorId}`)
                    .setLabel('Helpful 👍')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`rep_quick_${targetUser.id}_creativity_${authorId}`)
                    .setLabel('Creative 🎨')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`rep_quick_${targetUser.id}_reliability_${authorId}`)
                    .setLabel('Reliable ⭐')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`rep_quick_${targetUser.id}_community_${authorId}`)
                    .setLabel('Community 🤝')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`rep_custom_${targetUser.id}_${authorId}`)
                    .setLabel('Custom 📝')
                    .setStyle(ButtonStyle.Secondary)
            );

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('💝 Give Reputation')
            .setDescription(`<@${authorId}> Give reputation to ${targetUser.displayName}!\n⚠️ Only you can use these buttons.`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setFooter({ text: 'This prompt will disappear in 30 seconds' });

        try {
            const reply = await message.reply({
                embeds: [embed],
                components: [row]
            });

            // Auto-delete after 30 seconds
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (deleteError) {
                    // Silently ignore deletion errors (message might already be deleted)
                }
            }, 30000);

        } catch (error) {
            console.error('Error showing reputation modal:', error);
            // Try to send a simple text message as fallback
            try {
                await message.reply(`❌ Could not display reputation buttons. Use \`/rep give @${targetUser.username}\` instead.`);
            } catch (fallbackError) {
                console.error('Fallback message also failed:', fallbackError);
            }
        }
    }

    async handleReputationInteraction(interaction) {
		const customIdParts = interaction.customId.split('_');
		
		let type, targetUserId, category, authorId;
		
		if (customIdParts.length >= 5) {
			[, type, targetUserId, category, authorId] = customIdParts;
		} else if (customIdParts.length >= 4) {
			[, type, targetUserId, category] = customIdParts;
			authorId = null;
		} else {
			[, type, targetUserId, authorId] = customIdParts;
			category = null;
		}

		if (authorId && interaction.user.id !== authorId) {
			return await interaction.reply({
				content: '❌ You cannot use this button. Only the person who triggered this prompt can give reputation.',
				ephemeral: true
			});
		}

		if (type === 'quick') {
			const result = await this.giveReputation(
				interaction.guild.id,
				interaction.user.id,
				targetUserId,
				category,
				1,
				'Quick thanks',
				'quick',
				interaction.channel.id
			);
			
			if (result.success) {
				await interaction.reply({
					content: `✅ Successfully gave ${category} reputation!`,
					ephemeral: true
				});
			} else {
				await interaction.reply({
					content: `❌ ${result.error}`,
					ephemeral: true
				});
			}
		} else if (type === 'custom') {
			const modal = new ModalBuilder()
				.setCustomId(`rep_reason_${targetUserId}_${authorId || interaction.user.id}`)
				.setTitle('Give Reputation');

			const categoryInput = new TextInputBuilder()
				.setCustomId('category')
				.setLabel('Category')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('helpfulness, creativity, reliability, or community')
				.setRequired(true)
				.setMaxLength(20);

			const reasonInput = new TextInputBuilder()
				.setCustomId('reason')
				.setLabel('Reason')
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder('Why are you giving this reputation?')
				.setRequired(true)
				.setMaxLength(500);

			modal.addComponents(
				new ActionRowBuilder().addComponents(categoryInput),
				new ActionRowBuilder().addComponents(reasonInput)
			);

			await interaction.showModal(modal);
		}
	}

    async handleReasonModal(interaction) {
		const customIdParts = interaction.customId.split('_');
		
		let targetUserId, authorId;
		if (customIdParts.length >= 4) {
			[, , targetUserId, authorId] = customIdParts;
		} else {
			[, , targetUserId] = customIdParts;
			authorId = null;
		}

		if (authorId && interaction.user.id !== authorId) {
			return await interaction.reply({
				content: '❌ You cannot submit this form. Only the person who triggered this prompt can give reputation.',
				ephemeral: true
			});
		}

		const category = interaction.fields.getTextInputValue('category').toLowerCase();
		const reason = interaction.fields.getTextInputValue('reason');
		const amount = 1;

		if (!this.REP_CATEGORIES.includes(category)) {
			return await interaction.reply({
				content: '❌ Invalid category. Use: helpfulness, creativity, reliability, or community',
				ephemeral: true
			});
		}

		const result = await this.giveReputation(
			interaction.guild.id,
			interaction.user.id,
			targetUserId,
			category,
			amount,
			reason,
			'manual',
			interaction.channel.id
		);

		if (result.success) {
			await interaction.reply({
				content: `✅ Successfully gave ${amount} ${category} reputation!`,
				ephemeral: true
			});
		} else {
			await interaction.reply({
				content: `❌ ${result.error}`,
				ephemeral: true
			});
		}
	}

    async sendPublicReputationAnnouncement(guildId, fromUserId, toUserId, category, amount, reason, fallbackChannelId) {
        try {
            const settings = await this.loadSettings();
            const guildSettings = settings[guildId] || this.getDefaultSettings();
            
            // Force use of hardcoded announcement channel
            const targetChannelId = '1390335452439121920'; // Hardcoded announcement channel
            
            console.log(`🏆 Sending reputation announcement to channel: ${targetChannelId}`);

            const channel = this.client.channels.cache.get(targetChannelId);
            if (!channel) {
                console.log(`Reputation announcement channel not found or inaccessible: ${targetChannelId}`);
                return;
            }
    
            const categoryEmoji = this.getCategoryEmoji(category);
            const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
            
            // Fix: Always show the user mention, don't check anonymousRep setting
            const fromUserMention = `<@${fromUserId}>`;

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('💝 Reputation Given!')
                .setDescription(`${fromUserMention} gave **${amount}** ${categoryEmoji} **${categoryName}** reputation to <@${toUserId}>`)
                .setTimestamp()
                .setFooter({ text: guildSettings.customName || 'Reputation System' });
            
            // Always show the reason since we're not doing anonymous rep
            embed.addFields({ 
                name: 'Reason', 
                value: reason || 'No reason provided', 
                inline: false 
            });
    
            await channel.send({ embeds: [embed] });
            console.log(`🏆 Successfully sent reputation announcement to ${targetChannelId}`);
        } catch (error) {
            console.error('Error sending public reputation announcement:', error);
        }
    }

    async giveReputation(guildId, fromUserId, toUserId, category, amount, reason, type = 'manual', channelId = null) {
		if (fromUserId === toUserId) {
			return { success: false, error: 'You cannot give reputation to yourself!' };
		}

		const settings = await this.loadSettings();
		const guildSettings = settings[guildId] || this.getDefaultSettings();
		if (!guildSettings.enabled) {
			return { success: false, error: 'Reputation system is disabled in this server!' };
		}

		const cooldownKey = `${guildId}_${fromUserId}_${toUserId}`;
		const lastGiven = this.userCooldowns.get(cooldownKey) || 0;
		const cooldownTime = guildSettings.cooldown || this.DEFAULT_COOLDOWN;
		if (Date.now() - lastGiven < cooldownTime) {
			const remaining = Math.ceil((cooldownTime - (Date.now() - lastGiven)) / 60000);
			return { success: false, error: `You must wait ${remaining} more minutes before giving reputation to this user again!` };
		}

		if (!this.checkLimits(guildId, fromUserId, guildSettings)) {
			return { success: false, error: 'You have reached your daily or weekly reputation limit!' };
		}

		const multiplier = await this.getReputationMultiplier(guildId, fromUserId);
		const finalAmount = Math.floor(amount * multiplier);

		await this.adjustReputation(guildId, toUserId, fromUserId, category, finalAmount, reason, type);
		this.userCooldowns.set(cooldownKey, Date.now());
		this.updateLimits(guildId, fromUserId, finalAmount);
		await this.logAuditEvent(guildId, 'rep_given', fromUserId, toUserId, { category, amount: finalAmount, reason, type, multiplier });

		await this.sendPublicReputationAnnouncement(guildId, fromUserId, toUserId, category, finalAmount, reason, channelId);

		return { success: true, amount: finalAmount };
	}

    async adjustReputation(guildId, userId, fromUserId, category, amount, reason, type) {
        const data = await this.loadData();
        const defaultRep = this.getDefaultUserRep();

        if (!data.users[userId]) data.users[userId] = {};
        
        data.users[userId][guildId] = {
            ...defaultRep,
            ...(data.users[userId][guildId] || {}),
            categories: { ...defaultRep.categories, ...((data.users[userId][guildId]?.categories) || {}) },
            streaks: { ...defaultRep.streaks, ...((data.users[userId][guildId]?.streaks) || {}) }
        };
        
        if (!data.history[guildId]) data.history[guildId] = {};
        if (!data.history[guildId][userId]) data.history[guildId][userId] = [];

        const userRep = data.users[userId][guildId];
        userRep.categories[category] += amount;
        userRep.total += amount;
        userRep.lastActive = Date.now();

        if (fromUserId && fromUserId !== 'system') {
            if (!data.users[fromUserId]) data.users[fromUserId] = {};
            if (!data.users[fromUserId][guildId]) data.users[fromUserId][guildId] = this.getDefaultUserRep();
            data.users[fromUserId][guildId].given += amount;
        }

        data.history[guildId][userId].push({ from: fromUserId, to: userId, category, amount, reason, timestamp: Date.now(), type });

        await this.updateStreaksAndBadges(data, guildId, userId);
        await this.updateLeaderboards(data, guildId);
        await this.saveData(data);
        await this.checkRoleRewards(guildId, userId, userRep);
        await this.sendLogMessage(guildId, fromUserId, userId, category, amount, reason, type);
    }

    async updateStreaksAndBadges(data, guildId, userId) {
        const userRep = data.users[userId][guildId];
        const history = data.history[guildId][userId] || [];
        const today = new Date().toDateString();
        const recentActivity = history.filter(entry => new Date(entry.timestamp).toDateString() === today);
        if (recentActivity.length > 0) {
            userRep.streaks = userRep.streaks || { current: 0, longest: 0 };
            userRep.streaks.current = (userRep.streaks.current || 0) + 1;
            userRep.streaks.longest = Math.max(userRep.streaks.longest || 0, userRep.streaks.current);
        }
        const badges = [];
        if (userRep.total >= 10) badges.push('🌟 First Steps');
        if (userRep.total >= 50) badges.push('⭐ Rising Star');
		if (userRep.total >= 100) badges.push('🏆 Respected Member');
		if (userRep.total >= 250) badges.push('💎 Community Pillar');
		if (userRep.total >= 500) badges.push('👑 Legend');
		if (userRep.streaks?.longest >= 7) badges.push('🔥 Week Warrior');
		if (userRep.streaks?.longest >= 30) badges.push('📅 Monthly Master');
		if (userRep.given >= 25) badges.push('🤝 Helper');
		if (userRep.given >= 100) badges.push('💝 Generous Soul');
		userRep.badges = [...new Set([...(userRep.badges || []), ...badges])];
   }

   async updateLeaderboards(data, guildId) {
	   if (!data.leaderboards[guildId]) data.leaderboards[guildId] = { overall: [], categories: {}, weekly: [], monthly: [] };

	   const guildUsers = Object.entries(data.users)
		   .filter(([, userData]) => userData[guildId])
		   .map(([userId, userData]) => ({ userId, ...userData[guildId] }));

	   data.leaderboards[guildId].overall = guildUsers.sort((a, b) => b.total - a.total).slice(0, 50);

	   for (const category of this.REP_CATEGORIES) {
		   if (!data.leaderboards[guildId].categories) data.leaderboards[guildId].categories = {};
		   data.leaderboards[guildId].categories[category] = guildUsers
			   .filter(user => user.categories && user.categories[category] > 0)
			   .sort((a, b) => (b.categories[category] || 0) - (a.categories[category] || 0))
			   .slice(0, 25);
	   }

	   const now = Date.now();
	   const weekAgo = now - 604800000;
	   const monthAgo = now - 2592000000;

	   const getRecentRep = (user, since) => (data.history[guildId]?.[user.userId] || [])
		   .filter(e => e.timestamp > since).reduce((s, e) => s + e.amount, 0);

	   data.leaderboards[guildId].weekly = guildUsers.map(u => ({ ...u, weeklyRep: getRecentRep(u, weekAgo) }))
		   .filter(u => u.weeklyRep > 0).sort((a, b) => b.weeklyRep - a.weeklyRep).slice(0, 25);
	   data.leaderboards[guildId].monthly = guildUsers.map(u => ({ ...u, monthlyRep: getRecentRep(u, monthAgo) }))
		   .filter(u => u.monthlyRep > 0).sort((a, b) => b.monthlyRep - a.monthlyRep).slice(0, 25);
   }

   async getReputationMultiplier(guildId, userId) {
	   try {
		   const levelingData = JSON.parse(await fs.readFile(path.join(__dirname, '../data/levelingData.json'), 'utf8').catch(() => '{}'));
		   const userLevel = levelingData.users?.[userId]?.[guildId]?.level || 0;
		   if (userLevel >= 50) return 2.0;
		   if (userLevel >= 30) return 1.5;
		   if (userLevel >= 15) return 1.25;
		   if (userLevel >= 5) return 1.1;
		   return 1.0;
	   } catch (error) {
		   return 1.0;
	   }
   }

   checkLimits(guildId, userId, settings) {
	   const dailyLimit = settings.dailyLimit || this.DEFAULT_DAILY_LIMIT;
	   const weeklyLimit = settings.weeklyLimit || this.DEFAULT_WEEKLY_LIMIT;
	   return (this.dailyLimits.get(`${guildId}_${userId}_daily`) || 0) < dailyLimit && (this.weeklyLimits.get(`${guildId}_${userId}_weekly`) || 0) < weeklyLimit;
   }

   updateLimits(guildId, userId, amount) {
	   const dailyKey = `${guildId}_${userId}_daily`;
	   const weeklyKey = `${guildId}_${userId}_weekly`;
	   this.dailyLimits.set(dailyKey, (this.dailyLimits.get(dailyKey) || 0) + amount);
	   this.weeklyLimits.set(weeklyKey, (this.weeklyLimits.get(weeklyKey) || 0) + amount);
   }

   async processDecay() {
	   const data = await this.loadData();
	   const settings = await this.loadSettings();
	   for (const [guildId, guildSettings] of Object.entries(settings)) {
		   if (!guildSettings.decayEnabled) continue;
		   for (const [userId, userData] of Object.entries(data.users)) {
			   if (!userData[guildId]) continue;
			   const userRep = userData[guildId];
			   const daysSinceActive = (Date.now() - (userRep.lastActive || 0)) / 86400000;
			   if (daysSinceActive > 7) {
				   const decayAmount = Math.floor(userRep.total * (1 - this.DECAY_RATE));
				   if (decayAmount > 0) {
					   userRep.total = Math.max(0, userRep.total - decayAmount);
					   for (const category of this.REP_CATEGORIES) {
						   if (userRep.categories[category]) {
							   userRep.categories[category] = Math.max(0, userRep.categories[category] - Math.floor(userRep.categories[category] * (1 - this.DECAY_RATE)));
						   }
					   }
					   await this.logAuditEvent(guildId, 'rep_decay', userId, null, { decayAmount, daysSinceActive: Math.floor(daysSinceActive) }, 'system');
				   }
			   }
		   }
	   }
	   await this.saveData(data);
   }

   resetLimitsDaily() { setInterval(() => this.dailyLimits.clear(), 86400000); }
   resetLimitsWeekly() { setInterval(() => this.weeklyLimits.clear(), 604800000); }

   async checkRoleRewards(guildId, userId, userRep) {
	   const settings = await this.loadSettings();
	   const guildSettings = settings[guildId];
	   if (!guildSettings?.roles) return;
	   const guild = this.client.guilds.cache.get(guildId);
	   if (!guild) return;
	   const member = await guild.members.fetch(userId).catch(() => null);
	   if (!member) return;
	   for (const [threshold, roleId] of Object.entries(guildSettings.roles)) {
		   const requiredRep = parseInt(threshold);
		   if (userRep.total >= requiredRep) {
			   const role = guild.roles.cache.get(roleId);
			   if (role && !member.roles.cache.has(roleId)) {
				   await member.roles.add(role).catch(console.error);
				   await this.logAuditEvent(guildId, 'role_reward', userId, null, { roleId, threshold: requiredRep, currentRep: userRep.total }, 'system');
			   }
		   }
	   }
   }

   async sendLogMessage(guildId, fromUserId, toUserId, category, amount, reason, type) {
	   const settings = await this.loadSettings();
	   const guildSettings = settings[guildId];
	   if (!guildSettings?.logChannel) return;
	   const channel = this.client.channels.cache.get(guildSettings.logChannel);
	   if (!channel) return;
	   const embed = new EmbedBuilder()
		   .setColor(amount > 0 ? 0x00ff00 : 0xff0000)
		   .setTitle((amount > 0 ? '📈' : '📉') + ' Reputation ' + (amount > 0 ? 'Given' : 'Removed'))
		   .addFields(
			   { name: 'From', value: fromUserId ? `<@${fromUserId}>` : 'System', inline: true },
			   { name: 'To', value: `<@${toUserId}>`, inline: true },
			   { name: 'Category', value: category.charAt(0).toUpperCase() + category.slice(1), inline: true },
			   { name: 'Amount', value: amount.toString(), inline: true },
			   { name: 'Type', value: type, inline: true },
			   { name: 'Reason', value: reason || 'No reason provided', inline: false }
		   ).setTimestamp();
	   await channel.send({ embeds: [embed] });
   }

   async handleRepCommand(interaction) {
	   const subcommand = interaction.options.getSubcommand();
	   if (subcommand === 'view') await this.handleRepView(interaction);
	   else if (subcommand === 'give') await this.handleRepGive(interaction);
	   else if (subcommand === 'leaderboard') await this.handleRepLeaderboard(interaction);
	   else if (subcommand === 'history') await this.handleRepHistory(interaction);
   }
   
   async handleRepView(interaction) {
	   const targetUser = interaction.options.getUser('user') || interaction.user;
	   const data = await this.loadData();
	   
	   const getUserData = (guildData) => {
		   const defaults = this.getDefaultUserRep();
		   return {
			   ...defaults,
			   ...(guildData || {}),
			   categories: { ...defaults.categories, ...(guildData?.categories || {}) },
			   streaks: { ...defaults.streaks, ...(guildData?.streaks || {}) }
		   };
	   };
	   const userRep = getUserData(data.users[targetUser.id]?.[interaction.guild.id]);
	   
	   const embed = new EmbedBuilder()
		   .setColor(0x0099ff)
		   .setTitle(`${targetUser.displayName}'s Reputation`)
		   .setThumbnail(targetUser.displayAvatarURL())
		   .addFields(
			   { name: '🏆 Total Reputation', value: `**${userRep.total.toString()}**`, inline: true },
			   { name: '💝 Given', value: `**${userRep.given.toString()}**`, inline: true },
			   { name: '🔥 Current Streak', value: `**${(userRep.streaks.current || 0).toString()}**`, inline: true }
		   );

	   let categoryText = '';
	   const regularCategories = this.REP_CATEGORIES.filter(c => c !== 'legacy');

	   for (const category of regularCategories) {
		   const amount = userRep.categories[category] || 0;
		   if (amount > 0) {
			   const emoji = this.getCategoryEmoji(category);
			   categoryText += `${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)}: **${amount}**\n`;
		   }
	   }
	   
	   if (categoryText) {
		   embed.addFields({ name: '📊 Category Breakdown', value: categoryText.trim(), inline: false });
	   }

	   const legacyRep = userRep.categories.legacy || 0;
	   if (legacyRep > 0) {
		   embed.addFields({ name: `${this.getCategoryEmoji('legacy')} Migrated Reputation`, value: `From a previous system: **${legacyRep}**`, inline: false });
	   }

	   if (userRep.badges?.length > 0) {
		   embed.addFields({ name: '🏅 Badges', value: userRep.badges.join(' '), inline: false });
	   }

	   await interaction.reply({ embeds: [embed] });
   }

   async handleRepGive(interaction) {
	const targetUser = interaction.options.getUser('user');
	const category = interaction.options.getString('category');
	const reason = interaction.options.getString('reason');
	
	const result = await this.giveReputation(
		interaction.guild.id,
		interaction.user.id,
		targetUser.id,
		category,
		1,
		reason,
		'command',
		interaction.channel.id
	);
	
	if (result.success) {
		await interaction.reply({
			content: `✅ Successfully gave ${result.amount} ${category} reputation!`,
			ephemeral: true
		});
	} else {
		await interaction.reply({
			content: `❌ ${result.error}`,
			ephemeral: true
		});
	}
   }

   async handleThanksCommand(interaction) {
	const targetUser = interaction.options.getUser('user');
	const reason = interaction.options.getString('reason') || 'Thank you!';
	
	const result = await this.giveReputation(
		interaction.guild.id,
		interaction.user.id,
		targetUser.id,
		'helpfulness',
		1,
		reason,
		'thanks_command',
		interaction.channel.id
	);
	
	if (result.success) {
		await interaction.reply({
			content: `✅ Successfully thanked ${targetUser.displayName}!`,
			ephemeral: true
		});
	} else {
		await interaction.reply({
			content: `❌ ${result.error}`,
			ephemeral: true
		});
	}
   }

   async handleRepLeaderboard(interaction) {
	   const type = interaction.options.getString('type') || 'overall';
	   const leaderboard = await this.generateLeaderboard(interaction.guild.id, type, 10);
	   
	   if (!leaderboard.length) {
		   return await interaction.reply({ content: `No one has reputation in the **${type}** category yet.`, ephemeral: true });
	   }
	   
	   const embed = new EmbedBuilder()
		   .setColor(0xffd700)
		   .setTitle(`🏆 ${type.charAt(0).toUpperCase() + type.slice(1)} Reputation Leaderboard`)
		   .setDescription(leaderboard.map((entry, index) => {
			   const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
			   
			   let amount;
			   if (type === 'weekly') amount = entry.weeklyRep || 0;
			   else if (type === 'monthly') amount = entry.monthlyRep || 0;
			   else if (type === 'overall') amount = entry.total || 0;
			   else amount = entry.categories[type] || 0;

			   return `${medal} <@${entry.userId}>: **${amount}** rep`;
		   }).join('\n'))
		   .setTimestamp();
	   
	   await interaction.reply({ embeds: [embed] });
   }

   async handleRepHistory(interaction) {
	   const data = await this.loadData();
	   const history = data.history[interaction.guild.id]?.[interaction.user.id] || [];
	   if (!history.length) return await interaction.reply({ content: 'You have no reputation history in this server.', ephemeral: true });
	   const recentHistory = history.slice(0, 10);
	   const embed = new EmbedBuilder()
		   .setColor(0x0099ff)
		   .setTitle('📜 Your Reputation History')
		   .setDescription(recentHistory.map(entry => {
			   const date = new Date(entry.timestamp).toLocaleDateString();
			   const fromText = entry.from && entry.from !== 'system' ? `from <@${entry.from}>` : 'from system';
			   return `${entry.amount > 0 ? '+' : ''}${entry.amount} ${entry.category} ${fromText} - ${entry.reason} (${date})`;
		   }).join('\n'))
		   .setFooter({ text: 'Showing last 10 entries' });
	   await interaction.reply({ embeds: [embed], ephemeral: true });
   }

   async generateLeaderboard(guildId, type, limit) {
	   const data = await this.loadData();
	   const leaderboards = data.leaderboards[guildId];
	   if (!leaderboards) return [];
	   if (type === 'overall') return leaderboards.overall.slice(0, limit);
	   if (type === 'weekly') return leaderboards.weekly.slice(0, limit);
	   if (type === 'monthly') return leaderboards.monthly.slice(0, limit);
	   if (this.REP_CATEGORIES.includes(type)) return leaderboards.categories[type]?.slice(0, limit) || [];
	   return [];
   }

   getDefaultSettings() {
	return {
		enabled: true, 
		autoThanks: true, 
		reactionRep: true, 
		repEmoji: '👍', 
		cooldown: this.DEFAULT_COOLDOWN,
		dailyLimit: this.DEFAULT_DAILY_LIMIT, 
		weeklyLimit: this.DEFAULT_WEEKLY_LIMIT, 
		decayEnabled: false,
		logChannel: null, 
		announcementChannel: null,
		customName: 'Reputation', 
		categories: this.REP_CATEGORIES, 
		roles: {}, 
		badges: true, 
		anonymousRep: false
	};
   }

   getDefaultUserRep() {
	return {
		categories: { helpfulness: 0, creativity: 0, reliability: 0, community: 0, legacy: 0 },
		total: 0, given: 0, received: 0, streaks: { current: 0, longest: 0 }, badges: [], lastActive: Date.now()
	};
   }

   getServerStats(data, serverId) {
	   const users = Object.values(data.users).filter(user => user[serverId]);
	   const totalRep = users.reduce((sum, user) => sum + (user[serverId]?.total || 0), 0);
	   const activeUsers = users.filter(user => (Date.now() - (user[serverId]?.lastActive || 0)) / 86400000 <= 30);
	   return { totalUsers: users.length, totalReputation: totalRep, activeUsers: activeUsers.length, averageRep: users.length ? Math.round(totalRep / users.length) : 0 };
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
   }
   
   getFrontendComponent() {
	   return {
		   id: 'reputation-system',
		   name: 'Reputation System',
		   description: 'Advanced reputation system with categories, reasons, decay, and anti-abuse features',
		   icon: '🏆',
		   version: '1.0.0',
		   containerId: 'reputationPluginContainer',
		   pageId: 'reputation',
		   navIcon: '🏆',
		   
		   html: `
			   <div class="plugin-container">
				   <div class="plugin-header">
					   <h3><span class="plugin-icon">🏆</span> Reputation System</h3>
					   <p>Advanced reputation system with categories, reasons, decay, and anti-abuse features</p>
				   </div>
				   <div class="settings-section">
					   <h3>Settings</h3>
					   <div class="form-group">
						   <label for="repServerSelect">Server</label>
						   <select id="repServerSelect" required>
							   <option value="">Select a server...</option>
						   </select>
					   </div>
					   <div id="repSettingsContainer" style="display: none;">
						   <div class="form-group">
							   <label>
								   <input type="checkbox" id="repEnabled"> Enable Reputation System
							   </label>
						   </div>
						   <div class="form-group">
							   <label>
								   <input type="checkbox" id="autoThanks"> Auto-detect Thanks Messages
							   </label>
							   <small>Automatically prompt for reputation when users thank each other</small>
						   </div>
						   <div class="form-group">
							   <label>
								   <input type="checkbox" id="reactionRep"> Reaction-based Reputation
							   </label>
							   <div style="margin-top: 8px;">
								   <label for="repEmoji">Reputation Emoji</label>
								   <input type="text" id="repEmoji" placeholder="👍" style="width: 60px;">
							   </div>
						   </div>
						   <div class="form-group">
							   <label for="customName">Custom Name</label>
							   <input type="text" id="customName" placeholder="Reputation">
							   <small>Customize what reputation is called in your server</small>
						   </div>
						   <div class="form-group">
							   <label for="cooldownTime">Cooldown (minutes)</label>
							   <input type="number" id="cooldownTime" min="1" max="1440" value="60">
							   <small>Time between giving reputation to the same user</small>
						   </div>
						   <div class="form-group">
							   <label for="dailyLimit">Daily Limit</label>
							   <input type="number" id="dailyLimit" min="1" max="100" value="10">
							   <small>Maximum reputation a user can give per day</small>
						   </div>
						   <div class="form-group">
							   <label for="weeklyLimit">Weekly Limit</label>
							   <input type="number" id="weeklyLimit" min="1" max="500" value="50">
							   <small>Maximum reputation a user can give per week</small>
						   </div>
						   <div class="form-group">
							   <label>
								   <input type="checkbox" id="decayEnabled"> Enable Reputation Decay
							   </label>
							   <small>Slowly reduce reputation for inactive users</small>
						   </div>
						<div class="form-group">
							<label for="logChannelSelect">Log Channel</label>
							<select id="logChannelSelect" disabled>
								<option value="1390475947832250458">#logs (hardcoded)</option>
							</select>
							<small>Channel to log detailed reputation events for moderation (hardcoded)</small>
						</div>
						<div class="form-group">
							<label for="announcementChannelSelect">Announcement Channel</label>
							<select id="announcementChannelSelect" disabled>
								<option value="1390335452439121920">#announcements (hardcoded)</option>
							</select>
							<small>Channel where public "Reputation Given!" messages will be posted (hardcoded)</small>
						</div>
						   <div class="form-group">
							<label>
								<input type="checkbox" id="anonymousRep"> Allow Anonymous Reputation
							</label>
							<small>Users can give reputation without revealing their identity</small>
						</div>
						   <button type="button" id="saveRepSettings" class="btn-primary">
							   <span class="btn-text">Save Settings</span>
							   <span class="btn-loader" style="display: none;">Saving...</span>
						   </button>
					   </div>
				   </div>
				   <div id="repLeaderboardSection" style="display: none;" class="settings-section">
					   <h3>🏆 Leaderboards</h3>
					   <div class="form-group">
						   <label for="leaderboardType">Leaderboard Type</label>
						   <select id="leaderboardType">
							   <option value="overall">Overall</option>
							   <option value="helpfulness">Helpfulness</option>
							   <option value="creativity">Creativity</option>
							   <option value="reliability">Reliability</option>
							   <option value="community">Community Spirit</option>
							<option value="legacy">Legacy</option>
							   <option value="weekly">Weekly</option>
							   <option value="monthly">Monthly</option>
						   </select>
					   </div>
					   <div id="leaderboardLoading" style="display: none; text-align: center; padding: 20px;">
						   <p>Loading leaderboard...</p>
					   </div>
					   <div id="leaderboardContent">
						   <div id="leaderboardList" class="leaderboard-list"></div>
					   </div>
				   </div>
				   <div id="repAdminSection" style="display: none;" class="settings-section">
					   <h3>⚙️ Admin Tools</h3>
					   <div style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));">
						   <div class="admin-card">
							   <h4>Manual Reputation Adjustment</h4>
							   <div class="form-group">
								   <label for="adminUserId">User ID</label>
								   <input type="text" id="adminUserId" placeholder="User ID or mention">
							   </div>
							   <div class="form-group">
								   <label for="adminCategory">Category</label>
								   <select id="adminCategory">
									   <option value="helpfulness">Helpfulness</option>
									   <option value="creativity">Creativity</option>
									   <option value="reliability">Reliability</option>
									   <option value="community">Community Spirit</option>
									   <option value="legacy">Legacy</option>
								   </select>
							   </div>
							   <div class="form-group">
								   <label for="adminAmount">Amount</label>
								   <input type="number" id="adminAmount" value="1" min="-100" max="100">
							   </div>
							   <div class="form-group">
								   <label for="adminReason">Reason</label>
								   <textarea id="adminReason" placeholder="Reason for adjustment..." rows="3"></textarea>
							   </div>
							   <button type="button" id="adjustRepBtn" class="btn-primary">Adjust Reputation</button>
						   </div>
						<div class="admin-card">
							<h4>Data Repair</h4>
							<p>Fixes inconsistencies where a user's total reputation does not match the sum of their categories. The difference will be added to the 'Legacy' category.</p>
							<button type="button" id="repairDataBtn" class="btn-primary">Repair Data</button>
							<div id="repairResult" style="margin-top: 1rem;"></div>
						</div>
						   <div class="admin-card">
							   <h4>User Lookup</h4>
							   <div class="form-group">
								   <label for="lookupUserId">User ID</label>
								   <input type="text" id="lookupUserId" placeholder="User ID or mention">
							   </div>
							   <button type="button" id="lookupUserBtn" class="btn-secondary">Lookup User</button>
							   <div id="userLookupResult" style="margin-top: 1rem;"></div>
						   </div>
					   </div>
				   </div>
				   <div id="repStatsSection" style="display: none;" class="settings-section">
					   <h3>📊 Server Statistics</h3>
					   <div id="statsGrid" style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));"></div>
				   </div>
				   <div id="repAuditSection" style="display: none;" class="settings-section">
					   <h3>📋 Audit Log</h3>
					   <div id="auditLoading" style="display: none; text-align: center; padding: 20px;">
						   <p>Loading audit log...</p>
					   </div>
					   <div id="auditContent">
						   <div id="auditList" class="audit-list"></div>
					   </div>
				   </div>
			   </div>
		   `,

		   script: `(function() {
			   console.log("🏆 Reputation Plugin: Initializing frontend component...");
			   
			   const repServerSelect = document.getElementById("repServerSelect");
			   const repSettingsContainer = document.getElementById("repSettingsContainer");
			   const repLeaderboardSection = document.getElementById("repLeaderboardSection");
			   const repAdminSection = document.getElementById("repAdminSection");
			   const repStatsSection = document.getElementById("repStatsSection");
			   const repAuditSection = document.getElementById("repAuditSection");
			   
			   const repEnabled = document.getElementById("repEnabled");
			   const autoThanks = document.getElementById("autoThanks");
			   const reactionRep = document.getElementById("reactionRep");
			   const repEmoji = document.getElementById("repEmoji");
			   const customName = document.getElementById("customName");
			   const cooldownTime = document.getElementById("cooldownTime");
			   const dailyLimit = document.getElementById("dailyLimit");
			   const weeklyLimit = document.getElementById("weeklyLimit");
			   const decayEnabled = document.getElementById("decayEnabled");
			   const logChannelSelect = document.getElementById("logChannelSelect");
			   const announcementChannelSelect = document.getElementById("announcementChannelSelect");
			   const anonymousRep = document.getElementById("anonymousRep");
			   const saveRepSettings = document.getElementById("saveRepSettings");
			   
			   const leaderboardType = document.getElementById("leaderboardType");
			   const leaderboardLoading = document.getElementById("leaderboardLoading");
			   const leaderboardContent = document.getElementById("leaderboardContent");
			   const leaderboardList = document.getElementById("leaderboardList");
			   
			   const adminUserId = document.getElementById("adminUserId");
			   const adminCategory = document.getElementById("adminCategory");
			   const adminAmount = document.getElementById("adminAmount");
			   const adminReason = document.getElementById("adminReason");
			   const adjustRepBtn = document.getElementById("adjustRepBtn");
			   const lookupUserId = document.getElementById("lookupUserId");
			   const lookupUserBtn = document.getElementById("lookupUserBtn");
			   const userLookupResult = document.getElementById("userLookupResult");
			   
			   const statsGrid = document.getElementById("statsGrid");
			   const auditLoading = document.getElementById("auditLoading");
			   const auditContent = document.getElementById("auditContent");
			   const auditList = document.getElementById("auditList");
			   
			   let currentServerId = null;

			   console.log("🏆 Reputation Plugin: DOM elements found, setting up event listeners...");

			   async function loadServers() {
				   console.log("🏆 Loading servers...");
				   try {
					   const response = await fetch("/api/servers");
					   const servers = await response.json();
					   
					   console.log("🏆 Received servers:", servers.length);
					   
					   repServerSelect.innerHTML = '<option value="">Select a server...</option>';
					   servers.forEach(server => {
						   const option = document.createElement("option");
						   option.value = server.id;
						   option.textContent = server.name;
						   repServerSelect.appendChild(option);
					   });
					   
					   console.log("🏆 Server dropdown populated successfully");
				   } catch (error) {
					   console.error("🏆 Error loading servers:", error);
					   if (typeof showNotification === "function") {
						   showNotification("Error loading servers", "error");
					   }
				   }
			   }

			   if (repServerSelect) {
					console.log("🏆 Setting up server select event listener...");
					loadServers();
					repServerSelect.addEventListener("change", async (e) => {
						currentServerId = e.target.value;
						console.log("🏆 Server changed to:", currentServerId);
						
						if (currentServerId) {
							hideSections();
							
							console.log("🏆 Loading channels and server data...");
							await loadServerData();
							
							showSections();
						} else {
							hideSections();
						}
					});
				}

			   function showSections() {
				   console.log("🏆 Showing plugin sections...");
				   [repSettingsContainer, repLeaderboardSection, repAdminSection, repStatsSection, repAuditSection].forEach(el => el.style.display = 'block');
			   }

			   function hideSections() {
				   console.log("🏆 Hiding plugin sections...");
				   [repSettingsContainer, repLeaderboardSection, repAdminSection, repStatsSection, repAuditSection].forEach(el => el.style.display = 'none');
			   }

			   async function loadServerData() {
					console.log("🏆 Loading server data for:", currentServerId);
					try {
						const response = await fetch("/api/plugins/reputation/data/" + currentServerId);
						const data = await response.json();
						
						console.log("🏆 Server data response:", data);
						
						if (response.ok) {
							console.log("🏆 Loading channels first...");
							await loadChannels();
							
							console.log("🏆 Waiting before populating settings...");
							setTimeout(() => {
								console.log("🏆 Populating settings with data:", data.settings);
								populateSettings(data.settings);
							}, 300);
							
							populateStats(data.stats);
							await loadLeaderboard();
							await loadAuditLog();
						} else {
							console.error("🏆 Server data error:", data.error);
							showNotification(data.error || "Failed to load reputation data", "error");
						}
					} catch (error) {
						console.error("🏆 Error loading server data:", error);
						showNotification("Failed to load reputation data", "error");
					}
				}
			   
			   async function loadChannels() {
					if (!currentServerId) {
						console.warn("🏆 No server ID for loading channels");
						return;
					}
					
					console.log("🏆 Loading channels for server:", currentServerId);
					
					try {
						const response = await fetch("/api/channels/" + currentServerId);
						console.log("🏆 Channels API response status:", response.status);
						
						if (!response.ok) {
							throw new Error("HTTP " + response.status);
						}
						const channels = await response.json();
						
						console.log("🏆 Received channels:", channels);
						console.log("🏆 Total channels received:", channels.length);
						
						// Clear existing options first
						logChannelSelect.innerHTML = '<option value="">No logging</option>';
						announcementChannelSelect.innerHTML = '<option value="">Use current channel</option>';

						// Filter text channels and add them to both dropdowns
						const textChannels = channels.filter(channel => channel.type === 0);
						console.log("🏆 Text channels found:", textChannels.length);
						console.log("🏆 Text channels details:", textChannels.map(c => ({ id: c.id, name: c.name, type: c.type })));

						textChannels.forEach(channel => {
							console.log("🏆 Adding channel to dropdowns:", channel.name, "ID:", channel.id);
							
							// Add to log channel dropdown
							const logOption = document.createElement("option");
							logOption.value = channel.id;
							logOption.textContent = "#" + channel.name;
							logChannelSelect.appendChild(logOption);
							
							// Add to announcement channel dropdown
							const announceOption = document.createElement("option");
							announceOption.value = channel.id;
							announceOption.textContent = "#" + channel.name;
							announcementChannelSelect.appendChild(announceOption);
						});
						
						console.log("🏆 Channel dropdowns populated successfully");
						console.log("🏆 Log channel options:", Array.from(logChannelSelect.options).map(o => ({value: o.value, text: o.textContent})));
						console.log("🏆 Announcement channel options:", Array.from(announcementChannelSelect.options).map(o => ({value: o.value, text: o.textContent})));
						
					} catch (error) {
						console.error("🏆 Error loading channels:", error);
						logChannelSelect.innerHTML = '<option value="">Error loading channels</option>';
						announcementChannelSelect.innerHTML = '<option value="">Error loading channels</option>';
						
						if (typeof showNotification === "function") {
							showNotification("Failed to load channels: " + error.message, "error");
						}
					}
				}

			   function populateSettings(settings) {
					console.log("🏆 Populating settings:", settings);
					
					repEnabled.checked = settings.enabled;
					autoThanks.checked = settings.autoThanks;
					reactionRep.checked = settings.reactionRep;
					repEmoji.value = settings.repEmoji || "👍";
					customName.value = settings.customName || "Reputation";
					cooldownTime.value = Math.floor((settings.cooldown || 3600000) / 60000);
					dailyLimit.value = settings.dailyLimit || 10;
					weeklyLimit.value = settings.weeklyLimit || 50;
					decayEnabled.checked = settings.decayEnabled;
					anonymousRep.checked = settings.anonymousRep || false; // Fixed: Default to false

					// Hardcode the channel values and hide the dropdowns
					console.log("🏆 Setting hardcoded channel values");
					
					// Set hardcoded values
					logChannelSelect.value = '1390475947832250458';
					announcementChannelSelect.value = '1390335452439121920';
					
					// Add the hardcoded options if they don't exist
					if (!logChannelSelect.querySelector('option[value="1390475947832250458"]')) {
						const logOption = document.createElement("option");
						logOption.value = '1390475947832250458';
						logOption.textContent = "#logs (hardcoded)";
						logChannelSelect.appendChild(logOption);
						logChannelSelect.value = '1390475947832250458';
					}
					
					if (!announcementChannelSelect.querySelector('option[value="1390335452439121920"]')) {
						const announceOption = document.createElement("option");
						announceOption.value = '1390335452439121920';
						announceOption.textContent = "#announcements (hardcoded)";
						announcementChannelSelect.appendChild(announceOption);
						announcementChannelSelect.value = '1390335452439121920';
					}
					
					// Disable the dropdowns to show they're hardcoded
					logChannelSelect.disabled = true;
					announcementChannelSelect.disabled = true;
					
					console.log("🏆 Hardcoded channels set - Log:", logChannelSelect.value, "Announcement:", announcementChannelSelect.value);
				}

			   function populateStats(stats) {
				   console.log("🏆 Populating stats:", stats);
				   statsGrid.innerHTML = 
					   '<div class="stat-card">' +
						   '<div class="stat-number">' + (stats.totalUsers || 0) + '</div>' +
						   '<div class="stat-label">Total Users</div>' +
					   '</div>' +
					   '<div class="stat-card">' +
						   '<div class="stat-number">' + (stats.totalReputation || 0) + '</div>' +
						   '<div class="stat-label">Total Reputation</div>' +
					   '</div>' +
					   '<div class="stat-card">' +
						   '<div class="stat-number">' + (stats.activeUsers || 0) + '</div>' +
						   '<div class="stat-label">Active Users (30d)</div>' +
					   '</div>' +
					   '<div class="stat-card">' +
						   '<div class="stat-number">' + (stats.averageRep || 0) + '</div>' +
						   '<div class="stat-label">Average Reputation</div>' +
					   '</div>';
			   }
			   
			   if (saveRepSettings) {
				   console.log("🏆 Setting up save settings event listener...");
				   saveRepSettings.addEventListener("click", async () => {
					   if (!currentServerId) return;

					   console.log("🏆 Saving reputation settings...");

					   const btnText = saveRepSettings.querySelector(".btn-text");
					   const btnLoader = saveRepSettings.querySelector(".btn-loader");
					   
					   btnText.style.display = "none";
					   btnLoader.style.display = "inline";
					   saveRepSettings.disabled = true;

					   try {
						   const settings = {
							   enabled: repEnabled.checked,
							   autoThanks: autoThanks.checked,
							   reactionRep: reactionRep.checked,
							   repEmoji: repEmoji.value.trim() || "👍",
							   customName: customName.value.trim() || "Reputation",
							   cooldown: parseInt(cooldownTime.value) * 60000,
							   dailyLimit: parseInt(dailyLimit.value),
							   weeklyLimit: parseInt(weeklyLimit.value),
							   decayEnabled: decayEnabled.checked,
							   logChannel: '1390475947832250458', // Hardcoded
							   announcementChannel: '1390335452439121920', // Hardcoded
							   anonymousRep: anonymousRep.checked
						   };

						   console.log("🏆 Settings to save:", settings);

						   const response = await fetch("/api/plugins/reputation/settings/" + currentServerId, {
							   method: "POST",
							   headers: { "Content-Type": "application/json" },
							   body: JSON.stringify(settings)
						   });
						   const result = await response.json();
						   
						   console.log("🏆 Save response:", result);
						   
						   if (response.ok) {
							   showNotification("Reputation settings saved!", "success");
						   } else {
							   showNotification(result.error || "Failed to save settings", "error");
						   }
					   } catch (error) {
						   console.error("🏆 Error saving settings:", error);
						   showNotification("Failed to save settings", "error");
					   } finally {
						   btnText.style.display = "inline";
						   btnLoader.style.display = "none";
						   saveRepSettings.disabled = false;
					   }
				   });
			   }

			   if (leaderboardType) {
				   leaderboardType.addEventListener("change", loadLeaderboard);
			   }

			   async function loadLeaderboard() {
				   if (!currentServerId) return;

				   leaderboardLoading.style.display = "block";
				   leaderboardContent.style.display = "none";

				   try {
					   const type = leaderboardType.value || "overall";
					   const response = await fetch("/api/plugins/reputation/leaderboard/" + currentServerId + "?type=" + type + "&limit=15");
					   const leaderboard = await response.json();
					   if (response.ok) {
						   displayLeaderboard(leaderboard, type);
					   } else {
						   showNotification(leaderboard.error || "Failed to load leaderboard", "error");
					   }
				   } catch (error) {
					   showNotification("Failed to load leaderboard", "error");
				   } finally {
					   leaderboardLoading.style.display = "none";
					   leaderboardContent.style.display = "block";
				   }
			   }

			   function displayLeaderboard(leaderboard, type) {
				   if (!leaderboard.length) {
					   leaderboardList.innerHTML = '<p style="text-align: center; opacity: 0.7;">No reputation data found.</p>';
					   return;
				   }

				   leaderboardList.innerHTML = leaderboard.map((entry, index) => {
					   const position = index + 1;
					   const medal = position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : "<b>" + position + ".</b>";
					   let reputation = 0;
					   switch(type) {
						   case 'weekly': reputation = entry.weeklyRep || 0; break;
						   case 'monthly': reputation = entry.monthlyRep || 0; break;
						   case 'overall': reputation = entry.total || 0; break;
						   default: reputation = (entry.categories && entry.categories[type]) ? entry.categories[type] : 0; break;
					   }
					   return '<div class="leaderboard-entry">' +
							   '<div class="rank">' + medal + '</div>' +
							   '<div class="user-info">' +
								   '<div class="user-name">User ' + entry.userId + '</div>' +
							   '</div>' +
							   '<div class="reputation">' + reputation + ' rep</div>' +
						   '</div>';
				   }).join("");
			   }

			   if (adjustRepBtn) {
				   adjustRepBtn.addEventListener("click", async () => {
					   if (!currentServerId) return;

					   const userId = adminUserId.value.trim().replace(/[<@!>]/g, "");
					   const category = adminCategory.value;
					   const amount = parseInt(adminAmount.value);
					   const reason = adminReason.value.trim();

					   if (!userId || !reason) {
						   showNotification("Please fill in all fields", "error");
						   return;
					   }
					   
					   try {
						   const response = await fetch("/api/plugins/reputation/adjust/" + currentServerId, {
							   method: "POST",
							   headers: { "Content-Type": "application/json" },
							   body: JSON.stringify({ userId, category, amount, reason })
						   });
						   const result = await response.json();
						   if (response.ok) {
							   showNotification("Successfully adjusted reputation for user " + userId, "success");
							   await loadLeaderboard();
							   await loadAuditLog();
						   } else {
							   showNotification(result.error || "Failed to adjust reputation", "error");
						   }
					   } catch (error) {
						   showNotification("Failed to adjust reputation", "error");
					   }
				   });
			   }
			   
			   if (lookupUserBtn) {
				   lookupUserBtn.addEventListener("click", async () => {
						if (!currentServerId) return;

					   const userId = lookupUserId.value.trim().replace(/[<@!>]/g, "");
					   if (!userId) {
						   showNotification("Please enter a user ID", "error");
						   return;
					   }
					   
					   try {
						   const response = await fetch("/api/plugins/reputation/user/" + currentServerId + "/" + userId);
						   const data = await response.json();
						   if(response.ok) {
							   displayUserLookup(data, userId);
						   } else {
							   showNotification(data.error || "Failed to lookup user", "error");
						   }
					   } catch (error) {
						   showNotification("Failed to lookup user", "error");
					   }
				   });
			   }

			   function displayUserLookup(data, userId) {
				   const rep = data.reputation;
				   const categoriesHTML = Object.entries(rep.categories)
					   .map(([cat, val]) => '<div><strong>' + cat.charAt(0).toUpperCase() + cat.slice(1) + ':</strong> ' + (val || 0) + '</div>')
					   .join('');

				   userLookupResult.innerHTML = 
					   '<div class="user-lookup-card">' +
						   '<h5>User ' + userId + '</h5>' +
						   '<div class="rep-breakdown">' +
							   '<div><strong>Total:</strong> ' + rep.total + '</div>' +
							   '<div><strong>Given:</strong> ' + rep.given + '</div>' +
							   categoriesHTML +
						   '</div>' +
						   (rep.badges && rep.badges.length ? '<div class="badges">' + rep.badges.join(' ') + '</div>' : '') +
					   '</div>';
			   }

			   async function loadAuditLog() {
				   if (!currentServerId) return;
				   
				   auditLoading.style.display = "block";
				   auditContent.style.display = "none";

				   try {
					   const response = await fetch("/api/plugins/reputation/audit/" + currentServerId + "?limit=50");
					   const auditEvents = await response.json();
					   if (response.ok) {
						   displayAuditLog(auditEvents);
					   } else {
						   showNotification(auditEvents.error || "Failed to load audit log", "error");
					   }
				   } catch (error) {
						showNotification("Failed to load audit log", "error");
				   } finally {
					   auditLoading.style.display = "none";
					   auditContent.style.display = "block";
				   }
			   }

			   function displayAuditLog(events) {
				   if (!events.length) {
					   auditList.innerHTML = '<p style="text-align: center; opacity: 0.7;">No audit events found.</p>';
					   return;
				   }
				   const typeEmoji = { "rep_given": "➕", "rep_decay": "📉", "admin_adjust": "⚙️", "role_reward": "🏅" };
				   auditList.innerHTML = events.map(event => {
					   const date = new Date(event.timestamp).toLocaleString();
					   return '<div class="audit-entry">' +
							   '<div class="audit-icon">' + (typeEmoji[event.type] || "📝") + '</div>' +
							   '<div class="audit-details">' +
								   '<div class="audit-type">' + event.type.replace(/_/g, " ").toUpperCase() + '</div>' +
								   '<div class="audit-description">' +
									   'User ' + event.userId + (event.targetId ? " → " + event.targetId : "") + ' ' +
									   (event.details ? Object.entries(event.details).map(([k,v]) => k + ": " + v).join(", ") : "") +
								   '</div>' +
								   '<div class="audit-timestamp">' + date + '</div>' +
							   '</div>' +
						   '</div>';
				   }).join("");
			   }
			   
			   if (document.getElementById('repairDataBtn')) {
				   console.log("🏆 Setting up repair data button...");
				   document.getElementById('repairDataBtn').addEventListener('click', async () => {
					   if (!currentServerId) return;
					   
					   if (!confirm('This will scan all user data and repair inconsistencies. This action is safe. Continue?')) return;

					   const repairBtn = document.getElementById('repairDataBtn');
					   const repairResult = document.getElementById('repairResult');
					   
					   repairBtn.disabled = true;
					   repairBtn.textContent = 'Repairing...';
					   repairResult.innerHTML = '';

					   try {
						   const response = await fetch("/api/plugins/reputation/repair/" + currentServerId, {
							   method: 'POST'
						   });
						   const result = await response.json();
						   
						   if (response.ok && result.success) {
							   repairResult.innerHTML = '<div style="color: green;">✅ Repair complete! Fixed ' + result.repairsCount + ' users.</div>';
							   if (typeof showNotification === 'function') {
								   showNotification("Repaired data for " + result.repairsCount + " users", 'success');
							   }
							   await loadServerData();
						   } else {
							   repairResult.innerHTML = '<div style="color: red;">❌ ' + (result.error || 'Repair failed') + '</div>';
							   if (typeof showNotification === 'function') {
								   showNotification(result.error || 'Repair failed', 'error');
							   }
						   }
					   } catch (error) {
						   repairResult.innerHTML = '<div style="color: red;">❌ Error: ' + error.message + '</div>';
						   if (typeof showNotification === 'function') {
							   showNotification('Repair failed', 'error');
						   }
					   } finally {
						   repairBtn.disabled = false;
						   repairBtn.textContent = 'Repair Data';
					   }
				   });
			   }
			   
			   console.log("🏆 Reputation Plugin: Frontend component initialized successfully!");
		   })()`
	   };
   }
   
   validateUserId(userId) { return /^\d{17,19}$/.test(userId.replace(/[<@!>]/g, '')); }
   sanitizeInput(input) { return input.replace(/[<>]/g, '').trim(); }
   formatReputation(amount) {
	   if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'M';
	   if (amount >= 1000) return (amount / 1000).toFixed(1) + 'K';
	   return amount.toString();
   }
   getTimeUntilNext(lastGiven, cooldown) {
	   const timeLeft = cooldown - (Date.now() - lastGiven);
	   if (timeLeft <= 0) return null;
	   const hours = Math.floor(timeLeft / 3600000);
	   const minutes = Math.floor((timeLeft % 3600000) / 60000);
	   return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
   }
   
   async repairReputationData(guildId) {
	try {
		const data = await this.loadData();
		let repairsCount = 0;

		console.log('🔧 Starting reputation data repair...');

		for (const [userId, userData] of Object.entries(data.users)) {
			if (!userData[guildId]) continue;

			const userRep = userData[guildId];
			
			const categoryTotal = Object.values(userRep.categories || {}).reduce((sum, val) => sum + (val || 0), 0);
			const storedTotal = userRep.total || 0;
			const difference = storedTotal - categoryTotal;

			if (difference > 0) {
				console.log(`User ${userId}: Total=${storedTotal}, Categories=${categoryTotal}, Missing=${difference}`);
				
				if (!userRep.categories) userRep.categories = {};
				userRep.categories.legacy = (userRep.categories.legacy || 0) + difference;
				
				console.log(`✓ Added ${difference} to legacy category for user ${userId}`);
				repairsCount++;
			}
		}

		if (repairsCount > 0) {
			await this.saveData(data);
			console.log(`🎉 Repair complete! Fixed ${repairsCount} users.`);
			
			await this.logAuditEvent(guildId, 'data_repair', 'system', null, {
				repairsCount,
				timestamp: Date.now()
			}, 'system');
		} else {
			console.log('✅ No data issues found.');
		}

		return { success: true, repairsCount };
	} catch (error) {
		console.error('❌ Error repairing reputation data:', error);
		return { success: false, error: error.message };
	}
   }

   cleanup() {
	   if (this.decayInterval) clearInterval(this.decayInterval);
	   if (this.dailyResetInterval) clearInterval(this.dailyResetInterval);
	   if (this.weeklyResetInterval) clearInterval(this.weeklyResetInterval);
   }

   async exportData(guildId) {
	   try {
		   const data = await this.loadData();
		   const settings = await this.loadSettings();
		   const auditData = JSON.parse(await fs.readFile(this.auditFile, 'utf8').catch(() => '{"events":[]}'));
		   
		   return {
			   guildId,
			   exportDate: new Date().toISOString(),
			   data: {
				   users: Object.fromEntries(Object.entries(data.users).filter(([,u]) => u[guildId])),
				   history: data.history[guildId] || {},
				   leaderboards: data.leaderboards[guildId] || {}
			   },
			   settings: settings[guildId] || this.getDefaultSettings(),
			   audit: auditData.events.filter(e => e.guildId === guildId)
		   };
	   } catch (error) {
		   console.error('Error exporting reputation data:', error);
		   throw error;
	   }
   }

   async importData(guildId, importData) {
	   try {
		   const data = await this.loadData();
		   const settings = await this.loadSettings();
		   
		   for (const [userId, userData] of Object.entries(importData.data.users)) {
			   if (!data.users[userId]) data.users[userId] = {};
			   data.users[userId][guildId] = userData[guildId];
		   }
		   
		   data.history[guildId] = importData.data.history;
		   data.leaderboards[guildId] = importData.data.leaderboards;
		   settings[guildId] = importData.settings;
		   
		   await this.saveData(data);
		   await this.saveSettings(settings);
		   
		   await this.logAuditEvent(guildId, 'data_import', 'system', null, {
			   importDate: importData.exportDate,
			   userCount: Object.keys(importData.data.users).length
		   }, 'system');
		   
		   return true;
	   } catch (error) {
		   console.error('Error importing reputation data:', error);
		   throw error;
	   }
   }
}

module.exports = ReputationPlugin;