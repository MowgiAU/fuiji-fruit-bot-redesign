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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
    ]
});

// Multer setup
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
    limits: { fileSize: 25 * 1024 * 1024 }
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
    cookie: { secure: false }
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

// Middleware & Helpers
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

async function hasAdminPermissions(userId, guildId) {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;
        
        const member = await guild.members.fetch(userId);
        
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }
        
        // --- MODIFICATION: Updated to the correct moderator role ID ---
        const moderatorRoleId = '1392001716962197514'; 
        if (member.roles.cache.has(moderatorRoleId)) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking admin permissions:', error);
        return false;
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect(req.isAuthenticated() ? '/dashboard' : '/login');
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
        const userGuilds = req.user.guilds || [];
        const botGuilds = client.guilds.cache.map(guild => guild.id);
        
        const adminServers = [];
        
        for (const guild of userGuilds) {
            const hasAdmin = await hasAdminPermissions(req.user.id, guild.id);
            const botInGuild = botGuilds.includes(guild.id);
            
            if (hasAdmin && botInGuild) {
                const discordGuild = client.guilds.cache.get(guild.id);
                if (discordGuild) {
                    adminServers.push({
                        id: guild.id,
                        name: discordGuild.name,
                        icon: guild.icon
                    });
                }
            }
        }
        
        res.json(adminServers);
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

app.get('/api/channels/:serverId', ensureAuthenticated, async (req, res) => {
    try {
        const { serverId } = req.params;
        const hasAdmin = await hasAdminPermissions(req.user.id, serverId);
        
        if (!hasAdmin) {
            return res.status(403).json({ error: 'No admin permissions' });
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

// Get roles for a server
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

app.get('/api/plugins/components', ensureAuthenticated, (req, res) => {
    try {
        const components = pluginLoader.getPluginComponents();
        res.json(components);
    } catch (error) {
        console.error('Error getting plugin components:', error);
        res.status(500).json({ error: 'Failed to get plugin components' });
    }
});

// Load and register plugin routes
pluginLoader.loadPlugins(app, client, ensureAuthenticated, hasAdminPermissions);


// --- FIX: Centralized Slash Command Registration ---
client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    try {
        console.log('Gathering slash commands from all plugins...');
        const allCommands = pluginLoader.getAllSlashCommands();
        if (allCommands.length === 0) {
            console.log('No slash commands to register.');
            return;
        }

        console.log(`Found ${allCommands.length} total slash commands. Registering...`);
        const guilds = client.guilds.cache;

        for (const guild of guilds.values()) {
            try {
                await guild.commands.set(allCommands);
                console.log(`✓ Successfully registered ${allCommands.length} commands for guild: ${guild.name}`);
            } catch (err) {
                console.error(`❌ Failed to register commands for guild ${guild.name}:`, err.rawError ? err.rawError.errors : err);
            }
        }
        console.log('🚀 Slash command registration process completed for all guilds.');
    } catch (error) {
        console.error('Error during global slash command registration:', error);
    }
});


client.on('error', console.error);

// Start the application
async function start() {
    try {
        await client.login(process.env.DISCORD_BOT_TOKEN);
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Error starting the application:', error);
    }
}

start();