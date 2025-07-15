const fs = require('fs').promises;
const path = require('path');
const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, ComponentType } = require('discord.js');

class GenreDiscoveryPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Genre Discovery';
        this.description = 'Helps music producers share and discover each other\'s genres and setups';
        this.version = '2.2.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // File paths
        this.dataFile = './data/genreDiscoveryData.json';
        this.settingsFile = './data/genreDiscoverySettings.json';
        this.categoriesFile = './data/genreCategories.json';
        
        // Default categories
        this.defaultGenreChunks = [
            {
                label: "Electronic Dance Music",
                emoji: "🕺",
                genres: ["House", "Techno", "Trance", "Dubstep", "Drum & Bass", "Electro", "Progressive House", "Deep House", "Tech House", "Minimal", "Hardcore", "Hardstyle", "Future Bass", "Trap", "Bass Music", "UK Garage", "Jersey Club", "Breakbeat", "IDM", "Ambient Techno"]
            },
            {
                label: "Hip-Hop & Rap",
                emoji: "🎤",
                genres: ["Hip-Hop", "Rap", "Trap", "Boom Bap", "Lo-Fi Hip-Hop", "Cloud Rap", "Drill", "Grime", "UK Drill", "Phonk", "Memphis Rap", "West Coast", "East Coast", "Southern Hip-Hop", "Conscious Rap", "Gangsta Rap", "Alternative Hip-Hop", "Jazz Rap", "Trip-Hop", "Instrumental Hip-Hop"]
            },
            {
                label: "Pop & Mainstream",
                emoji: "🌟",
                genres: ["Pop", "Electropop", "Synthpop", "Indie Pop", "K-Pop", "J-Pop", "Bubblegum Pop", "Teen Pop", "Dance Pop", "Pop Rock", "Power Pop", "Art Pop", "Experimental Pop", "Dream Pop", "Hyperpop", "PC Music", "Bedroom Pop", "Chillwave", "Vaporwave", "Retrowave"]
            },
            {
                label: "Rock & Alternative",
                emoji: "🎸",
                genres: ["Rock", "Alternative Rock", "Indie Rock", "Post-Rock", "Prog Rock", "Psychedelic Rock", "Garage Rock", "Punk Rock", "Post-Punk", "New Wave", "Grunge", "Shoegaze", "Britpop", "Math Rock", "Noise Rock", "Experimental Rock", "Art Rock", "Krautrock", "Space Rock", "Stoner Rock"]
            },
            {
                label: "R&B & Soul",
                emoji: "💝",
                genres: ["R&B", "Soul", "Neo-Soul", "Contemporary R&B", "Alternative R&B", "Future R&B", "Funk", "Disco", "Motown", "Gospel", "Blues", "Jazz-Funk", "Smooth Jazz", "Quiet Storm", "New Jack Swing", "Afrobeat", "Afro-Soul", "UK Soul", "P-Funk", "Acid Jazz"]
            },
            {
                label: "Experimental & Ambient",
                emoji: "🌌",
                genres: ["Experimental", "Ambient", "Drone", "Dark Ambient", "Field Recording", "Musique Concrète", "Glitch", "Microsound", "Lowercase", "Onkyo", "EAI", "Free Improvisation", "Sound Art", "Acousmatic", "Electroacoustic", "Tape Music", "Circuit Bending", "Noise", "Harsh Noise", "Power Electronics"]
            },
            {
                label: "World & Cultural",
                emoji: "🌍",
                genres: ["World Music", "Reggae", "Dub", "Reggaeton", "Latin", "Salsa", "Cumbia", "Bossa Nova", "Samba", "Flamenco", "Celtic", "Folk", "Country", "Bluegrass", "Cajun", "Zydeco", "Klezmer", "Gypsy Jazz", "Indian Classical", "Qawwali", "Gamelan", "Taiko", "Aboriginal", "Native American"]
            },
            {
                label: "Metal & Heavy",
                emoji: "🔥",
                genres: ["Metal", "Heavy Metal", "Death Metal", "Black Metal", "Thrash Metal", "Doom Metal", "Sludge Metal", "Post-Metal", "Progressive Metal", "Power Metal", "Speed Metal", "Symphonic Metal", "Folk Metal", "Viking Metal", "Industrial Metal", "Nu Metal", "Metalcore", "Deathcore", "Grindcore", "Hardcore Punk"]
            }
        ];

        this.defaultDawChunks = [
            {
                label: "Professional DAWs",
                emoji: "🎛️",
                daws: ["Ableton Live", "Logic Pro", "Pro Tools", "Cubase", "Nuendo", "Studio One", "Reason", "FL Studio", "Bitwig Studio", "Reaper", "Digital Performer", "Samplitude", "Sequoia", "Pyramix", "Luna"]
            },
            {
                label: "Free & Open Source",
                emoji: "🆓",
                daws: ["Audacity", "GarageBand", "Cakewalk", "Tracktion T7", "Ardour", "LMMS", "Zrythm", "MusE", "Qtractor", "Rosegarden", "Hydrogen", "TuxGuitar", "Audiotool", "BandLab", "Soundtrap"]
            },
            {
                label: "Mobile & Tablet",
                emoji: "📱",
                daws: ["GarageBand iOS", "FL Studio Mobile", "Cubasis", "Auria Pro", "Beatmaker", "Figure", "iMaschine", "Groovebox", "Music Maker JAM", "BandLab Mobile", "Caustic", "SunVox", "nanoloop", "KORG Gadget"]
            },
            {
                label: "Hardware & Grooveboxes",
                emoji: "🎹",
                daws: ["MPC Live", "MPC X", "Elektron Digitakt", "Elektron Octatrack", "Roland MC-707", "Roland SP-404", "KORG Volca", "Teenage Engineering OP-1", "Polyend Tracker", "1010music Blackbox", "Squarp Pyramid", "Native Instruments Maschine", "Arturia BeatStep Pro"]
            },
            {
                label: "Browser & Cloud",
                emoji: "🌐",
                daws: ["BandLab", "Soundtrap", "Audiotool", "Chrome Music Lab", "Splice Sounds", "Amped Studio", "Soundation", "JamStudio", "Looplabs", "AudioSauna", "TwistedWave Online", "WeVideo"]
            },
            {
                label: "Specialized Tools",
                emoji: "🔧",
                daws: ["Max/MSP", "Pure Data", "SuperCollider", "ChucK", "Csound", "Reaktor", "VCV Rack", "Cardinal", "Plogue Bidule", "Usine", "AudioMulch", "Plogue Sforzando", "MuseScore", "Sibelius", "Finale"]
            }
        ];

        this.genreChunks = [...this.defaultGenreChunks];
        this.dawChunks = [...this.defaultDawChunks];
        
        this.initializeData();
        this.setupRoutes();
        this.setupDiscordCommands();
        
        console.log('✅ Genre Discovery Plugin v2.2 loaded with dashboard integration');
    }

    async initializeData() {
        try {
            await fs.mkdir('./data', { recursive: true });
            
            // Initialize data files if they don't exist
            try {
                await fs.access(this.dataFile);
            } catch {
                await fs.writeFile(this.dataFile, JSON.stringify({}, null, 2));
            }

            try {
                await fs.access(this.settingsFile);
            } catch {
                await fs.writeFile(this.settingsFile, JSON.stringify({}, null, 2));
            }
            
            try {
                await fs.access(this.categoriesFile);
                const categories = await this.loadCategories();
                this.genreChunks = categories.genreChunks || this.defaultGenreChunks;
                this.dawChunks = categories.dawChunks || this.defaultDawChunks;
            } catch {
                this.genreChunks = [...this.defaultGenreChunks];
                this.dawChunks = [...this.defaultDawChunks];
                await this.saveCategories();
            }
        } catch (error) {
            console.error('Error initializing Genre Discovery data:', error);
        }
    }

    // ============================================================================
    // DATA MANAGEMENT
    // ============================================================================

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
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

    async loadCategories() {
        try {
            const categories = await fs.readFile(this.categoriesFile, 'utf8');
            return JSON.parse(categories);
        } catch (error) {
            return { genreChunks: this.defaultGenreChunks, dawChunks: this.defaultDawChunks };
        }
    }

    async saveCategories() {
        const categories = {
            genreChunks: this.genreChunks,
            dawChunks: this.dawChunks
        };
        await fs.writeFile(this.categoriesFile, JSON.stringify(categories, null, 2));
    }

    getUserData(data, guildId, userId) {
        if (!data[guildId]) data[guildId] = {};
        if (!data[guildId][userId]) data[guildId][userId] = { genres: [], daws: [] };
        return data[guildId][userId];
    }

    // ============================================================================
    // API ROUTES
    // ============================================================================

    setupRoutes() {
        // Get user's genres and DAWs
        this.app.get('/api/plugins/genrediscovery/user/:guildId/:userId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, userId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, userId);
                res.json(userData);
            } catch (error) {
                console.error('Error getting user data:', error);
                res.status(500).json({ error: 'Failed to get user data' });
            }
        });

        // Get guild settings
        this.app.get('/api/plugins/genrediscovery/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const settings = await this.loadSettings();
                res.json(settings[guildId] || { logChannelId: null });
            } catch (error) {
                console.error('Error getting settings:', error);
                res.status(500).json({ error: 'Failed to get settings' });
            }
        });

        // Update guild settings
        this.app.post('/api/plugins/genrediscovery/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const settings = await this.loadSettings();
                settings[guildId] = { ...settings[guildId], ...req.body };
                await this.saveSettings(settings);
                
                res.json({ success: true });
            } catch (error) {
                console.error('Error updating settings:', error);
                res.status(500).json({ error: 'Failed to update settings' });
            }
        });

        // Get categories
        this.app.get('/api/plugins/genrediscovery/categories', this.ensureAuthenticated, async (req, res) => {
            try {
                res.json({
                    genreChunks: this.genreChunks,
                    dawChunks: this.dawChunks
                });
            } catch (error) {
                console.error('Error getting categories:', error);
                res.status(500).json({ error: 'Failed to get categories' });
            }
        });

        // Add new category
        this.app.post('/api/plugins/genrediscovery/categories/:type', this.ensureAuthenticated, async (req, res) => {
            try {
                const { type } = req.params;
                const { categoryName, items } = req.body;
                
                if (type !== 'genre' && type !== 'daw') {
                    return res.status(400).json({ error: 'Invalid category type' });
                }
                
                const chunks = type === 'genre' ? this.genreChunks : this.dawChunks;
                const itemKey = type === 'genre' ? 'genres' : 'daws';
                
                chunks.push({
                    label: categoryName,
                    emoji: '🎵',
                    [itemKey]: items || []
                });
                
                await this.saveCategories();
                res.json({ success: true });
            } catch (error) {
                console.error('Error adding category:', error);
                res.status(500).json({ error: 'Failed to add category' });
            }
        });

        // Get guild stats
        this.app.get('/api/plugins/genrediscovery/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                
                const data = await this.loadData();
                const guildData = data[guildId] || {};
                
                const stats = {
                    totalUsers: Object.keys(guildData).length,
                    totalGenres: 0,
                    totalDAWs: 0,
                    mostPopularGenres: {},
                    mostPopularDAWs: {}
                };
                
                // Calculate stats
                for (const userData of Object.values(guildData)) {
                    if (userData.genres) {
                        stats.totalGenres += userData.genres.length;
                        userData.genres.forEach(genre => {
                            stats.mostPopularGenres[genre] = (stats.mostPopularGenres[genre] || 0) + 1;
                        });
                    }
                    if (userData.daws) {
                        stats.totalDAWs += userData.daws.length;
                        userData.daws.forEach(daw => {
                            stats.mostPopularDAWs[daw] = (stats.mostPopularDAWs[daw] || 0) + 1;
                        });
                    }
                }
                
                // Convert to sorted arrays
                stats.mostPopularGenres = Object.entries(stats.mostPopularGenres)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([name, count]) => ({ name, count }));
                    
                stats.mostPopularDAWs = Object.entries(stats.mostPopularDAWs)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([name, count]) => ({ name, count }));
                
                res.json(stats);
            } catch (error) {
                console.error('Error getting stats:', error);
                res.status(500).json({ error: 'Failed to get stats' });
            }
        });
    }

    // ============================================================================
    // DISCORD COMMANDS
    // ============================================================================

    setupDiscordCommands() {
        // Register slash commands (implementation would go here)
        // This is a simplified version - you'd want to register these properly with Discord
        console.log('Discord slash commands would be registered here');
    }

    // ============================================================================
    // FRONTEND COMPONENT
    // ============================================================================

    getFrontendComponent() {
        return {
            id: 'genre-discovery',
            name: 'Genre Discovery',
            description: 'Helps music producers share and discover each other\'s genres and setups',
            icon: '🎶',
            version: '2.2.0',
            containerId: 'genreDiscoveryPluginContainer',
            
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🎶</span> Genre Discovery v2.2</h3>
                        <p>Helps music producers share and discover each other's genres and setups</p>
                    </div>

                    <!-- Server Integration Notice -->
                    <div class="server-sync-notice" style="background: rgba(114, 137, 218, 0.1); border: 1px solid rgba(114, 137, 218, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🔗</span>
                            <div>
                                <strong>Dashboard Integration</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Managing server: <span id="currentServerName">Auto-detected</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Discord Commands Info -->
                    <div class="info-section" style="background: rgba(114, 137, 218, 0.1); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                        <h4>🎯 Discord Select Menus!</h4>
                        <p>Use these <strong>slash commands</strong> in Discord for easy tag selection:</p>
                        <div class="command-list" style="display: grid; gap: 12px; margin-top: 16px;">
                            <div class="command-item" style="display: flex; align-items: center; gap: 12px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px; font-family: monospace;">/genres</code>
                                <span style="color: rgba(255, 255, 255, 0.8);">🎶 Select your genres from organized categories</span>
                            </div>
                            <div class="command-item" style="display: flex; align-items: center; gap: 12px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px; font-family: monospace;">/daws</code>
                                <span style="color: rgba(255, 255, 255, 0.8);">💻 Select your DAWs from organized categories</span>
                            </div>
                            <div class="command-item" style="display: flex; align-items: center; gap: 12px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px; font-family: monospace;">/mytags</code>
                                <span style="color: rgba(255, 255, 255, 0.8);">👤 View your current tags</span>
                            </div>
                            <div class="command-item" style="display: flex; align-items: center; gap: 12px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px; font-family: monospace;">/find genre [name]</code>
                                <span style="color: rgba(255, 255, 255, 0.8);">🔍 Find users by genre</span>
                            </div>
                            <div class="command-item" style="display: flex; align-items: center; gap: 12px;">
                                <code style="background: rgba(0, 0, 0, 0.3); color: #64B5F6; padding: 6px 10px; border-radius: 6px; font-family: monospace;">/find daw [name]</code>
                                <span style="color: rgba(255, 255, 255, 0.8);">🔍 Find users by DAW</span>
                            </div>
                        </div>
                    </div>

                    <!-- Server Stats -->
                    <div class="stats-section" style="margin-bottom: 24px;">
                        <h4>Server Statistics</h4>
                        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div class="stat-card">
                                <div class="stat-value" id="totalUsers">0</div>
                                <div class="stat-label">Producers</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="totalGenres">0</div>
                                <div class="stat-label">Total Genres</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="totalDAWs">0</div>
                                <div class="stat-label">Total DAWs</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="categoriesCount">0</div>
                                <div class="stat-label">Categories</div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Form -->
                    <form id="genreSettingsForm" class="settings-form">
                        <div class="settings-section">
                            <h4>Plugin Settings</h4>
                            
                            <div class="form-group">
                                <label for="genreLogChannel">Log Channel</label>
                                <select id="genreLogChannel" class="form-control">
                                    <option value="">None (no logging)</option>
                                </select>
                                <small class="form-text">Channel where genre/DAW changes will be logged</small>
                            </div>
                        </div>

                        <button type="submit" id="saveGenreSettings" class="btn btn-primary">
                            <span class="btn-text">💾 Save Settings</span>
                            <span class="btn-loader" style="display: none;">⏳ Saving...</span>
                        </button>
                    </form>

                    <!-- Popular Genres & DAWs -->
                    <div class="popular-section" style="margin-top: 32px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                            <div class="popular-container">
                                <h4>🎵 Popular Genres</h4>
                                <div id="popularGenresList" class="popular-list">
                                    <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                        Select a server to view stats
                                    </div>
                                </div>
                            </div>
                            
                            <div class="popular-container">
                                <h4>🎛️ Popular DAWs</h4>
                                <div id="popularDAWsList" class="popular-list">
                                    <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                        Select a server to view stats
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Category Management -->
                    <div class="category-management" style="margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <h4>⚙️ Category Management</h4>
                        <p style="opacity: 0.8; margin-bottom: 20px;">Manage genre and DAW categories for the select menus.</p>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                            <div class="category-section">
                                <h5>🎶 Genre Categories</h5>
                                <div class="form-group">
                                    <input type="text" id="newGenreCategoryInput" class="form-control" placeholder="New category name...">
                                    <button type="button" id="addGenreCategoryBtn" class="btn btn-secondary btn-sm" style="margin-top: 8px;">
                                        ➕ Add Category
                                    </button>
                                </div>
                                <div id="genreCategoriesList" class="categories-list">
                                    <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                        Loading categories...
                                    </div>
                                </div>
                            </div>
                            
                            <div class="category-section">
                                <h5>🎛️ DAW Categories</h5>
                                <div class="form-group">
                                    <input type="text" id="newDAWCategoryInput" class="form-control" placeholder="New category name...">
                                    <button type="button" id="addDAWCategoryBtn" class="btn btn-secondary btn-sm" style="margin-top: 8px;">
                                        ➕ Add Category
                                    </button>
                                </div>
                                <div id="dawCategoriesList" class="categories-list">
                                    <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                        Loading categories...
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Result Messages -->
                    <div id="genreResult" class="result-message" style="display: none;"></div>
                </div>
            `,
            
            script: `
                // Enhanced Genre Discovery Plugin Frontend Logic with Dashboard Integration
                (function() {
                    console.log('🎶 Enhanced Genre Discovery Plugin: Initializing...');
                    
                    // Get DOM elements
                    const currentServerName = document.getElementById('currentServerName');
                    const genreSettingsForm = document.getElementById('genreSettingsForm');
                    const genreLogChannel = document.getElementById('genreLogChannel');
                    const saveGenreSettings = document.getElementById('saveGenreSettings');
                    
                    // Stats elements
                    const totalUsers = document.getElementById('totalUsers');
                    const totalGenres = document.getElementById('totalGenres');
                    const totalDAWs = document.getElementById('totalDAWs');
                    const categoriesCount = document.getElementById('categoriesCount');
                    
                    // Popular lists
                    const popularGenresList = document.getElementById('popularGenresList');
                    const popularDAWsList = document.getElementById('popularDAWsList');
                    
                    // Category management
                    const newGenreCategoryInput = document.getElementById('newGenreCategoryInput');
                    const addGenreCategoryBtn = document.getElementById('addGenreCategoryBtn');
                    const newDAWCategoryInput = document.getElementById('newDAWCategoryInput');
                    const addDAWCategoryBtn = document.getElementById('addDAWCategoryBtn');
                    const genreCategoriesList = document.getElementById('genreCategoriesList');
                    const dawCategoriesList = document.getElementById('dawCategoriesList');
                    
                    // Result message
                    const genreResult = document.getElementById('genreResult');
                    
                    // State variables
                    let currentServerId = null;
                    let currentSettings = {};
                    let channels = [];
                    let categories = { genreChunks: [], dawChunks: [] };
                    
                    // Initialize plugin
                    function initializeGenreDiscoveryPlugin() {
                        console.log('🎶 Initializing Genre Discovery Plugin...');
                        setupEventListeners();
                        
                        // Check for dashboard integration
                        if (window.dashboardAPI && window.dashboardAPI.getCurrentServer) {
                            currentServerId = window.dashboardAPI.getCurrentServer();
                            console.log('🎶 Dashboard integration found, server:', currentServerId);
                            
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
                                console.log('🎶 Genre Discovery plugin: Server changed to', serverId);
                                
                                if (serverId) {
                                    loadServerData();
                                } else {
                                    clearData();
                                }
                            };
                        }
                        
                        // Load categories regardless of server selection
                        loadCategories();
                    }
                    
                    // Setup event listeners
                    function setupEventListeners() {
                        // Settings form
                        if (genreSettingsForm) {
                            genreSettingsForm.addEventListener('submit', handleSettingsSave);
                        }
                        
                        // Category management
                        if (addGenreCategoryBtn) {
                            addGenreCategoryBtn.addEventListener('click', () => handleAddCategory('genre'));
                        }
                        
                        if (addDAWCategoryBtn) {
                            addDAWCategoryBtn.addEventListener('click', () => handleAddCategory('daw'));
                        }
                        
                        if (newGenreCategoryInput) {
                            newGenreCategoryInput.addEventListener('keypress', function(e) {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddCategory('genre');
                                }
                            });
                        }
                        
                        if (newDAWCategoryInput) {
                            newDAWCategoryInput.addEventListener('keypress', function(e) {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddCategory('daw');
                                }
                            });
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
                                loadStats()
                            ]);
                        } catch (error) {
                            console.error('Error loading server data:', error);
                            showResult('Error loading server data: ' + error.message, 'error');
                        }
                    }
                    
                    // Clear data when no server selected
                    function clearData() {
                        if (totalUsers) totalUsers.textContent = '0';
                        if (totalGenres) totalGenres.textContent = '0';
                        if (totalDAWs) totalDAWs.textContent = '0';
                        
                        if (popularGenresList) {
                            popularGenresList.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">Select a server to view stats</div>';
                        }
                        
                        if (popularDAWsList) {
                            popularDAWsList.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">Select a server to view stats</div>';
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
                        if (!genreLogChannel) return;
                        
                        genreLogChannel.innerHTML = '<option value="">None (no logging)</option>';
                        
                        const textChannels = channels.filter(channel => channel.type === 0);
                        textChannels.forEach(channel => {
                            const option = document.createElement('option');
                            option.value = channel.id;
                            option.textContent = '#' + channel.name;
                            genreLogChannel.appendChild(option);
                        });
                    }
                    
                    // Load settings
                    async function loadSettings() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/genrediscovery/settings/\${currentServerId}\`);
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
                        if (genreLogChannel) {
                            genreLogChannel.value = currentSettings.logChannelId || '';
                        }
                    }
                    
                    // Load stats
                    async function loadStats() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/genrediscovery/stats/\${currentServerId}\`);
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
                        if (totalGenres) totalGenres.textContent = stats.totalGenres?.toLocaleString() || '0';
                        if (totalDAWs) totalDAWs.textContent = stats.totalDAWs?.toLocaleString() || '0';
                        
                        displayPopularList(stats.mostPopularGenres, popularGenresList, 'genre');
                        displayPopularList(stats.mostPopularDAWs, popularDAWsList, 'DAW');
                    }
                    
                    // Display popular items list
                    function displayPopularList(items, container, type) {
                        if (!container || !items || items.length === 0) {
                            if (container) {
                                container.innerHTML = \`
                                    <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                        No \${type}s found
                                    </div>
                                \`;
                            }
                            return;
                        }
                        
                        container.innerHTML = '';
                        
                        items.forEach((item, index) => {
                            const itemElement = document.createElement('div');
                            itemElement.className = 'popular-item';
                            itemElement.style.cssText = \`
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                padding: 12px 16px;
                                background: rgba(255, 255, 255, 0.05);
                                border-radius: 8px;
                                margin-bottom: 8px;
                                transition: all 0.2s ease;
                            \`;
                            
                            itemElement.innerHTML = \`
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="background: rgba(114, 137, 218, 0.2); color: #818CF8; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;">
                                        #\${index + 1}
                                    </div>
                                    <div style="font-weight: 500;">\${item.name}</div>
                                </div>
                                <div style="background: rgba(34, 197, 94, 0.2); color: #10B981; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
                                    \${item.count} user\${item.count !== 1 ? 's' : ''}
                                </div>
                            \`;
                            
                            container.appendChild(itemElement);
                        });
                    }
                    
                    // Load categories
                    async function loadCategories() {
                        try {
                            const response = await fetch('/api/plugins/genrediscovery/categories');
                            if (!response.ok) throw new Error('Failed to load categories');
                            
                            categories = await response.json();
                            displayCategories();
                            updateCategoriesCount();
                        } catch (error) {
                            console.error('Error loading categories:', error);
                        }
                    }
                    
                    // Display categories
                    function displayCategories() {
                        displayCategoryList(categories.genreChunks, genreCategoriesList, 'genre');
                        displayCategoryList(categories.dawChunks, dawCategoriesList, 'daw');
                    }
                    
                    // Display category list
                    function displayCategoryList(categoryList, container, type) {
                        if (!container) return;
                        
                        if (!categoryList || categoryList.length === 0) {
                            container.innerHTML = \`
                                <div style="text-align: center; opacity: 0.7; padding: 20px;">
                                    No \${type} categories found
                                </div>
                            \`;
                            return;
                        }
                        
                        container.innerHTML = '';
                        
                        categoryList.forEach(category => {
                            const categoryElement = document.createElement('div');
                            categoryElement.className = 'category-item';
                            categoryElement.style.cssText = \`
                                border: 1px solid rgba(255,255,255,0.1);
                                border-radius: 8px;
                                padding: 15px;
                                margin-bottom: 15px;
                                background: rgba(255,255,255,0.05);
                                transition: all 0.2s ease;
                            \`;
                            
                            const items = type === 'genre' ? category.genres : category.daws;
                            const itemType = type === 'genre' ? 'genres' : 'DAWs';
                            
                            categoryElement.innerHTML = \`
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-size: 18px;">\${category.emoji}</span>
                                        <strong>\${category.label}</strong>
                                    </div>
                                    <div style="background: rgba(114, 137, 218, 0.2); color: #818CF8; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                        \${items.length} \${itemType}
                                    </div>
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                    \${items.map(item => \`
                                        <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; font-size: 12px; color: rgba(255,255,255,0.8);">
                                            \${item}
                                        </span>
                                    \`).join('')}
                                </div>
                            \`;
                            
                            container.appendChild(categoryElement);
                        });
                    }
                    
                    // Update categories count
                    function updateCategoriesCount() {
                        if (categoriesCount) {
                            const totalCategories = (categories.genreChunks?.length || 0) + (categories.dawChunks?.length || 0);
                            categoriesCount.textContent = totalCategories.toString();
                        }
                    }
                    
                    // Handle settings save
                    async function handleSettingsSave(e) {
                        e.preventDefault();
                        
                        if (!currentServerId) {
                            showResult('No server selected', 'error');
                            return;
                        }
                        
                        const btnText = saveGenreSettings?.querySelector('.btn-text');
                        const btnLoader = saveGenreSettings?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (saveGenreSettings) saveGenreSettings.disabled = true;
                            
                            const settings = {
                                logChannelId: genreLogChannel?.value || null
                            };
                            
                            const response = await fetch(\`/api/plugins/genrediscovery/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(settings)
                            });
                            
                            if (!response.ok) throw new Error('Failed to save settings');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult('Genre Discovery settings saved successfully!', 'success');
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification('Genre Discovery settings saved', 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', 'Genre Discovery settings updated');
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
                            if (saveGenreSettings) saveGenreSettings.disabled = false;
                        }
                    }
                    
                    // Handle add category
                    async function handleAddCategory(type) {
                        const input = type === 'genre' ? newGenreCategoryInput : newDAWCategoryInput;
                        const categoryName = input?.value?.trim();
                        
                        if (!categoryName) {
                            showResult('Please enter a category name', 'error');
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/genrediscovery/categories/\${type}\`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    categoryName,
                                    items: []
                                })
                            });
                            
                            if (!response.ok) throw new Error('Failed to add category');
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult(\`\${type === 'genre' ? 'Genre' : 'DAW'} category added successfully!\`, 'success');
                                
                                // Clear input
                                if (input) input.value = '';
                                
                                // Reload categories
                                await loadCategories();
                                
                                if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                    window.dashboardAPI.showNotification('Category added successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to add category');
                            }
                            
                        } catch (error) {
                            console.error('Error adding category:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!genreResult) return;
                        
                        genreResult.textContent = message;
                        genreResult.className = \`result-message \${type}\`;
                        genreResult.style.display = 'block';
                        
                        // Auto-hide after 5 seconds
                        setTimeout(() => {
                            genreResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeGenreDiscoveryPlugin);
                    } else {
                        initializeGenreDiscoveryPlugin();
                    }
                    
                    console.log('✅ Enhanced Genre Discovery Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = GenreDiscoveryPlugin;