const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType } = require('discord.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load plugins
const pluginLoader = require('./plugins/pluginLoader');

// Environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Discord client setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates, // Needed for voice XP in levelingPlugin
        GatewayIntentBits.GuildMembers,     // Needed for member data and auto-role
        GatewayIntentBits.GuildMessageReactions, // Needed for reaction roles
        GatewayIntentBits.GuildPresences,   // Needed for online status (requires privileged intent)
    ]
});

// =====================================================
// LOGGING SYSTEM FOR CONSOLE WIDGET
// =====================================================

// Store recent logs in memory (in production, consider using Redis or database)
const recentLogs = [];
const MAX_LOGS = 1000;

// Function to add log entry
function addLogEntry(level, message, serverId = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        serverId
    };
    
    recentLogs.push(logEntry);
    
    // Keep only recent logs
    if (recentLogs.length > MAX_LOGS) {
        recentLogs.shift();
    }
    
    // Log to console as well
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
}

// =====================================================
// MODERATOR ACTION TRACKING
// =====================================================

// Store moderator actions in memory (in production, use proper storage)
const moderatorActions = {};

// Function to track moderator actions
function trackModeratorAction(userId, serverId, action, plugin, details = '') {
    const key = `${serverId}:${userId}`;
    const today = new Date().toDateString();
    
    if (!moderatorActions[key]) {
        moderatorActions[key] = {};
    }
    
    if (!moderatorActions[key][today]) {
        moderatorActions[key][today] = [];
    }
    
    moderatorActions[key][today].push({
        timestamp: new Date().toISOString(),
        action,
        plugin,
        details
    });
    
    // Also add to console log
    addLogEntry('info', `${action} by user ${userId} via ${plugin}`, serverId);
}

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Express setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true in production with HTTPS
}));

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Middleware to check authentication
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Helper function to check if user has admin permissions or moderator role in a guild
async function hasAdminPermissions(userId, guildId) {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;
        
        const member = await guild.members.fetch(userId);
        
        // Check if user has Administrator permissions
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }
        
        // Check if user has the specific Moderator role
        const moderatorRoleId = '957213892810010645';
        if (member.roles.cache.has(moderatorRoleId)) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking admin permissions:', error);
        return false;
    }
}

// =====================================================
// BASIC ROUTES
// =====================================================

// Routes
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/login' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// =====================================================
// CORE API ROUTES
// =====================================================

// API Routes
app.get('/api/user', ensureAuthenticated, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        discriminator: req.user.discriminator,
        avatar: req.user.avatar
    });
});

app.get('/api/servers', ensureAuthenticated, async (req, res) => {
    try {
        const userGuilds = [];
        
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const hasPerms = await hasAdminPermissions(req.user.id, guildId);
                if (hasPerms) {
                    userGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.icon,
                        memberCount: guild.memberCount,
                        ownerId: guild.ownerId
                    });
                }
            } catch (error) {
                console.error(`Error checking permissions for guild ${guild.name}:`, error);
            }
        }
        
        res.json(userGuilds);
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

app.get('/api/channels/:serverId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'Admin permissions required' });
        }

        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const channels = guild.channels.cache
            .filter(channel => channel.type === ChannelType.GuildText) 
            .sort((a, b) => a.position - b.position)
            .map(channel => ({
                id: channel.id,
                name: channel.name
            }));
        
        res.json(channels);
    } catch (error) {
        console.error('Error fetching channels:', error);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.get('/api/roles/:serverId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'Admin permissions required' });
        }

        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const roles = guild.roles.cache
            .filter(role => role.name !== '@everyone')
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.hexColor,
                position: role.position,
                mentionable: role.mentionable
            }))
            .sort((a, b) => b.position - a.position);

        res.json(roles);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// =====================================================
// NEW DASHBOARD API ENDPOINTS
// =====================================================

// Get online users for a server
app.get('/api/servers/:serverId/online-users', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        // Try to count members with online status (requires presence intent)
        let onlineCount = 0;
        try {
            await guild.members.fetch(); // Ensure we have fresh member data
            onlineCount = guild.members.cache.filter(member => 
                member.presence?.status === 'online' || 
                member.presence?.status === 'dnd' || 
                member.presence?.status === 'idle'
            ).size;
        } catch (error) {
            // If presence data is not available, estimate online users
            onlineCount = Math.floor(guild.memberCount * 0.15); // ~15% online estimate
        }

        res.json({ count: onlineCount });
    } catch (error) {
        console.error('Error fetching online users:', error);
        res.status(500).json({ error: 'Failed to fetch online users' });
    }
});

