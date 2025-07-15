const fs = require('fs').promises;
const path = require('path');

class LevelingPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Leveling System';
        this.description = 'XP and leveling system with multiple XP sources and leaderboards';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        this.dataFile = path.join(__dirname, '../data/levelingData.json');
        this.settingsFile = path.join(__dirname, '../data/levelingSettings.json');
        
        // Backup configuration
        this.backupDir = path.join(__dirname, '../backups');
        this.maxBackups = 50; // Keep last 50 backups
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
        this.MESSAGE_COOLDOWN = 60000; // 1 minute between XP gains from messages
        this.VOICE_UPDATE_INTERVAL = 60000; // Update voice XP every minute
        
        this.userCooldowns = new Map();
        this.voiceTracker = new Map(); // Track voice session start times
        
        this.initializeData();
        this.initializeBackupSystem();
        this.setupRoutes();
        this.setupBackupRoutes();
        this.setupDiscordListeners();
        this.setupSlashCommands();
        
        // Start voice tracking interval
        setInterval(() => this.updateVoiceXP(), this.VOICE_UPDATE_INTERVAL);
    }

    async initializeData() {
        try {
            // Initialize leveling data file
            try {
                await fs.access(this.dataFile);
            } catch {
                const initialData = {
                    users: {}, // userId: { guildId: { xp, level, lastMessageTime, voiceTime, reactionsGiven, reactionsReceived } }
                    leaderboards: {} // guildId: { overall: [], voice: [], reactions: [], weekly: [], monthly: [] }
                };
                await fs.writeFile(this.dataFile, JSON.stringify(initialData, null, 2));
            }
            
            // Initialize settings file
            try {
                await fs.access(this.settingsFile);
            } catch {
                const initialSettings = {
                    // guildId: { xpSources: { messages, voice, reactions }, levelUpChannel, xpMultiplier }
                };
                await fs.writeFile(this.settingsFile, JSON.stringify(initialSettings, null, 2));
            }
        } catch (error) {
            console.error('Error initializing leveling data:', error);
        }
    }

    async initializeBackupSystem() {
        try {
            // Ensure backup directory exists
            await fs.mkdir(this.backupDir, { recursive: true });
            
            // Start automatic backup intervals
            this.startPeriodicBackups();
            this.startDailyBackups();
            
            // Create initial backup on startup
            await this.createBackup('startup');
            
            console.log('✓ Backup system initialized');
        } catch (error) {
            console.error('Error initializing backup system:', error);
        }
    }

    async createBackup(type = 'manual', reason = '') {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `levelingData_${type}_${timestamp}.json`;
            const backupPath = path.join(this.backupDir, backupFilename);
            
            // Read current data
            const currentData = await this.loadDataRaw();
            
            // Add backup metadata
            const backupData = {
                metadata: {
                    timestamp: new Date().toISOString(),
                    type: type,
                    reason: reason,
                    version: this.version,
                    userCount: Object.keys(currentData.users || {}).length,
                    guildCount: this.getGuildCount(currentData)
                },
                data: currentData
            };
            
            // Write backup file
            await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
            
            // Cleanup old backups
            await this.cleanupOldBackups();
            
            console.log(`✓ Backup created: ${backupFilename}`);
            return backupPath;
            
        } catch (error) {
            console.error('Error creating backup:', error);
            throw error;
        }
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            const parsedData = JSON.parse(data);
            
            // Validate data structure
            if (!parsedData.users || typeof parsedData.users !== 'object') {
                throw new Error('Invalid data structure: missing users object');
            }
            
            return parsedData;
        } catch (error) {
            console.error('Error loading leveling data:', error);
            
            // Try to restore from most recent backup
            const restoredData = await this.tryRestoreFromBackup();
            if (restoredData) {
                console.log('✓ Data restored from backup');
                return restoredData;
            }
            
            // Last resort: return empty structure
            console.warn('⚠️ No backups available. Starting with empty data.');
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

    async tryRestoreFromBackup() {
        try {
            const backupFiles = await fs.readdir(this.backupDir);
            const levelingBackups = backupFiles
                .filter(file => file.startsWith('levelingData_') && file.endsWith('.json'))
                .sort()
                .reverse(); // Most recent first
            
            for (const backupFile of levelingBackups) {
                try {
                    const backupPath = path.join(this.backupDir, backupFile);
                    const backupContent = await fs.readFile(backupPath, 'utf8');
                    const backup = JSON.parse(backupContent);
                    
                    // Check if backup has proper structure
                    const data = backup.data || backup; // Handle both new and old backup formats
                    if (data.users && typeof data.users === 'object') {
                        // Restore the main file
                        await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
                        console.log(`✓ Restored from backup: ${backupFile}`);
                        return data;
                    }
                } catch (error) {
                    console.warn(`⚠️ Backup file corrupted: ${backupFile}`);
                    continue;
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error restoring from backup:', error);
            return null;
        }
    }

    startPeriodicBackups() {
        // Create backup every 30 minutes
        setInterval(async () => {
            try {
                await this.createBackup('periodic', 'Automatic periodic backup');
            } catch (error) {
                console.error('Error in periodic backup:', error);
            }
        }, this.backupInterval);
    }

    startDailyBackups() {
        // Create daily backup at specified hour
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === this.dailyBackupHour && now.getMinutes() < 5) {
                try {
                    await this.createBackup('daily', 'Daily scheduled backup');
                } catch (error) {
                    console.error('Error in daily backup:', error);
                }
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
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
            
            // Sort by creation time (oldest first)
            const validBackups = levelingBackups
                .filter(backup => backup.stat)
                .sort((a, b) => a.stat.birthtime - b.stat.birthtime);
            
            // Remove old backups if we exceed the limit
            if (validBackups.length > this.maxBackups) {
                const toDelete = validBackups.slice(0, validBackups.length - this.maxBackups);
                
                for (const backup of toDelete) {
                    try {
                        await fs.unlink(backup.path);
                        console.log(`🗑️ Deleted old backup: ${backup.name}`);
                    } catch (error) {
                        console.warn(`Could not delete backup: ${backup.name}`);
                    }
                }
            }
            
        } catch (error) {
            console.error('Error cleaning up old backups:', error);
        }
    }

    getGuildCount(data) {
        const guilds = new Set();
        for (const user of Object.values(data.users || {})) {
            for (const guildId of Object.keys(user)) {
                guilds.add(guildId);
            }
        }
        return guilds.size;
    }

    async loadSettings() {
        try {
            const settings = await fs.readFile(this.settingsFile, 'utf8');
            return JSON.parse(settings);
        } catch (error) {
            console.error('Error loading leveling settings:', error);
            return {};
        }
    }

    async saveSettings(settings) {
        try {
            await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
        } catch (error) {
            console.error('Error saving leveling settings:', error);
        }
    }

    calculateLevel(xp) {
        // Level formula: level = floor(sqrt(xp / 100))
        // XP needed for level n: n^2 * 100
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

    // ✅ FIXED: Added preserveLevel parameter to prevent level recalculation during restore
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
        
        // ✅ FIXED: Only recalculate level if not preserving existing level
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

    // ✅ NEW: Function to validate and sync user data after restore
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
                            if (typeof userData[field] !== 'number') {
                                userData[field] = defaultValue;
                                changesMade = true;
                            }
                        }
                        
                        // ✅ IMPORTANT: Do NOT recalculate levels - preserve backed up levels
                        // Only validate that level is reasonable compared to XP
                        const calculatedLevel = this.calculateLevel(userData.xp);
                        if (userData.level < 0) {
                            userData.level = Math.max(0, calculatedLevel);
                            changesMade = true;
                        }
                        // Allow backed up levels to be higher than calculated (for custom/bonus levels)
                    }
                }
            }
            
            if (changesMade) {
                await this.saveData(data);
                console.log('✓ User data validated and synchronized');
            }
            
            return { success: true, changesMade };
        } catch (error) {
            console.error('Error validating user data:', error);
            return { success: false, error: error.message };
        }
    }

    async handleLevelUp(userId, guildId, newLevel, oldLevel) {
        try {
            const settings = await this.loadSettings();
            const guildSettings = settings[guildId];
            
            if (guildSettings && guildSettings.levelUpChannel) {
                const channel = this.client.channels.cache.get(guildSettings.levelUpChannel);
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
            
            // Emit level up event for other plugins (like auto-role) to listen to
            this.client.emit('levelUp', userId, guildId, newLevel, oldLevel);
            
        } catch (error) {
            console.error('Error handling level up:', error);
        }
    }

    setupDiscordListeners() {
        // Message XP
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;
            
            const settings = await this.loadSettings();
            const guildSettings = settings[message.guild.id];
            
            if (!guildSettings || !guildSettings.xpSources?.messages) return;
            
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
            const multiplier = guildSettings.xpMultiplier || 1;
            
            this.userCooldowns.set(cooldownKey, now);
            await this.addXP(userId, guildId, Math.floor(xpGain * multiplier), 'message');
        });

        // Voice XP tracking
        this.client.on('voiceStateUpdate', async (oldState, newState) => {
            const userId = newState.member?.id;
            if (!userId) return;
            
            const settings = await this.loadSettings();
            
            // User joined voice channel
            if (!oldState.channel && newState.channel) {
                const guildSettings = settings[newState.guild.id];
                if (guildSettings?.xpSources?.voice) {
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
        });

        // Reaction XP
        this.client.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot || !reaction.message.guild) return;
            
            const settings = await this.loadSettings();
            const guildSettings = settings[reaction.message.guild.id];
            
            if (!guildSettings?.xpSources?.reactions) return;
            
            const multiplier = guildSettings.xpMultiplier || 1;
            
            // XP for giving a reaction
            await this.addXP(user.id, reaction.message.guild.id, Math.floor(this.XP_RATES.REACTION_GIVEN * multiplier), 'reaction_given');
            
            // XP for receiving a reaction (message author)
            if (!reaction.message.author.bot) {
                await this.addXP(reaction.message.author.id, reaction.message.guild.id, Math.floor(this.XP_RATES.REACTION_RECEIVED * multiplier), 'reaction_received');
            }
        });
    }

    async updateVoiceXP() {
        const now = Date.now();
        const settings = await this.loadSettings();
        
        for (const [trackingKey, startTime] of this.voiceTracker.entries()) {
            const [userId, guildId] = trackingKey.split('-');
            const guildSettings = settings[guildId];
            
            if (!guildSettings?.xpSources?.voice) continue;
            
            const timeInVoice = now - startTime;
            if (timeInVoice >= this.VOICE_UPDATE_INTERVAL) {
                const xpGain = Math.floor(this.XP_RATES.VOICE_PER_MINUTE * (guildSettings.xpMultiplier || 1));
                await this.addXP(userId, guildId, xpGain, 'voice');
                
                // Update voice time stat
                const data = await this.loadData();
                if (data.users[userId] && data.users[userId][guildId]) {
                    data.users[userId][guildId].voiceTime += 1;
                    await this.saveData(data);
                }
                
                // Reset tracking time
                this.voiceTracker.set(trackingKey, now);
            }
        }
    }

    async generateLeaderboard(guildId, type = 'overall', limit = 10) {
        const data = await this.loadData();
        const leaderboard = [];
        
        for (const [userId, guilds] of Object.entries(data.users)) {
            if (guilds[guildId]) {
                const userData = guilds[guildId];
                let value;
                
                switch (type) {
                    case 'voice':
                        value = userData.voiceTime;
                        break;
                    case 'reactions':
                        value = userData.reactionsGiven + userData.reactionsReceived;
                        break;
                    default:
                        value = userData.xp;
                }
                
                leaderboard.push({
                    userId,
                    value,
                    level: userData.level,
                    xp: userData.xp
                });
            }
        }
        
        return leaderboard
            .sort((a, b) => b.value - a.value)
            .slice(0, limit);
    }

    setupRoutes() {
        // Get leveling settings
        this.app.get('/api/plugins/leveling/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const settings = await this.loadSettings();
                const guildSettings = settings[guildId] || {
                    xpSources: { messages: true, voice: true, reactions: true },
                    levelUpChannel: null,
                    xpMultiplier: 1.0
                };
                
                res.json(guildSettings);
            } catch (error) {
                console.error('Error getting leveling settings:', error);
                res.status(500).json({ error: 'Internal server error' });
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
                settings[guildId] = req.body;
                await this.saveSettings(settings);
                
                res.json({ success: true });
            } catch (error) {
                console.error('Error updating leveling settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get user level/XP
        this.app.get('/api/plugins/leveling/user/:guildId/:userId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, userId } = req.params;
                
                const data = await this.loadData();
                const userData = data.users[userId]?.[guildId] || {
                    xp: 0, level: 0, voiceTime: 0, reactionsGiven: 0, reactionsReceived: 0
                };
                
                const xpNeeded = this.getXPNeededForNextLevel(userData.xp);
                const xpForCurrentLevel = this.getXPForLevel(userData.level);
                const xpProgress = userData.xp - xpForCurrentLevel;
                const xpForNextLevel = this.getXPForLevel(userData.level + 1) - xpForCurrentLevel;
                
                res.json({
                    ...userData,
                    xpNeeded,
                    xpProgress,
                    xpForNextLevel,
                    progressPercentage: Math.floor((xpProgress / xpForNextLevel) * 100)
                });
            } catch (error) {
                console.error('Error getting user data:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get leaderboard
        this.app.get('/api/plugins/leveling/leaderboard/:guildId/:type?', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, type = 'overall' } = req.params;
                const limit = parseInt(req.query.limit) || 10;
                
                const leaderboard = await this.generateLeaderboard(guildId, type, limit);
                
                // Fetch user info for leaderboard
                const enrichedLeaderboard = await Promise.all(
                    leaderboard.map(async (entry, index) => {
                        try {
                            const user = await this.client.users.fetch(entry.userId);
                            return {
                                rank: index + 1,
                                userId: entry.userId,
                                username: user.username,
                                displayName: user.displayName || user.username,
                                avatar: user.displayAvatarURL(),
                                value: entry.value,
                                level: entry.level,
                                xp: entry.xp
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
                                xp: entry.xp
                            };
                        }
                    })
                );
                
                res.json(enrichedLeaderboard);
            } catch (error) {
                console.error('Error getting leaderboard:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Add XP manually (admin only)
        this.app.post('/api/plugins/leveling/addxp', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, userId, amount } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const userData = await this.addXP(userId, guildId, parseInt(amount), 'manual');
                res.json(userData);
            } catch (error) {
                console.error('Error adding XP:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

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

        // ✅ FIXED: Restore from backup with proper level preservation
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
                
                // ✅ IMPORTANT: Restore the data exactly as it was backed up
                // Do NOT recalculate levels - preserve them exactly
                await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
                
                // ✅ NEW: Validate restored data without changing levels
                const validationResult = await this.validateAndSyncUserData();
                
                res.json({
                    success: true,
                    message: `Successfully restored from backup: ${filename}`,
                    userCount: Object.keys(data.users).length,
                    validation: validationResult
                });
                
            } catch (error) {
                console.error('Error restoring backup:', error);
                res.status(500).json({ error: 'Failed to restore backup: ' + error.message });
            }
        });

        // ✅ NEW: Endpoint to manually sync data after restore if needed
        this.app.post('/api/plugins/leveling/sync', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const result = await this.validateAndSyncUserData();
                
                res.json({
                    success: true,
                    message: 'Data validation completed',
                    ...result
                });
                
            } catch (error) {
                console.error('Error syncing data:', error);
                res.status(500).json({ error: 'Failed to sync data: ' + error.message });
            }
        });
    }

    setupSlashCommands() {
        this.client.once('ready', async () => {
            try {
                const commands = [
                    {
                        name: 'level',
                        description: 'Check your or someone else\'s level and XP',
                        options: [
                            {
                                name: 'user',
                                description: 'The user to check (defaults to yourself)',
                                type: 6, // USER type
                                required: false
                            }
                        ]
                    },
                    {
                        name: 'leaderboard',
                        description: 'View the server leaderboard',
                        options: [
                            {
                                name: 'type',
                                description: 'Type of leaderboard to show',
                                type: 3, // STRING type
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
                                type: 4, // INTEGER type
                                required: false,
                                min_value: 1,
                                max_value: 25
                            }
                        ]
                    }
                ];

                // Register commands globally (you can also register per guild for faster updates during development)
                await this.client.application.commands.set(commands);
                console.log('✓ Leveling slash commands registered');
            } catch (error) {
                console.error('Error registering leveling slash commands:', error);
            }
        });

        // Handle slash command interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const { commandName, guildId, user } = interaction;

            if (commandName === 'level') {
                await this.handleLevelCommand(interaction);
            } else if (commandName === 'leaderboard') {
                await this.handleLeaderboardCommand(interaction);
            }
        });
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
                color: 0x7289da,
                title: `${targetUser.username}'s Level`,
                thumbnail: { url: targetUser.displayAvatarURL() },
                fields: [
                    { name: '📊 Level', value: userData.level.toString(), inline: true },
                    { name: '⭐ Total XP', value: userData.xp.toString(), inline: true },
                    { name: '🎯 XP to Next Level', value: xpNeeded.toString(), inline: true },
                    { name: '📈 Progress', value: `${xpProgress}/${xpForNextLevel} (${progressPercentage}%)`, inline: false }
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
                            valueText = `${entry.value} XP (Level ${entry.level})`;
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
                color: 0x00ff00,
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
            // Plugin identification
            id: 'leveling-plugin',
            name: 'Leveling System',
            description: 'Configure XP sources, view leaderboards, and manage user levels',
            icon: '📈',
            version: '1.0.0',
            
            // Plugin targets
            containerId: 'levelingPluginContainer',
            pageId: 'leveling',
            navIcon: '📈',
            
            // Complete HTML and script
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">📈</span> Leveling System</h3>
                        <p>Configure XP sources, view leaderboards, and manage user levels</p>
                    </div>

                    <div class="settings-section">
                        <h3>Settings</h3>
                        <div class="form-group">
                            <label for="levelingServerSelect">Server</label>
                            <select id="levelingServerSelect" required>
                                <option value="">Select a server...</option>
                            </select>
                        </div>

                        <div id="levelingSettingsContainer" style="display: none;">
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
                                            <div style="opacity: 0.7; font-size: 0.9em;">10 XP per minute</div>
                                        </div>
                                    </label>
                                    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                        <input type="checkbox" id="xpSourceReactions" style="margin-top: 3px; transform: scale(1.1);">
                                        <div>
                                            <div style="font-weight: 500; margin-bottom: 2px;">Reactions</div>
                                            <div style="opacity: 0.7; font-size: 0.9em;">5 XP for giving, 3 XP for receiving</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="levelUpChannelSelect">Level Up Notifications Channel (Optional)</label>
                                <select id="levelUpChannelSelect">
                                    <option value="">No notifications</option>
                                </select>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Choose where level up notifications will be sent
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
                        </div>
                    </div>

                    <div id="leaderboardSection" style="display: none;">
                        <h3>Leaderboards</h3>
                        <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                            <button type="button" class="leaderboard-btn active" data-type="overall" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer;">
                                Overall XP
                            </button>
                            <button type="button" class="leaderboard-btn" data-type="voice" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                Voice Activity
                            </button>
                            <button type="button" class="leaderboard-btn" data-type="reactions" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                Reactions
                            </button>
                        </div>

                        <div id="leaderboardContent" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; min-height: 200px;">
                            <div id="leaderboardLoading" style="text-align: center; opacity: 0.6; padding: 40px;">
                                Loading leaderboard...
                            </div>
                            <div id="leaderboardList" style="display: none;"></div>
                        </div>
                    </div>

                    <div id="adminSection" style="display: none;">
                        <h3>Admin Tools</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
                            <div class="form-group">
                                <label for="adminUserId">User ID</label>
                                <input type="text" id="adminUserId" placeholder="Enter Discord User ID...">
                            </div>
                            <div class="form-group">
                                <label for="adminXpAmount">XP Amount</label>
                                <input type="number" id="adminXpAmount" placeholder="Amount of XP to add..." min="1">
                            </div>
                            <button type="button" id="addXpBtn" style="padding: 8px 16px; background: rgba(76, 175, 80, 0.3); border: 1px solid rgba(76, 175, 80, 0.5); border-radius: 8px; color: white; cursor: pointer;">
                                Add XP
                            </button>
                        </div>
                    </div>
					
					<div id="backupSection" style="display: none;">
						<h3>💾 Backup Management</h3>
						<div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
							<div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
								<button type="button" id="createBackupBtn" style="padding: 8px 16px; background: rgba(76, 175, 80, 0.3); border: 1px solid rgba(76, 175, 80, 0.5); border-radius: 8px; color: white; cursor: pointer;">
									📁 Create Backup Now
								</button>
								<button type="button" id="refreshBackupsBtn" style="padding: 8px 16px; background: rgba(33, 150, 243, 0.3); border: 1px solid rgba(33, 150, 243, 0.5); border-radius: 8px; color: white; cursor: pointer;">
									🔄 Refresh List
								</button>
								<button type="button" id="syncDataBtn" style="padding: 8px 16px; background: rgba(255, 193, 7, 0.3); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 8px; color: white; cursor: pointer;">
									⚙️ Validate Data
								</button>
							</div>
							
							<div style="margin-bottom: 10px;">
								<label for="backupReason" style="display: block; margin-bottom: 5px; color: white;">Backup Reason (Optional):</label>
								<input type="text" id="backupReason" placeholder="e.g., Before major changes..." style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.1); color: white;">
							</div>
						</div>

						<div id="backupListContainer" style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px;">
							<h4 style="color: white; margin-top: 0;">📋 Available Backups</h4>
							<div id="backupLoading" style="text-align: center; opacity: 0.6; padding: 20px;">
								Loading backups...
							</div>
							<div id="backupList" style="display: none;"></div>
							<div id="backupEmpty" style="display: none; text-align: center; opacity: 0.6; padding: 20px;">
								No backups available
							</div>
						</div>

						<div style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px; padding: 15px; margin-top: 15px;">
							<h4 style="color: #ffc107; margin-top: 0;">⚙️ Automatic Backup Settings</h4>
							<ul style="color: rgba(255,255,255,0.8); margin: 0; padding-left: 20px;">
								<li>🕐 <strong>Periodic backups:</strong> Every 30 minutes</li>
								<li>🌅 <strong>Daily backups:</strong> Every day at 3:00 AM</li>
								<li>💾 <strong>Backup retention:</strong> Last 50 backups kept</li>
								<li>🛡️ <strong>Auto-restore:</strong> Enabled on data corruption</li>
								<li>✅ <strong>Level preservation:</strong> Backed up levels are preserved exactly</li>
							</ul>
						</div>
					</div>

                    <div class="info-section">
                        <h3>Available Commands</h3>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="margin-bottom: 15px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px;">/level [@user]</code>
                                <span style="color: rgba(255, 255, 255, 0.8); margin-left: 10px;">Check your or someone else's level and XP</span>
                            </div>
                            <div>
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px;">/leaderboard [type] [limit]</code>
                                <span style="color: rgba(255, 255, 255, 0.8); margin-left: 10px;">View server leaderboards (overall, voice, reactions)</span>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            script: `
                // Leveling Plugin Frontend Logic
                (function() {
                    const levelingServerSelect = document.getElementById('levelingServerSelect');
                    const levelingSettingsContainer = document.getElementById('levelingSettingsContainer');
                    const leaderboardSection = document.getElementById('leaderboardSection');
                    const adminSection = document.getElementById('adminSection');
                    const backupSection = document.getElementById('backupSection');
                    const xpSourceMessages = document.getElementById('xpSourceMessages');
                    const xpSourceVoice = document.getElementById('xpSourceVoice');
                    const xpSourceReactions = document.getElementById('xpSourceReactions');
                    const levelUpChannelSelect = document.getElementById('levelUpChannelSelect');
                    const xpMultiplier = document.getElementById('xpMultiplier');
                    const saveLevelingSettings = document.getElementById('saveLevelingSettings');
                    const leaderboardContent = document.getElementById('leaderboardContent');
                    const leaderboardLoading = document.getElementById('leaderboardLoading');
                    const leaderboardList = document.getElementById('leaderboardList');
                    const adminUserId = document.getElementById('adminUserId');
                    const adminXpAmount = document.getElementById('adminXpAmount');
                    const addXpBtn = document.getElementById('addXpBtn');
                    const btnText = saveLevelingSettings ? saveLevelingSettings.querySelector('.btn-text') : null;
                    const btnLoader = saveLevelingSettings ? saveLevelingSettings.querySelector('.btn-loader') : null;
                    
                    // Backup elements
                    const createBackupBtn = document.getElementById('createBackupBtn');
                    const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
                    const syncDataBtn = document.getElementById('syncDataBtn');
                    const backupReason = document.getElementById('backupReason');
                    const backupLoading = document.getElementById('backupLoading');
                    const backupList = document.getElementById('backupList');
                    const backupEmpty = document.getElementById('backupEmpty');
                    
                    let currentGuildId = null;
                    let currentLeaderboardType = 'overall';
                    
                    // Initialize if elements exist
                    if (levelingServerSelect) {
                        levelingServerSelect.addEventListener('change', function() {
                            currentGuildId = this.value;
                            if (currentGuildId) {
                                loadLevelingSettings();
                                loadLevelingChannels();
                                loadLeaderboard();
                                loadBackups();
                                if (levelingSettingsContainer) levelingSettingsContainer.style.display = 'block';
                                if (leaderboardSection) leaderboardSection.style.display = 'block';
                                if (adminSection) adminSection.style.display = 'block';
                                if (backupSection) backupSection.style.display = 'block';
                            } else {
                                if (levelingSettingsContainer) levelingSettingsContainer.style.display = 'none';
                                if (leaderboardSection) leaderboardSection.style.display = 'none';
                                if (adminSection) adminSection.style.display = 'none';
                                if (backupSection) backupSection.style.display = 'none';
                            }
                        });
                        loadLevelingServers();
                    }
                    
                    if (saveLevelingSettings) {
                        saveLevelingSettings.addEventListener('click', saveLevelingSettings_internal);
                    }
                    
                    if (addXpBtn) {
                        addXpBtn.addEventListener('click', addXPToUser);
                    }
                    
                    if (createBackupBtn) {
                        createBackupBtn.addEventListener('click', createManualBackup);
                    }
                    
                    if (refreshBackupsBtn) {
                        refreshBackupsBtn.addEventListener('click', loadBackups);
                    }
                    
                    if (syncDataBtn) {
                        syncDataBtn.addEventListener('click', syncUserData);
                    }
                    
                    // Leaderboard type buttons
                    const leaderboardBtns = document.querySelectorAll('.leaderboard-btn');
                    leaderboardBtns.forEach(btn => {
                        btn.addEventListener('click', function() {
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
                    
                    async function loadLevelingServers() {
                        try {
                            const response = await fetch('/api/servers');
                            const servers = await response.json();
                            
                            if (levelingServerSelect) {
                                levelingServerSelect.innerHTML = '<option value="">Select a server...</option>';
                                servers.forEach(server => {
                                    const option = document.createElement('option');
                                    option.value = server.id;
                                    option.textContent = server.name;
                                    levelingServerSelect.appendChild(option);
                                });
                            }
                        } catch (error) {
                            console.error('Error loading servers:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading servers', 'error');
                            }
                        }
                    }
                    
                    async function loadLevelingChannels() {
                        try {
                            if (levelUpChannelSelect) {
                                levelUpChannelSelect.innerHTML = '<option value="">Loading...</option>';
                                const response = await fetch(\`/api/channels/\${currentGuildId}\`);
                                const channels = await response.json();
                                
                                levelUpChannelSelect.innerHTML = '<option value="">No notifications</option>';
                                channels.forEach(channel => {
                                    const option = document.createElement('option');
                                    option.value = channel.id;
                                    option.textContent = \`# \${channel.name}\`;
                                    levelUpChannelSelect.appendChild(option);
                                });
                            }
                        } catch (error) {
                            console.error('Error loading channels:', error);
                            if (levelUpChannelSelect) {
                                levelUpChannelSelect.innerHTML = '<option value="">Error loading channels</option>';
                            }
                        }
                    }
                    
                    async function loadLevelingSettings() {
                        try {
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentGuildId}\`);
                            const settings = await response.json();
                            
                            if (xpSourceMessages) xpSourceMessages.checked = settings.xpSources?.messages || false;
                            if (xpSourceVoice) xpSourceVoice.checked = settings.xpSources?.voice || false;
                            if (xpSourceReactions) xpSourceReactions.checked = settings.xpSources?.reactions || false;
                            if (levelUpChannelSelect && settings.levelUpChannel) {
                                levelUpChannelSelect.value = settings.levelUpChannel;
                            }
                            if (xpMultiplier) xpMultiplier.value = settings.xpMultiplier || 1.0;
                        } catch (error) {
                            console.error('Error loading leveling settings:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading leveling settings', 'error');
                            }
                        }
                    }
                    
                    async function saveLevelingSettings_internal() {
                        if (!currentGuildId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (saveLevelingSettings) saveLevelingSettings.disabled = true;
                            
                            const settings = {
                                xpSources: {
                                    messages: xpSourceMessages ? xpSourceMessages.checked : false,
                                    voice: xpSourceVoice ? xpSourceVoice.checked : false,
                                    reactions: xpSourceReactions ? xpSourceReactions.checked : false
                                },
                                levelUpChannel: levelUpChannelSelect ? levelUpChannelSelect.value || null : null,
                                xpMultiplier: xpMultiplier ? parseFloat(xpMultiplier.value) || 1.0 : 1.0
                            };
                            
                            const response = await fetch(\`/api/plugins/leveling/settings/\${currentGuildId}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(settings)
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                if (window.showNotification) {
                                    window.showNotification('Leveling settings saved successfully!', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to save settings');
                            }
                        } catch (error) {
                            console.error('Error saving leveling settings:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        } finally {
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (saveLevelingSettings) saveLevelingSettings.disabled = false;
                        }
                    }
                    
                    async function loadLeaderboard() {
                        if (!currentGuildId) return;
                        
                        try {
                            if (leaderboardLoading) leaderboardLoading.style.display = 'block';
                            if (leaderboardList) leaderboardList.style.display = 'none';
                            
                            const response = await fetch(\`/api/plugins/leveling/leaderboard/\${currentGuildId}/\${currentLeaderboardType}?limit=10\`);
                            const leaderboard = await response.json();
                            
                            if (leaderboardList) {
                                if (leaderboard.length === 0) {
                                    leaderboardList.innerHTML = '<div style="text-align: center; opacity: 0.6; padding: 40px;">No data available for this leaderboard.</div>';
                                } else {
                                    leaderboardList.innerHTML = leaderboard.map((entry, index) => {
                                        const rank = index + 1;
                                        const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '📍';
                                        
                                        let valueText;
                                        switch (currentLeaderboardType) {
                                            case 'voice':
                                                valueText = \`\${entry.value} minutes\`;
                                                break;
                                            case 'reactions':
                                                valueText = \`\${entry.value} reactions\`;
                                                break;
                                            default:
                                                valueText = \`\${entry.value} XP (Level \${entry.level})\`;
                                        }
                                        
                                        return \`
                                            <div style="display: flex; align-items: center; padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                                                <span style="font-size: 1.2em; margin-right: 10px;">\${emoji}</span>
                                                \${entry.avatar ? \`<img src="\${entry.avatar}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 10px;" alt="Avatar">\` : '<div style="width: 32px; height: 32px; background: rgba(255,255,255,0.2); border-radius: 50%; margin-right: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold;">' + entry.username.charAt(0).toUpperCase() + '</div>'}
                                                <div style="flex: 1;">
                                                    <div style="font-weight: bold;">\${rank}. \${entry.username}</div>
                                                    <div style="opacity: 0.7; font-size: 0.9em;">\${valueText}</div>
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
                                leaderboardList.innerHTML = '<div style="text-align: center; color: #ff6b6b; padding: 40px;">Error loading leaderboard</div>';
                                leaderboardList.style.display = 'block';
                            }
                            if (leaderboardLoading) leaderboardLoading.style.display = 'none';
                        }
                    }
                    
                    async function addXPToUser() {
                        const userId = adminUserId ? adminUserId.value.trim() : '';
                        const amount = adminXpAmount ? parseInt(adminXpAmount.value) : 0;
                        
                        if (!userId || !amount) {
                            if (window.showNotification) {
                                window.showNotification('Please enter both User ID and XP amount', 'error');
                            }
                            return;
                        }
                        
                        try {
                            const response = await fetch('/api/plugins/leveling/addxp', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    guildId: currentGuildId,
                                    userId: userId,
                                    amount: amount
                                })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                if (window.showNotification) {
                                    window.showNotification(\`Added \${amount} XP to user successfully!\`, 'success');
                                }
                                if (adminUserId) adminUserId.value = '';
                                if (adminXpAmount) adminXpAmount.value = '';
                                loadLeaderboard(); // Refresh leaderboard
                            } else {
                                throw new Error(result.error || 'Failed to add XP');
                            }
                        } catch (error) {
                            console.error('Error adding XP:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    async function createManualBackup() {
                        if (!currentGuildId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            createBackupBtn.disabled = true;
                            createBackupBtn.textContent = '⏳ Creating...';
                            
                            const reason = backupReason ? backupReason.value.trim() : '';
                            
                            const response = await fetch('/api/plugins/leveling/backup/create', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reason })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                if (window.showNotification) {
                                    window.showNotification('Backup created successfully!', 'success');
                                }
                                if (backupReason) backupReason.value = '';
                                loadBackups(); // Refresh the list
                            } else {
                                throw new Error(result.error || 'Failed to create backup');
                            }
                        } catch (error) {
                            console.error('Error creating backup:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        } finally {
                            createBackupBtn.disabled = false;
                            createBackupBtn.textContent = '📁 Create Backup Now';
                        }
                    }
                    
                    async function syncUserData() {
                        if (!currentGuildId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            syncDataBtn.disabled = true;
                            syncDataBtn.textContent = '⏳ Validating...';
                            
                            const response = await fetch('/api/plugins/leveling/sync', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ guildId: currentGuildId })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                const message = result.changesMade 
                                    ? 'Data validation completed with changes made'
                                    : 'Data validation completed - no changes needed';
                                    
                                if (window.showNotification) {
                                    window.showNotification(message, 'success');
                                }
                                loadLeaderboard(); // Refresh leaderboard
                            } else {
                                throw new Error(result.error || 'Failed to sync data');
                            }
                        } catch (error) {
                            console.error('Error syncing data:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        } finally {
                            syncDataBtn.disabled = false;
                            syncDataBtn.textContent = '⚙️ Validate Data';
                        }
                    }
                    
                    async function loadBackups() {
                        try {
                            if (backupLoading) backupLoading.style.display = 'block';
                            if (backupList) backupList.style.display = 'none';
                            if (backupEmpty) backupEmpty.style.display = 'none';
                            
                            const response = await fetch('/api/plugins/leveling/backup/list');
                            const backups = await response.json();
                            
                            if (backupList) {
                                if (backups.length === 0) {
                                    backupEmpty.style.display = 'block';
                                } else {
                                    backupList.innerHTML = backups.map(backup => {
                                        const date = new Date(backup.created).toLocaleString();
                                        const size = (backup.size / 1024).toFixed(1) + ' KB';
                                        const type = backup.metadata?.type || 'unknown';
                                        const reason = backup.metadata?.reason || 'No reason provided';
                                        const userCount = backup.metadata?.userCount || 'Unknown';
                                        
                                        const typeColors = {
                                            manual: '#4CAF50',
                                            periodic: '#2196F3',
                                            daily: '#FF9800',
                                            startup: '#9C27B0',
                                            'pre-save': '#607D8B',
                                            'pre-restore': '#795548'
                                        };
                                        
                                        const typeColor = typeColors[type] || '#666';
                                        
                                        return \`
                                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 8px; border-left: 4px solid \${typeColor};">
                                                <div style="flex: 1;">
                                                    <div style="font-weight: bold; color: white; margin-bottom: 4px;">
                                                        \${backup.filename}
                                                    </div>
                                                    <div style="font-size: 0.85em; opacity: 0.7; margin-bottom: 2px;">
                                                        📅 \${date} | 📊 \${size} | 👥 \${userCount} users
                                                    </div>
                                                    <div style="font-size: 0.8em; opacity: 0.6;">
                                                        <span style="background: \${typeColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-right: 8px;">
                                                            \${type.toUpperCase()}
                                                        </span>
                                                        \${reason}
                                                    </div>
                                                </div>
                                                <div style="display: flex; gap: 8px;">
                                                    <button type="button" onclick="window.restoreBackup('\${backup.filename}')" style="padding: 6px 12px; background: rgba(255, 193, 7, 0.3); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 6px; color: white; cursor: pointer; font-size: 0.85em;">
                                                        🔄 Restore
                                                    </button>
                                                </div>
                                            </div>
                                        \`;
                                    }).join('');
                                    backupList.style.display = 'block';
                                }
                            }
                            
                            if (backupLoading) backupLoading.style.display = 'none';
                        } catch (error) {
                            console.error('Error loading backups:', error);
                            if (backupList) {
                                backupList.innerHTML = '<div style="text-align: center; color: #ff6b6b; padding: 20px;">Error loading backups</div>';
                                backupList.style.display = 'block';
                            }
                            if (backupLoading) backupLoading.style.display = 'none';
                        }
                    }
                    
                    // ✅ FIXED: Global function for restore button with level preservation warning
                    window.restoreBackup = async function(filename) {
                        if (!confirm(\`⚠️ IMPORTANT: Are you sure you want to restore from backup "\${filename}"? 

This will:
• Overwrite ALL current leveling data
• Restore levels EXACTLY as they were backed up
• Create a backup of current state first
• Preserve all backed-up user levels without recalculation

This action cannot be undone (except by restoring another backup).\`)) {
                            return;
                        }
                        
                        try {
                            const response = await fetch('/api/plugins/leveling/backup/restore', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    filename: filename,
                                    guildId: currentGuildId 
                                })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                if (window.showNotification) {
                                    window.showNotification(\`✅ Successfully restored from \${filename}! Levels preserved exactly as backed up.\`, 'success');
                                }
                                loadBackups(); // Refresh the list
                                loadLeaderboard(); // Refresh leaderboard if visible
                            } else {
                                throw new Error(result.error || 'Failed to restore backup');
                            }
                        } catch (error) {
                            console.error('Error restoring backup:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        }
                    };
                })();
            `
        };
    }
}

module.exports = LevelingPlugin;