const fs =require('fs').promises;
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');

class GenreDiscoveryPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Genre Discovery';
        this.description = 'Helps music producers share and discover each other\'s genres and setups.';
        this.version = '2.1.0';
        this.enabled = true;

        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;

        this.dataFile = path.join(__dirname, '../data/genreDiscoveryData.json');
        this.settingsFile = path.join(__dirname, '../data/genreDiscoverySettings.json');
        this.categoriesFile = path.join(__dirname, '../data/genreDiscoveryCategories.json');

        // Default predefined lists
        this.defaultGenreChunks = [
            {
                name: 'Electronic & Dance',
                genres: ['House', 'Techno', 'Trance', 'Dubstep', 'Future Bass', 'Progressive House', 'Deep House', 'Tech House', 'Minimal Techno', 'Big Room', 'Electro House', 'French House', 'Tropical House', 'UK Garage', 'Future Garage', 'Garage', 'Speed Garage', 'Bassline', 'Breakbeat', 'Hardcore', 'Hardstyle', 'Psytrance', 'Goa Trance', 'Acid Techno', 'Detroit Techno']
            },
            {
                name: 'Bass & Electronic',
                genres: ['Drum & Bass', 'Liquid DNB', 'Neurofunk', 'Jump Up', 'Jungle', 'Riddim', 'Melodic Dubstep', 'Brostep', 'Chillstep', 'Glitch Hop', 'Moombahton', 'Trap', 'Future Trap', 'Hybrid Trap', 'Festival Trap', 'Colour Bass', 'Melodic Bass', 'Tearout', 'Deathstep', 'Drumstep', 'Halftime', 'Neurostep', 'Experimental Bass', 'Wave', 'Phonk']
            },
            {
                name: 'Ambient & Chill',
                genres: ['Ambient', 'Lo-Fi', 'Chillwave', 'Downtempo', 'Chillhop', 'Lounge', 'Trip Hop', 'Chillout', 'Future Garage', 'Liquid DnB', 'Jazzhop', 'Study Beats', 'Meditation', 'Nature Sounds', 'Dark Ambient', 'Drone', 'Post-Rock', 'Cinematic', 'Neoclassical', 'Piano', 'Instrumental', 'New Age', 'Ethereal', 'Soundscape', 'Field Recording']
            },
            {
                name: 'Retro & Synthwave',
                genres: ['Synthwave', 'Retrowave', 'Vaporwave', 'Outrun', 'Darksynth', 'Cyberpunk', 'Dreamwave', 'Chillsynth', 'Futuresynth', 'Spacewave', 'Nu-Disco', 'Italo Disco', 'Disco', 'Funk', 'Electro-Funk', 'Synthfunk', '80s Pop', 'New Wave', 'Post-Punk', 'Coldwave', 'Industrial', 'EBM', 'Techno-Pop', 'Kraftwerk Style', 'Minimal Wave']
            },
            {
                name: 'Hip Hop & Urban',
                genres: ['Hip Hop', 'Rap', 'Trap', 'Boom Bap', 'Lo-Fi Hip Hop', 'Jazz Rap', 'Conscious Rap', 'Gangsta Rap', 'Mumble Rap', 'Cloud Rap', 'Emo Rap', 'Drill', 'UK Drill', 'Grime', 'Afrobeat', 'Afro Trap', 'Latin Trap', 'Reggaeton', 'Dancehall', 'Dub', 'Reggae', 'R&B', 'Soul', 'Neo-Soul', 'Alternative R&B']
            },
            {
                name: 'Rock & Alternative',
                genres: ['Rock', 'Alternative Rock', 'Indie Rock', 'Post-Rock', 'Prog Rock', 'Psych Rock', 'Garage Rock', 'Punk Rock', 'Post-Punk', 'Grunge', 'Metal', 'Heavy Metal', 'Death Metal', 'Black Metal', 'Thrash Metal', 'Progressive Metal', 'Metalcore', 'Hardcore', 'Screamo', 'Emo', 'Pop Punk', 'Ska', 'Reggae Rock', 'Folk Rock', 'Country Rock']
            }
        ];

        this.defaultDawChunks = [
            {
                name: 'Professional DAWs',
                daws: ['Ableton Live', 'FL Studio', 'Logic Pro', 'Pro Tools', 'Cubase', 'Studio One', 'Reaper', 'Reason', 'Bitwig Studio', 'Digital Performer', 'Nuendo', 'Samplitude', 'Mixbus', 'Harrison Mixbus', 'Waveform', 'Tracktion T7', 'MuLab', 'n-Track Studio', 'MultitrackStudio', 'Podium', 'Zynewave Podium', 'Music Maker', 'Mixcraft', 'Acid Pro', 'BandLab']
            },
            {
                name: 'Free & Budget DAWs',
                daws: ['GarageBand', 'Audacity', 'Cakewalk', 'LMMS', 'Ardour', 'Renoise', 'OpenMPT', 'Caustic', 'Soundtrap', 'BandLab', 'Ohm Studio', 'Tracktion T7', 'SunVox', 'Zrythm', 'REAPER (Trial)', 'Cubase LE', 'FL Studio Demo', 'Studio One Prime', 'Ableton Live Lite', 'Logic Pro (Trial)', 'Presonus Capture', 'Cockos REAPER', 'Harrison Mixbus Demo', 'Bitwig 8-Track', 'WavePad']
            },
            {
                name: 'Mobile & Browser',
                daws: ['FL Studio Mobile', 'Caustic', 'AudioTool', 'Soundtrap', 'BandLab', 'Chrome Music Lab', 'Beepbox', 'JummBox', 'Looplabs', 'Soundation', 'Amped Studio', 'TwistedWave Online', 'Audio Mass', 'Beautiful Audio Editor', 'WavePad Online', 'GarageBand iOS', 'Cubasis', 'Auria Pro', 'Steinberg Cubasis', 'Music Maker JAM', 'Walk Band', 'Caustic 3', 'SunVox Mobile', 'Stagelight', 'Audio Evolution Mobile']
            }
        ];

        this.genreChunks = [];
        this.dawChunks = [];

        this.initializeData();
        this.setupRoutes();
        this.setupSlashCommands();
        
        console.log('Enhanced Genre Discovery plugin v2.1 with Management Features loaded successfully!');
    }

    async initializeData() {
        try {
            await fs.access(this.dataFile).catch(() => 
                fs.writeFile(this.dataFile, JSON.stringify({}, null, 2))
            );
            await fs.access(this.settingsFile).catch(() => 
                fs.writeFile(this.settingsFile, JSON.stringify({}, null, 2))
            );
            
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

    setupRoutes() {
        // Get predefined lists
        this.app.get('/api/plugins/genrediscovery/lists', this.ensureAuthenticated, async (req, res) => {
            try {
                const genres = this.genreChunks.flatMap(chunk => chunk.genres);
                const daws = this.dawChunks.flatMap(chunk => chunk.daws);
                res.json({ genres, daws });
            } catch (error) {
                console.error('Error getting predefined lists:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get categories
        this.app.get('/api/plugins/genrediscovery/categories', this.ensureAuthenticated, async (req, res) => {
            try {
                res.json({ genreChunks: this.genreChunks, dawChunks: this.dawChunks });
            } catch (error) {
                console.error('Error getting categories:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Add new category
        this.app.post('/api/plugins/genrediscovery/categories', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, type, name } = req.body;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }
                
                if (type === 'genre') {
                    if (this.genreChunks.some(chunk => chunk.name === name)) {
                        return res.status(400).json({ error: 'Category already exists' });
                    }
                    this.genreChunks.push({ name, genres: [] });
                } else if (type === 'daw') {
                    if (this.dawChunks.some(chunk => chunk.name === name)) {
                        return res.status(400).json({ error: 'Category already exists' });
                    }
                    this.dawChunks.push({ name, daws: [] });
                } else {
                    return res.status(400).json({ error: 'Invalid type' });
                }

                await this.saveCategories();
                res.json({ success: true });
            } catch (error) {
                console.error('Error adding category:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Delete category
        this.app.delete('/api/plugins/genrediscovery/categories/:type/:name', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.query;
                const { type, name } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }
                
                if (type === 'genre') {
                    this.genreChunks = this.genreChunks.filter(chunk => chunk.name !== name);
                } else if (type === 'daw') {
                    this.dawChunks = this.dawChunks.filter(chunk => chunk.name !== name);
                } else {
                    return res.status(400).json({ error: 'Invalid type' });
                }

                await this.saveCategories();
                res.json({ success: true });
            } catch (error) {
                console.error('Error deleting category:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Add item to category
        this.app.post('/api/plugins/genrediscovery/categories/:type/:categoryName/items', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, item } = req.body;
                const { type, categoryName } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }
                
                if (type === 'genre') {
                    const chunk = this.genreChunks.find(c => c.name === categoryName);
                    if (!chunk) return res.status(404).json({ error: 'Category not found' });
                    if (!chunk.genres.includes(item)) {
                        chunk.genres.push(item);
                    }
                } else if (type === 'daw') {
                    const chunk = this.dawChunks.find(c => c.name === categoryName);
                    if (!chunk) return res.status(404).json({ error: 'Category not found' });
                    if (!chunk.daws.includes(item)) {
                        chunk.daws.push(item);
                    }
                } else {
                    return res.status(400).json({ error: 'Invalid type' });
                }

                await this.saveCategories();
                res.json({ success: true });
            } catch (error) {
                console.error('Error adding item:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Remove item from category
        this.app.delete('/api/plugins/genrediscovery/categories/:type/:categoryName/items/:item', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.query;
                const { type, categoryName, item } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }
                
                if (type === 'genre') {
                    const chunk = this.genreChunks.find(c => c.name === categoryName);
                    if (!chunk) return res.status(404).json({ error: 'Category not found' });
                    chunk.genres = chunk.genres.filter(g => g !== decodeURIComponent(item));
                } else if (type === 'daw') {
                    const chunk = this.dawChunks.find(c => c.name === categoryName);
                    if (!chunk) return res.status(404).json({ error: 'Category not found' });
                    chunk.daws = chunk.daws.filter(d => d !== decodeURIComponent(item));
                } else {
                    return res.status(400).json({ error: 'Invalid type' });
                }

                await this.saveCategories();
                res.json({ success: true });
            } catch (error) {
                console.error('Error removing item:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get user's current tags
        this.app.get('/api/plugins/genrediscovery/user/:guildId/:userId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId, userId } = req.params;
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, userId);
                res.json(userData);
            } catch (error) {
                console.error('Error getting user data:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get settings
        this.app.get('/api/plugins/genrediscovery/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const settings = await this.loadSettings();
                res.json(settings[guildId] || {});
            } catch (error) {
                console.error('Error getting settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Save settings
        this.app.post('/api/plugins/genrediscovery/settings/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                
                if (!await this.hasAdminPermissions(req.user.id, guildId)) {
                    return res.status(403).json({ error: 'Admin permissions required' });
                }

                const settings = await this.loadSettings();
                settings[guildId] = req.body;
                await this.saveSettings(settings);
                
                res.json({ success: true });
            } catch (error) {
                console.error('Error saving settings:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get stats
        this.app.get('/api/plugins/genrediscovery/stats/:guildId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { guildId } = req.params;
                const data = await this.loadData();
                const guildData = data[guildId] || {};
                
                const genreCounts = {};
                const dawCounts = {};
                
                Object.values(guildData).forEach(userData => {
                    userData.genres?.forEach(genre => {
                        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                    });
                    userData.daws?.forEach(daw => {
                        dawCounts[daw] = (dawCounts[daw] || 0) + 1;
                    });
                });
                
                const topGenres = Object.entries(genreCounts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 10);
                    
                const topDaws = Object.entries(dawCounts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 10);

                res.json({ topGenres, topDaws });
            } catch (error) {
                console.error('Error getting stats:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

    createGenreSelectMenu(selectedGenres = []) {
        const options = this.genreChunks.map(chunk => ({
            label: chunk.name,
            value: `genre_category_${chunk.name.toLowerCase().replace(/\s+/g, '_')}`,
            description: `${chunk.genres.length} genres available`,
            emoji: '🎵'
        }));

        return new StringSelectMenuBuilder()
            .setCustomId('genre_category_select')
            .setPlaceholder('🎶 Choose a genre category')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);
    }

    createDAWSelectMenu(selectedDAWs = []) {
        const options = this.dawChunks.map(chunk => ({
            label: chunk.name,
            value: `daw_category_${chunk.name.toLowerCase().replace(/\s+/g, '_')}`,
            description: `${chunk.daws.length} DAWs available`,
            emoji: '💻'
        }));

        return new StringSelectMenuBuilder()
            .setCustomId('daw_category_select')
            .setPlaceholder('💻 Choose a DAW category')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);
    }

    createSpecificGenreMenu(categoryName, selectedGenres = []) {
        const chunk = this.genreChunks.find(c => c.name.toLowerCase().replace(/\s+/g, '_') === categoryName);
        if (!chunk) return null;

        const options = chunk.genres.slice(0, 25).map(genre => ({
            label: genre.length > 100 ? genre.substring(0, 97) + '...' : genre,
            value: `add_genre_${genre}`,
            description: selectedGenres.includes(genre) ? '✅ Already selected' : 'Click to add to your tags',
            emoji: selectedGenres.includes(genre) ? '✅' : '🎵'
        }));

        return new StringSelectMenuBuilder()
            .setCustomId('specific_genre_select')
            .setPlaceholder(`🎶 Select genres from ${chunk.name}`)
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options);
    }

    createSpecificDAWMenu(categoryName, selectedDAWs = []) {
        const chunk = this.dawChunks.find(c => c.name.toLowerCase().replace(/\s+/g, '_') === categoryName);
        if (!chunk) return null;

        const options = chunk.daws.slice(0, 25).map(daw => ({
            label: daw.length > 100 ? daw.substring(0, 97) + '...' : daw,
            value: `add_daw_${daw}`,
            description: selectedDAWs.includes(daw) ? '✅ Already selected' : 'Click to add to your tags',
            emoji: selectedDAWs.includes(daw) ? '✅' : '💻'
        }));

        return new StringSelectMenuBuilder()
            .setCustomId('specific_daw_select')
            .setPlaceholder(`💻 Select DAWs from ${chunk.name}`)
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options);
    }

    // --- FIX: This method provides the command data for the central handler ---
    getSlashCommands() {
        return [
            new SlashCommandBuilder()
                .setName('genres')
                .setDescription('🎶 Set your music genres using dropdown menus'),
            
            new SlashCommandBuilder()
                .setName('daws')
                .setDescription('💻 Set your DAWs/software using dropdown menus'),
            
            new SlashCommandBuilder()
                .setName('remove')
                .setDescription('🗑️ Remove genres or DAWs from your tags')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('genre')
                        .setDescription('Remove a genre from your tags')
                        .addStringOption(option => option.setName('genre').setDescription('Genre to remove').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('daw')
                        .setDescription('Remove a DAW from your tags')
                        .addStringOption(option => option.setName('daw').setDescription('DAW to remove').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('all')
                        .setDescription('Remove all your tags')
                        .addStringOption(option => 
                            option.setName('confirm')
                            .setDescription('Type "confirm" to remove all tags')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Yes, remove all my tags', value: 'confirm' }
                            ))),
                    
            new SlashCommandBuilder()
                .setName('mytags')
                .setDescription('👤 View your current genres and DAWs'),
                    
            new SlashCommandBuilder()
                .setName('find')
                .setDescription('🔍 Find users by their tags')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('genre')
                        .setDescription('Find users by genre')
                        .addStringOption(option => option.setName('genre').setDescription('Genre to search for').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('daw')
                        .setDescription('Find users by DAW')
                        .addStringOption(option => option.setName('daw').setDescription('DAW to search for').setRequired(true))),
            
            new SlashCommandBuilder()
                .setName('tags')
                .setDescription('👀 View someone\'s tags')
                .addUserOption(option => option.setName('user').setDescription('User to view tags for')),
        ].map(command => command.toJSON());
    }

    setupSlashCommands() {
        // --- FIX: The registration logic is now moved to app.js ---
        // This method now only sets up the listener for the commands.
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                const { commandName } = interaction;
                if (['genres', 'daws', 'mytags', 'remove', 'find', 'tags'].includes(commandName)) {
                    await this.handleGenreCommands(interaction);
                }
            } else if (interaction.isStringSelectMenu()) {
                const { customId } = interaction;
                if (['genre_category_select', 'daw_category_select', 'specific_genre_select', 'specific_daw_select'].includes(customId)) {
                    await this.handleSelectMenuInteraction(interaction);
                }
            }
        });
    }

    async handleSelectMenuInteraction(interaction) {
        try {
            const { customId, values, guildId, user } = interaction;

            if (customId === 'genre_category_select') {
                const categoryName = values[0].replace('genre_category_', '');
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, user.id);
                
                const specificMenu = this.createSpecificGenreMenu(categoryName, userData.genres);
                if (!specificMenu) {
                    return await interaction.reply({ content: '❌ Category not found.', ephemeral: true });
                }

                const row = new ActionRowBuilder().addComponents(specificMenu);
                
                const categoryDisplayName = this.genreChunks.find(c => 
                    c.name.toLowerCase().replace(/\s+/g, '_') === categoryName
                )?.name || categoryName;
                
                await interaction.reply({
                    content: `🎶 **Select genres from ${categoryDisplayName}:**`,
                    components: [row],
                    ephemeral: true
                });

            } else if (customId === 'daw_category_select') {
                const categoryName = values[0].replace('daw_category_', '');
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, user.id);
                
                const specificMenu = this.createSpecificDAWMenu(categoryName, userData.daws);
                if (!specificMenu) {
                    return await interaction.reply({ content: '❌ Category not found.', ephemeral: true });
                }

                const row = new ActionRowBuilder().addComponents(specificMenu);
                
                const categoryDisplayName = this.dawChunks.find(c => 
                    c.name.toLowerCase().replace(/\s+/g, '_') === categoryName
                )?.name || categoryName;
                
                await interaction.reply({
                    content: `💻 **Select DAWs from ${categoryDisplayName}:**`,
                    components: [row],
                    ephemeral: true
                });

            } else if (customId === 'specific_genre_select') {
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, user.id);
                
                const newGenres = values.map(value => value.replace('add_genre_', ''));
                const addedGenres = [];
                
                newGenres.forEach(genre => {
                    if (!userData.genres.includes(genre)) {
                        userData.genres.push(genre);
                        addedGenres.push(genre);
                    }
                });
                
                await this.saveData(data);
                
                const responseText = addedGenres.length > 0 
                    ? `✅ **Added genres:** ${addedGenres.join(', ')}\n\n**Your current genres:** ${userData.genres.slice(0, 10).join(', ')}${userData.genres.length > 10 ? ` (+${userData.genres.length - 10} more)` : ''}`
                    : `ℹ️ All selected genres were already in your list.\n\n**Your current genres:** ${userData.genres.slice(0, 10).join(', ')}${userData.genres.length > 10 ? ` (+${userData.genres.length - 10} more)` : ''}`;
                
                await interaction.update({
                    content: responseText,
                    components: []
                });

            } else if (customId === 'specific_daw_select') {
                const data = await this.loadData();
                const userData = this.getUserData(data, guildId, user.id);
                
                const newDAWs = values.map(value => value.replace('add_daw_', ''));
                const addedDAWs = [];
                
                newDAWs.forEach(daw => {
                    if (!userData.daws.includes(daw)) {
                        userData.daws.push(daw);
                        addedDAWs.push(daw);
                    }
                });
                
                await this.saveData(data);
                
                const responseText = addedDAWs.length > 0 
                    ? `✅ **Added DAWs:** ${addedDAWs.join(', ')}\n\n**Your current DAWs:** ${userData.daws.slice(0, 10).join(', ')}${userData.daws.length > 10 ? ` (+${userData.daws.length - 10} more)` : ''}`
                    : `ℹ️ All selected DAWs were already in your list.\n\n**Your current DAWs:** ${userData.daws.slice(0, 10).join(', ')}${userData.daws.length > 10 ? ` (+${userData.daws.length - 10} more)` : ''}`;
                
                await interaction.update({
                    content: responseText,
                    components: []
                });
            }

        } catch (error) {
            console.error('Error handling select menu interaction:', error);
            
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '❌ An error occurred while processing your selection.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ An error occurred while processing your selection.', ephemeral: true });
                }
            } catch (replyError) {
                console.error('Error sending error message:', replyError);
            }
        }
    }

    async handleGenreCommands(interaction) {
        try {
            const { commandName, options, guildId, user } = interaction;
            const data = await this.loadData();
            const userData = this.getUserData(data, guildId, user.id);

            if (commandName === 'genres') {
                const genreMenu = this.createGenreSelectMenu(userData.genres);
                const row = new ActionRowBuilder().addComponents(genreMenu);
                
                await interaction.reply({
                    content: '🎶 **Choose a genre category to explore:**',
                    components: [row],
                    ephemeral: true
                });

            } else if (commandName === 'daws') {
                const dawMenu = this.createDAWSelectMenu(userData.daws);
                const row = new ActionRowBuilder().addComponents(dawMenu);
                
                await interaction.reply({
                    content: '💻 **Choose a DAW category to explore:**',
                    components: [row],
                    ephemeral: true
                });

            } else if (commandName === 'remove') {
                const subCommand = options.getSubcommand();
    
                if (subCommand === 'genre') {
                    const genreToRemove = options.getString('genre');
                    const index = userData.genres.findIndex(g => g.toLowerCase() === genreToRemove.toLowerCase());
                    
                    if (index === -1) {
                        await interaction.reply({ 
                            content: `❌ You don't have "${genreToRemove}" in your genres.\n\n**Your current genres:** ${userData.genres.join(', ') || 'None'}`, 
                            ephemeral: true 
                        });
                        return;
                    }
            
                    const removedGenre = userData.genres.splice(index, 1)[0];
                    await this.saveData(data);
                    
                    await interaction.reply({ 
                        content: `✅ Removed "${removedGenre}" from your genres.\n\n**Remaining genres:** ${userData.genres.join(', ') || 'None'}` 
                    });
                        
                } else if (subCommand === 'daw') {
                    const dawToRemove = options.getString('daw');
                    const index = userData.daws.findIndex(d => d.toLowerCase() === dawToRemove.toLowerCase());
                        
                    if (index === -1) {
                        await interaction.reply({ 
                            content: `❌ You don't have "${dawToRemove}" in your DAWs.\n\n**Your current DAWs:** ${userData.daws.join(', ') || 'None'}`, 
                            ephemeral: true 
                        });
                        return;
                    }
                        
                    const removedDAW = userData.daws.splice(index, 1)[0];
                    await this.saveData(data);
                        
                    await interaction.reply({ 
                        content: `✅ Removed "${removedDAW}" from your DAWs.\n\n**Remaining DAWs:** ${userData.daws.join(', ') || 'None'}` 
                    });
                        
                } else if (subCommand === 'all') {
                    const confirmation = options.getString('confirm');
                        
                    if (confirmation !== 'confirm') {
                        await interaction.reply({ 
                            content: '❌ You must select "Yes, remove all my tags" to confirm this action.', 
                            ephemeral: true 
                        });
                        return;
                    }
                        
                    const removedGenres = [...userData.genres];
                    const removedDAWs = [...userData.daws];
                        
                    userData.genres = [];
                    userData.daws = [];
                    await this.saveData(data);
                        
                    const embed = new EmbedBuilder()
                        .setColor(0xff6b6b)
                        .setTitle('🗑️ All Tags Removed')
                        .setDescription('All your genres and DAWs have been cleared.')
                        .addFields(
                            { name: '🎶 Removed Genres', value: removedGenres.join(', ') || 'None', inline: false },
                            { name: '💻 Removed DAWs', value: removedDAWs.join(', ') || 'None', inline: false }
                        )
                        .setFooter({ text: 'Use /genres and /daws to add new tags!' });

                    await interaction.reply({ embeds: [embed] });
                }

            } else if (commandName === 'mytags') {
                const embed = new EmbedBuilder()
                    .setColor(0x7289DA)
                    .setAuthor({ name: `${user.username}'s Music Tags`, iconURL: user.displayAvatarURL() })
                    .addFields(
                        { name: '🎶 Genres', value: userData.genres.length > 0 ? userData.genres.slice(0, 20).join(', ') : 'None set', inline: false },
                        { name: '💻 DAWs', value: userData.daws.length > 0 ? userData.daws.slice(0, 20).join(', ') : 'None set', inline: false }
                    )
                    .setFooter({ text: 'Use /genres and /daws to update your tags!' });

                if (userData.genres.length > 20) {
                    embed.setFooter({ text: `Showing first 20 of ${userData.genres.length} genres. Use /genres and /daws to update your tags!` });
                }

                await interaction.reply({ embeds: [embed] });

            } else if (commandName === 'tags') {
                const targetUser = options.getUser('user') || user;
                const targetUserData = this.getUserData(data, guildId, targetUser.id);

                const embed = new EmbedBuilder()
                    .setColor(0x7289DA)
                    .setAuthor({ name: `${targetUser.username}'s Music Tags`, iconURL: targetUser.displayAvatarURL() })
                    .addFields(
                        { name: '🎶 Genres', value: targetUserData.genres.length > 0 ? targetUserData.genres.slice(0, 20).join(', ') : 'None set', inline: false },
                        { name: '💻 DAWs', value: targetUserData.daws.length > 0 ? targetUserData.daws.slice(0, 20).join(', ') : 'None set', inline: false }
                    );

                if (targetUserData.genres.length > 20) {
                    embed.setFooter({ text: `Showing first 20 of ${targetUserData.genres.length} genres` });
                }

                await interaction.reply({ embeds: [embed] });

            } else if (commandName === 'find') {
                const subCommand = options.getSubcommand();
                const searchTerm = options.getString(subCommand);
                
                const allUsers = Object.entries(data[guildId] || {});
                const matches = [];
                
                for (const [userId, userData] of allUsers) {
                    const searchArray = subCommand === 'genre' ? userData.genres : userData.daws;
                    const hasMatch = searchArray?.some(item => 
                        item.toLowerCase().includes(searchTerm.toLowerCase())
                    );
                    
                    if (hasMatch) {
                        try {
                           const member = await interaction.guild.members.fetch(userId);
                           matches.push(member.toString());
                        } catch { 
                            // Member likely left the server, skip them
                        }
                    }
                }
                
                const embed = new EmbedBuilder()
                    .setColor(0x7289DA)
                    .setTitle(`🔍 Search Results for "${searchTerm}"`)
                    .setDescription(matches.length > 0 ? 
                        matches.slice(0, 20).join('\n') : `No producers found with **${searchTerm}**.`);
                    
                if (matches.length > 20) {
                    embed.setFooter({ text: `Showing first 20 of ${matches.length} results` });
                }

                await interaction.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error handling genre command:', error);
            
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

    getFrontendComponent() {
        return {
            id: 'genre-discovery-plugin',
            name: 'Genre Discovery',
            description: 'Helps music producers share and discover each other\'s genres and setups',
            icon: '🎶',
            version: '2.1.0',
            
            containerId: 'genreDiscoveryPluginContainer',
            pageId: 'genre-discovery',
            navIcon: '🎶',
            
            html: `<div class="plugin-container">
                <div class="plugin-header">
                    <h3><span class="plugin-icon">🎶</span> Genre Discovery v2.1</h3>
                    <p>Set your music genres and DAWs using Discord select menus or manage categories in the dashboard</p>
                </div>

                <div class="info-section" style="background: rgba(114, 137, 218, 0.1); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                    <h3>🎯 Discord Select Menus!</h3>
                    <p>Use these <strong>slash commands</strong> in Discord for easy tag selection:</p>
                    <div class="command-list">
                        <div class="command-item">
                            <code>/genres</code>
                            <span>🎶 Select your genres from organized categories</span>
                        </div>
                        <div class="command-item">
                            <code>/daws</code>
                            <span>💻 Select your DAWs from organized categories</span>
                        </div>
                        <div class="command-item">
                            <code>/mytags</code>
                            <span>👤 View your current tags</span>
                        </div>
                        <div class="command-item">
                            <code>/remove genre [name]</code>
                            <span>🗑️ Remove a specific genre from your tags</span>
                        </div>
                        <div class="command-item">
                            <code>/remove daw [name]</code>
                            <span>🗑️ Remove a specific DAW from your tags</span>
                        </div>
                        <div class="command-item">
                            <code>/remove all</code>
                            <span>🗑️ Remove all your tags (requires confirmation)</span>
                        </div>
                        <div class="command-item">
                            <code>/find genre [name]</code>
                            <span>🔍 Find users by genre</span>
                        </div>
                        <div class="command-item">
                            <code>/find daw [name]</code>
                            <span>🔍 Find users by DAW</span>
                        </div>
                        <div class="command-item">
                            <code>/tags [@user]</code>
                            <span>👀 View someone else's tags</span>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>Dashboard Management</h3>
                    <div class="form-group">
                        <label for="genre-server-select">Server:</label>
                        <select id="genre-server-select" class="form-control">
                            <option value="">Select a server...</option>
                        </select>
                    </div>
                </div>

                <div id="genre-settings-section" class="settings-section" style="display: none;">
                    <h3>Plugin Settings (Admin Only)</h3>
                    <div class="form-group">
                        <label for="genre-log-channel">Log Channel:</label>
                        <select id="genre-log-channel" class="form-control">
                            <option value="">None (no logging)</option>
                        </select>
                    </div>
                    <button id="save-genre-settings" class="btn-primary">
                        <span class="btn-text">💾 Save Settings</span>
                        <span class="btn-loader" style="display: none;">⏳</span>
                    </button>
                </div>

                <div id="genre-management-section" class="settings-section" style="display: none;">
                    <h3>🎶 Genre Category Management (Admin Only)</h3>
                    
                    <div class="form-group">
                        <label for="new-genre-category">Add New Genre Category:</label>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="new-genre-category" class="form-control" placeholder="Category name...">
                            <button id="add-genre-category" class="btn btn-success">➕ Add</button>
                        </div>
                    </div>

                    <div id="genre-categories-list">
                        <!-- Categories will be loaded here -->
                    </div>
                </div>

                <div id="daw-management-section" class="settings-section" style="display: none;">
                    <h3>💻 DAW Category Management (Admin Only)</h3>
                    
                    <div class="form-group">
                        <label for="new-daw-category">Add New DAW Category:</label>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="new-daw-category" class="form-control" placeholder="Category name...">
                            <button id="add-daw-category" class="btn btn-success">➕ Add</button>
                        </div>
                    </div>

                    <div id="daw-categories-list">
                        <!-- Categories will be loaded here -->
                    </div>
                </div>

                <div id="genre-stats-section" class="settings-section" style="display: none;">
                    <h3>📊 Server Statistics</h3>
                    <button id="refresh-genre-stats" class="btn btn-secondary">🔄 Refresh Stats</button>
                    
                    <div class="stats-container" style="display: flex; gap: 20px; margin-top: 15px;">
                        <div class="stats-column" style="flex: 1;">
                            <h4>🎶 Top Genres</h4>
                            <div id="genre-stats-list" class="stats-list">
                                <!-- Stats will be loaded here -->
                            </div>
                        </div>
                        <div class="stats-column" style="flex: 1;">
                            <h4>💻 Top DAWs</h4>
                            <div id="daw-stats-list" class="stats-list">
                                <!-- Stats will be loaded here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>`,
            
            script: `(function() {
                console.log('🎶 Loading Genre Discovery plugin v2.1...');
                
                let currentGuildId = null;
                
                const genreServerSelect = document.getElementById('genre-server-select');
                const genreStatsSection = document.getElementById('genre-stats-section');
                const genreSettingsSection = document.getElementById('genre-settings-section');
                const genreManagementSection = document.getElementById('genre-management-section');
                const dawManagementSection = document.getElementById('daw-management-section');
                const genreLogChannel = document.getElementById('genre-log-channel');
                const saveGenreSettings = document.getElementById('save-genre-settings');
                const refreshGenreStats = document.getElementById('refresh-genre-stats');
                const genreStatsList = document.getElementById('genre-stats-list');
                const dawStatsList = document.getElementById('daw-stats-list');

                const addGenreCategoryBtn = document.getElementById('add-genre-category');
                const newGenreCategoryInput = document.getElementById('new-genre-category');
                const genreCategoriesList = document.getElementById('genre-categories-list');
                const addDawCategoryBtn = document.getElementById('add-daw-category');
                const newDawCategoryInput = document.getElementById('new-daw-category');
                const dawCategoriesList = document.getElementById('daw-categories-list');
                
                if (genreServerSelect) {
                    genreServerSelect.addEventListener('change', function() {
                        currentGuildId = this.value;
                        if (currentGuildId) {
                            loadChannels();
                            loadStats();
                            loadSettings();
                            loadCategories();
                            genreStatsSection.style.display = 'block';
                            genreSettingsSection.style.display = 'block';
                            genreManagementSection.style.display = 'block';
                            dawManagementSection.style.display = 'block';
                        } else {
                            genreStatsSection.style.display = 'none';
                            genreSettingsSection.style.display = 'none';
                            genreManagementSection.style.display = 'none';
                            dawManagementSection.style.display = 'none';
                        }
                    });
                }

                if (addGenreCategoryBtn) {
                    addGenreCategoryBtn.addEventListener('click', async function() {
                        const categoryName = newGenreCategoryInput.value.trim();
                        if (!categoryName || !currentGuildId) return;
                        await addCategory('genre', categoryName);
                    });
                }

                if (addDawCategoryBtn) {
                    addDawCategoryBtn.addEventListener('click', async function() {
                        const categoryName = newDawCategoryInput.value.trim();
                        if (!categoryName || !currentGuildId) return;
                        await addCategory('daw', categoryName);
                    });
                }

                if (newGenreCategoryInput) {
                    newGenreCategoryInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') addGenreCategoryBtn.click();
                    });
                }

                if (newDawCategoryInput) {
                    newDawCategoryInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') addDawCategoryBtn.click();
                    });
                }
                
                if (saveGenreSettings) {
                    saveGenreSettings.addEventListener('click', saveSettings);
                }
                
                if (refreshGenreStats) {
                    refreshGenreStats.addEventListener('click', loadStats);
                }
                
                loadServers();
                
                async function loadServers() {
                    try {
                        const response = await fetch('/api/servers');
                        const servers = await response.json();
                        
                        if (genreServerSelect) {
                            genreServerSelect.innerHTML = '<option value="">Select a server...</option>';
                            servers.forEach(function(server) {
                                const option = document.createElement('option');
                                option.value = server.id;
                                option.textContent = server.name;
                                genreServerSelect.appendChild(option);
                            });
                        }
                    } catch (error) {
                        console.error('Error loading servers:', error);
                    }
                }
                
                async function loadChannels() {
                    if (!currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/channels/' + currentGuildId);
                        const channels = await response.json();
                        
                        if (genreLogChannel) {
                            const currentVal = genreLogChannel.value;
                            genreLogChannel.innerHTML = '<option value="">None (no logging)</option>';
                            channels.forEach(function(channel) {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = '#' + channel.name;
                                genreLogChannel.appendChild(option);
                            });
                            genreLogChannel.value = currentVal;
                        }
                    } catch (error) {
                        console.error('Error loading channels:', error);
                    }
                }
                
                async function loadSettings() {
                    if (!currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/settings/' + currentGuildId);
                        const settings = await response.json();
                        
                        if (genreLogChannel) {
                            genreLogChannel.value = settings.logChannelId || '';
                        }
                    } catch (error) {
                        console.error('Error loading settings:', error);
                    }
                }

                async function loadCategories() {
                    if (!currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/categories');
                        const data = await response.json();
                        
                        renderCategories('genre', data.genreChunks, genreCategoriesList);
                        renderCategories('daw', data.dawChunks, dawCategoriesList);
                    } catch (error) {
                        console.error('Error loading categories:', error);
                    }
                }

                function renderCategories(type, categories, container) {
                    if (!container) return;
                    
                    container.innerHTML = '';
                    
                    categories.forEach(function(category) {
                        const categoryDiv = document.createElement('div');
                        categoryDiv.className = 'category-container';
                        categoryDiv.style.border = '1px solid rgba(255,255,255,0.1)';
                        categoryDiv.style.borderRadius = '8px';
                        categoryDiv.style.padding = '15px';
                        categoryDiv.style.marginBottom = '15px';
                        categoryDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        
                        const items = type === 'genre' ? category.genres : category.daws;
                        const itemType = type === 'genre' ? 'genre' : 'DAW';
                        const safeId = category.name.replace(/\\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                        const escapedCategoryName = category.name.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
                        
                        categoryDiv.innerHTML = \`
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h4 style="margin: 0; color: #7289DA;">\${category.name} (\${items.length} \${itemType}s)</h4>
                                <button class="btn btn-danger btn-sm" onclick="window.deleteCategory('\${type}', '\${escapedCategoryName}')">🗑️ Delete Category</button>
                            </div>
                            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                                <input type="text" id="new-\${type}-\${safeId}" class="form-control" placeholder="Add new \${itemType}...">
                                <button class="btn btn-success btn-sm" onclick="window.addItem('\${type}', '\${escapedCategoryName}', 'new-\${type}-\${safeId}')">➕ Add</button>
                            </div>
                            <div class="items-list" style="display: flex; flex-wrap: wrap; gap: 5px;">
                                \${items.map(function(item) {
                                    const escapedItem = item.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
                                    return \`<span class="item-tag" style="background: rgba(114, 137, 218, 0.2); padding: 4px 8px; border-radius: 4px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;">
                                        \${item}
                                        <button onclick="window.removeItem('\${type}', '\${escapedCategoryName}', '\${escapedItem}')" style="background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 14px;">✕</button>
                                    </span>\`;
                                }).join('')}
                            </div>
                        \`;
                        container.appendChild(categoryDiv);
                    });
                }

                async function addCategory(type, name) {
                    if (!currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/categories', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: type, name: name, guildId: currentGuildId })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok) {
                            if (window.showNotification) window.showNotification('Category added successfully!', 'success');
                            if (type === 'genre') {
                                newGenreCategoryInput.value = '';
                            } else {
                                newDawCategoryInput.value = '';
                            }
                            loadCategories();
                        } else {
                            if (window.showNotification) window.showNotification('Error: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('Error adding category:', error);
                        if (window.showNotification) window.showNotification('Error adding category', 'error');
                    }
                }

                window.deleteCategory = async function(type, name) {
                    if (!currentGuildId) return;
                    if (!confirm('Are you sure you want to delete this category and all its items?')) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/categories/' + type + '/' + encodeURIComponent(name) + '?guildId=' + currentGuildId, {
                            method: 'DELETE'
                        });
                        
                        if (response.ok) {
                            if (window.showNotification) window.showNotification('Category deleted successfully!', 'success');
                            loadCategories();
                        } else {
                            const result = await response.json();
                            if (window.showNotification) window.showNotification('Error: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('Error deleting category:', error);
                        if (window.showNotification) window.showNotification('Error deleting category', 'error');
                    }
                };

                window.addItem = async function(type, categoryName, inputId) {
                    const input = document.getElementById(inputId);
                    const item = input.value.trim();
                    if (!item || !currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/categories/' + type + '/' + encodeURIComponent(categoryName) + '/items', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ item: item, guildId: currentGuildId })
                        });
                        
                        if (response.ok) {
                            if (window.showNotification) window.showNotification('Item added successfully!', 'success');
                            input.value = '';
                            loadCategories();
                        } else {
                            const result = await response.json();
                            if (window.showNotification) window.showNotification('Error: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('Error adding item:', error);
                        if (window.showNotification) window.showNotification('Error adding item', 'error');
                    }
                };

                window.removeItem = async function(type, categoryName, item) {
                    if (!currentGuildId) return;
                    if (!confirm('Are you sure you want to remove "' + item + '"?')) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/categories/' + type + '/' + encodeURIComponent(categoryName) + '/items/' + encodeURIComponent(item) + '?guildId=' + currentGuildId, {
                            method: 'DELETE'
                        });
                        
                        if (response.ok) {
                            if (window.showNotification) window.showNotification('Item removed successfully!', 'success');
                            loadCategories();
                        } else {
                            const result = await response.json();
                            if (window.showNotification) window.showNotification('Error: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('Error removing item:', error);
                        if (window.showNotification) window.showNotification('Error removing item', 'error');
                    }
                };

                async function loadStats() {
                    if (!currentGuildId) return;
                    
                    try {
                        const response = await fetch('/api/plugins/genrediscovery/stats/' + currentGuildId);
                        const stats = await response.json();
                        
                        if (genreStatsList) {
                            genreStatsList.innerHTML = '';
                            if (stats.topGenres.length === 0) {
                                genreStatsList.innerHTML = '<div class="stats-item"><span>No genre data yet</span></div>';
                            } else {
                                stats.topGenres.forEach(function(item) {
                                    const div = document.createElement('div');
                                    div.className = 'stats-item';
                                    div.innerHTML = \`<span class="stats-name">\${item[0]}</span><span class="stats-count">\${item[1]}</span>\`;
                                    genreStatsList.appendChild(div);
                                });
                            }
                        }
                        
                        if (dawStatsList) {
                            dawStatsList.innerHTML = '';
                            if (stats.topDaws.length === 0) {
                                dawStatsList.innerHTML = '<div class="stats-item"><span>No DAW data yet</span></div>';
                            } else {
                                stats.topDaws.forEach(function(item) {
                                    const div = document.createElement('div');
                                    div.className = 'stats-item';
                                    div.innerHTML = \`<span class="stats-name">\${item[0]}</span><span class="stats-count">\${item[1]}</span>\`;
                                    dawStatsList.appendChild(div);
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error loading stats:', error);
                    }
                }
                
                async function saveSettings() {
                    if (!currentGuildId) return;
                    
                    const saveBtn = document.getElementById('save-genre-settings');
                    const btnText = saveBtn ? saveBtn.querySelector('.btn-text') : null;
                    const btnLoader = saveBtn ? saveBtn.querySelector('.btn-loader') : null;
                    
                    if (saveBtn) saveBtn.disabled = true;
                    if (btnText) btnText.style.display = 'none';
                    if (btnLoader) btnLoader.style.display = 'inline';
                    
                    try {
                        const settings = {
                            logChannelId: genreLogChannel ? genreLogChannel.value || null : null
                        };
                        
                        const response = await fetch('/api/plugins/genrediscovery/settings/' + currentGuildId, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(settings)
                        });
                        
                        if (response.ok) {
                            if (window.showNotification) window.showNotification('Settings saved successfully!', 'success');
                        } else {
                            const result = await response.json();
                            if (window.showNotification) window.showNotification('Error: ' + (result.error || 'Failed to save'), 'error');
                        }
                    } catch (error) {
                        console.error('Error saving settings:', error);
                        if (window.showNotification) window.showNotification('Error saving settings', 'error');
                    } finally {
                        if (saveBtn) saveBtn.disabled = false;
                        if (btnText) btnText.style.display = 'inline';
                        if (btnLoader) btnLoader.style.display = 'none';
                    }
                }
                
                console.log('✓ Genre Discovery plugin v2.1 loaded with management features');
            })();`
        };
    }
}

module.exports = GenreDiscoveryPlugin;