// Get server stats (member count, etc.)
app.get('/api/servers/:serverId/stats', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        await guild.members.fetch(); // Ensure we have fresh member data
        
        const stats = {
            memberCount: guild.memberCount,
            botCount: guild.members.cache.filter(member => member.user.bot).size,
            humanCount: guild.members.cache.filter(member => !member.user.bot).size,
            channelCount: guild.channels.cache.size,
            roleCount: guild.roles.cache.size,
            createdAt: guild.createdAt,
            ownerId: guild.ownerId
        };

        res.json(stats);
    } catch (error) {
        console.error('Error fetching server stats:', error);
        res.status(500).json({ error: 'Failed to fetch server stats' });
    }
});

// Get total messages for a server (from leveling data if available)
app.get('/api/servers/:serverId/message-stats', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        // Try to get data from leveling plugin
        let totalMessages = 0;
        try {
            const levelingDataPath = path.join(__dirname, 'data', 'levelingData.json');
            if (fs.existsSync(levelingDataPath)) {
                const levelingData = JSON.parse(fs.readFileSync(levelingDataPath, 'utf8'));
                
                if (levelingData.users) {
                    // Sum up messages from all users in this server
                    Object.values(levelingData.users).forEach(userGuilds => {
                        if (userGuilds[serverId] && userGuilds[serverId].messages) {
                            totalMessages += userGuilds[serverId].messages;
                        }
                    });
                }
            }
        } catch (error) {
            console.log('Could not read leveling data for message stats');
        }
        
        // If no data found, estimate based on server size
        if (totalMessages === 0) {
            const guild = client.guilds.cache.get(serverId);
            totalMessages = guild ? Math.floor(guild.memberCount * 75) : 0;
        }
        
        res.json({ totalMessages });
    } catch (error) {
        console.error('Error fetching message stats:', error);
        res.status(500).json({ error: 'Failed to fetch message stats' });
    }
});

// Get moderators and their recent actions
app.get('/api/servers/:serverId/moderators', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        const guild = client.guilds.cache.get(serverId);
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        await guild.members.fetch(); // Ensure we have fresh member data
        
        const moderators = [];
        const moderatorRoleId = '957213892810010645'; // Your specific moderator role ID
        
        guild.members.cache.forEach(member => {
            const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
            const isModerator = member.roles.cache.has(moderatorRoleId);
            
            if (isAdmin || isModerator) {
                // Get action count for today
                const key = `${serverId}:${member.user.id}`;
                const today = new Date().toDateString();
                const todayActions = moderatorActions[key]?.[today] || [];
                
                moderators.push({
                    userId: member.user.id,
                    username: member.user.username,
                    displayName: member.displayName,
                    avatar: member.user.avatar ? 
                        `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : 
                        null,
                    role: isAdmin ? 'Administrator' : 'Moderator',
                    lastAction: todayActions.length > 0 ? 
                        `${todayActions[todayActions.length - 1].action} via ${todayActions[todayActions.length - 1].plugin}` : 
                        'No recent activity',
                    actionCount: todayActions.length
                });
            }
        });

        res.json(moderators);
    } catch (error) {
        console.error('Error fetching moderators:', error);
        res.status(500).json({ error: 'Failed to fetch moderators' });
    }
});

// Get server activity data for charts (placeholder)
app.get('/api/servers/:serverId/activity', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        // Generate mock 24-hour activity data
        const activityData = [];
        const now = new Date();
        
        for (let i = 23; i >= 0; i--) {
            const hour = new Date(now.getTime() - (i * 60 * 60 * 1000));
            activityData.push({
                hour: hour.getHours(),
                timestamp: hour.toISOString(),
                messages: Math.floor(Math.random() * 50) + 10,
                users: Math.floor(Math.random() * 20) + 5
            });
        }

        res.json({ activityData });
    } catch (error) {
        console.error('Error fetching activity data:', error);
        res.status(500).json({ error: 'Failed to fetch activity data' });
    }
});

// =====================================================
// ENHANCED PLUGIN INTEGRATION ENDPOINTS
// =====================================================

// Enhanced leaderboard endpoint for reputation plugin
app.get('/api/plugins/reputation/leaderboard/:serverId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { limit = 10 } = req.query;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        // Check if reputation plugin is loaded
        const reputationPlugin = pluginLoader.plugins.find(p => p.name && p.name.toLowerCase().includes('reputation'));
        if (!reputationPlugin) {
            return res.status(404).json({ error: 'Reputation plugin not found' });
        }

        // Try to get leaderboard data
        if (typeof reputationPlugin.generateLeaderboard === 'function') {
            const leaderboard = await reputationPlugin.generateLeaderboard(serverId, 'overall', parseInt(limit));
            
            // Enhance with Discord user data
            const guild = client.guilds.cache.get(serverId);
            if (guild) {
                const enhancedLeaderboard = await Promise.all(leaderboard.map(async (entry) => {
                    try {
                        const member = await guild.members.fetch(entry.userId).catch(() => null);
                        return {
                            ...entry,
                            username: member?.user.username || `User ${entry.userId}`,
                            avatar: member?.user.avatar ? 
                                `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : 
                                null
                        };
                    } catch {
                        return {
                            ...entry,
                            username: `User ${entry.userId}`,
                            avatar: null
                        };
                    }
                }));
                
                res.json(enhancedLeaderboard);
            } else {
                res.json(leaderboard);
            }
        } else {
            res.status(500).json({ error: 'Reputation plugin does not support leaderboards' });
        }
    } catch (error) {
        console.error('Error fetching reputation leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch reputation leaderboard' });
    }
});

// Enhanced leaderboard endpoint for leveling plugin
app.get('/api/plugins/leveling/leaderboard/:serverId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        const { limit = 10 } = req.query;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        // Try to read leveling data directly
        try {
            const levelingDataPath = path.join(__dirname, 'data', 'levelingData.json');
            if (!fs.existsSync(levelingDataPath)) {
                return res.json([]);
            }

            const levelingData = JSON.parse(fs.readFileSync(levelingDataPath, 'utf8'));
            
            if (!levelingData.users) {
                return res.json([]);
            }

            const leaderboard = [];
            
            // Extract users for this server
            Object.entries(levelingData.users).forEach(([userId, userGuilds]) => {
                if (userGuilds[serverId]) {
                    const userData = userGuilds[serverId];
                    leaderboard.push({
                        userId,
                        level: userData.level || 0,
                        xp: userData.xp || 0,
                        totalXP: userData.xp || 0
                    });
                }
            });
            
            // Sort by XP and limit
            leaderboard.sort((a, b) => b.totalXP - a.totalXP);
            const topUsers = leaderboard.slice(0, parseInt(limit));

            // Enhance with Discord user data
            const guild = client.guilds.cache.get(serverId);
            if (guild) {
                const enhancedLeaderboard = await Promise.all(topUsers.map(async (entry) => {
                    try {
                        const member = await guild.members.fetch(entry.userId).catch(() => null);
                        return {
                            ...entry,
                            username: member?.user.username || `User ${entry.userId}`,
                            avatar: member?.user.avatar ? 
                                `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : 
                                null
                        };
                    } catch {
                        return {
                            ...entry,
                            username: `User ${entry.userId}`,
                            avatar: null
                        };
                    }
                }));
                
                res.json(enhancedLeaderboard);
            } else {
                res.json(topUsers);
            }
        } catch (fileError) {
            console.log('Could not read leveling data file');
            res.json([]);
        }
    } catch (error) {
        console.error('Error fetching leveling leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leveling leaderboard' });
    }
});

// =====================================================
// LOGGING AND TRACKING ENDPOINTS
// =====================================================

// Get recent logs
app.get('/api/logs', ensureAuthenticated, (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const logs = recentLogs.slice(-parseInt(limit));
        res.json(logs);
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Get moderator actions
app.get('/api/moderator-actions/:serverId/:userId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId, userId } = req.params;
        
        if (!await hasAdminPermissions(req.user.id, serverId)) {
            return res.status(403).json({ error: 'No admin permissions' });
        }

        const key = `${serverId}:${userId}`;
        const today = new Date().toDateString();
        const actions = moderatorActions[key]?.[today] || [];
        
        res.json({ actions, count: actions.length });
    } catch (error) {
        console.error('Error fetching moderator actions:', error);
        res.status(500).json({ error: 'Failed to fetch moderator actions' });
    }
});

// =====================================================
// ENHANCED MESSAGE ENDPOINT
// =====================================================

// Enhanced message endpoint with better error handling and logging
app.post('/api/message', ensureAuthenticated, upload.array('attachments'), async (req, res) => {
    try {
        const { serverId, channelId, message } = req.body;
        const files = req.files;
        
        const hasAdmin = await hasAdminPermissions(req.user.id, serverId);
        if (!hasAdmin) {
            return res.status(403).json({ error: 'No admin permissions' });
        }
        
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        const messageOptions = { content: message };
        
        if (files && files.length > 0) {
            messageOptions.files = files.map(file => ({
                attachment: file.path,
                name: file.originalname
            }));
        }
        
        const sentMessage = await channel.send(messageOptions);
        
        // Track moderator action
        trackModeratorAction(req.user.id, serverId, 'Sent Message', 'Quick Sender', `Channel: ${channel.name}`);
        
        // Clean up uploaded files
        if (files) {
            files.forEach(file => {
                fs.unlink(file.path, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });
            });
        }
        
        res.json({ success: true, messageId: sentMessage.id });
    } catch (error) {
        console.error('Error sending message:', error);
        addLogEntry('error', `Failed to send message: ${error.message}`);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// API endpoint to expose plugin components
app.get('/api/plugins/components', ensureAuthenticated, (req, res) => {
    try {
        const components = pluginLoader.getPluginComponents();
        res.json(components);
    } catch (error) {
        console.error('Error getting plugin components:', error);
        res.status(500).json({ error: 'Failed to get plugin components' });
    }
});

// =====================================================
// PLUGIN LOADING AND DISCORD EVENTS
// =====================================================

// Load and register plugin routes
pluginLoader.loadPlugins(app, client, ensureAuthenticated, hasAdminPermissions);

// Discord client events
client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    addLogEntry('success', `Bot connected as ${client.user.tag}`);
    addLogEntry('info', `Bot is active in ${client.guilds.cache.size} servers`);
    
    try {
        console.log('Gathering slash commands from all plugins...');
        const allCommands = pluginLoader.getAllSlashCommands();
        if (allCommands.length === 0) {
            console.log('No slash commands to register.');
            addLogEntry('info', 'No slash commands to register');
            return;
        }

        console.log(`Found ${allCommands.length} total slash commands. Registering...`);
        addLogEntry('info', `Registering ${allCommands.length} slash commands`);
        
        const guilds = client.guilds.cache;

        for (const guild of guilds.values()) {
            try {
                await guild.commands.set(allCommands);
                console.log(`✓ Successfully registered ${allCommands.length} commands for guild: ${guild.name}`);
                addLogEntry('success', `Registered commands for guild: ${guild.name}`);
            } catch (err) {
                console.error(`❌ Failed to register commands for guild ${guild.name}:`, err.rawError ? err.rawError.errors : err);
                addLogEntry('error', `Failed to register commands for guild: ${guild.name}`);
            }
        }
        console.log('🚀 Slash command registration process completed for all guilds.');
        addLogEntry('success', 'Slash command registration completed');
    } catch (error) {
        console.error('Error during global slash command registration:', error);
        addLogEntry('error', `Slash command registration failed: ${error.message}`);
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
    addLogEntry('error', `Discord client error: ${error.message}`);
});

client.on('warn', (warning) => {
    console.warn('Discord client warning:', warning);
    addLogEntry('warning', `Discord client warning: ${warning}`);
});

// =====================================================
// STARTUP
// =====================================================

// Start the application
async function start() {
    try {
        addLogEntry('info', 'Starting Fuji Fruit Bot...');
        
        await client.login(process.env.DISCORD_BOT_TOKEN);
        
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            addLogEntry('success', `Dashboard server started on port ${PORT}`);
            addLogEntry('info', `Visit http://localhost:${PORT} to access the dashboard`);
        });
    } catch (error) {
        console.error('Error starting the application:', error);
        addLogEntry('error', `Failed to start application: ${error.message}`);
    }
}

// Export functions for plugin use
module.exports = {
    addLogEntry,
    trackModeratorAction,
    client,
    app
};

start();

console.log('✅ Enhanced dashboard API endpoints loaded');