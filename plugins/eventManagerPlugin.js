const fs = require('fs');
const https = require('https');
const { EmbedBuilder, SlashCommandBuilder, PermissionsBitField } = require('discord.js');

class EventManagerPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Event Manager';
        this.description = 'Manage collaborations and competitions with Google Sheets integration';
        this.version = '3.4.0';
        this.enabled = true;

        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;

        this.settingsFile = './data/eventManagerSettings.json';
        this.collaborationsFile = './data/eventManagerCollaborations.json';

        this.initializeDataFiles();
        this.setupRoutes();
        this.setupSlashCommands();

        console.log('Event Manager Plugin loaded successfully.');
    }

    initializeDataFiles() {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data');
        if (!fs.existsSync(this.settingsFile)) fs.writeFileSync(this.settingsFile, JSON.stringify({}, null, 2));
        if (!fs.existsSync(this.collaborationsFile)) fs.writeFileSync(this.collaborationsFile, JSON.stringify({ lastUpdated: 0, data: [] }, null, 2));
    }

    loadSettings() {
        try {
            return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        } catch {
            return {};
        }
    }

    saveSettings(settings) {
        fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
    }

    loadCollaborations() {
        return JSON.parse(fs.readFileSync(this.collaborationsFile, 'utf8'));
    }

    saveCollaborations(collaborations) {
        fs.writeFileSync(this.collaborationsFile, JSON.stringify(collaborations, null, 2));
    }

    async syncFromGoogleSheets() {
        const csvUrl = 'https://docs.google.com/spreadsheets/d/1_3XMoAsn6HbYBO0V8fBLQqyUipzxRlWPrah5DEUR2uc/export?format=csv&gid=0';
        return new Promise((resolve, reject) => {
            https.get(csvUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const collaborations = this.parseCSV(data);
                    this.saveCollaborations({ lastUpdated: Date.now(), data: collaborations });
                    resolve(collaborations);
                });
            }).on('error', reject);
        });
    }

    parseCSV(csvData) {
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const collaborations = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = [];
            let current = '';
            let inQuotes = false;
            for (let j = 0; j < lines[i].length; j++) {
                const char = lines[i][j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    values.push(current.trim().replace(/"/g, ''));
                    current = '';
                } else {
                    current += char;
                }
            }
            values.push(current.trim().replace(/"/g, ''));
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            collaborations.push(row);
        }
        return collaborations;
    }

    getUpcomingEvents(collaborations) {
        const now = new Date();
        const upcoming = [];
        collaborations.forEach(collab => {
            const dateFields = [
                { field: 'Competition Begin', type: 'Competition Start' },
                { field: 'Competition End', type: 'Competition End' },
                { field: 'Voting Start', type: 'Voting Begins' },
                { field: 'Voting End', type: 'Voting Ends' }
            ];
            dateFields.forEach(({ field, type }) => {
                if (collab[field]) {
                    const eventDate = new Date(collab[field]);
                    if (eventDate > now) {
                        const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
                        upcoming.push({
                            collaboration: collab['Collaborator'],
                            type,
                            date: eventDate,
                            daysUntil,
                            status: collab['Status']
                        });
                    }
                }
            });
        });
        return upcoming.sort((a, b) => a.date - b.date);
    }

    async checkPermissions(interaction) {
        const settings = this.loadSettings();
        const guildId = interaction.guildId;
        const guildSettings = settings[guildId];

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!guildSettings) {
            await interaction.reply({ content: '❌ Event Manager permissions not configured.', ephemeral: true });
            return false;
        }
        if (!guildSettings.allowedChannels.includes(interaction.channelId)) {
            await interaction.reply({ content: '❌ You cannot use this command in this channel.', ephemeral: true });
            return false;
        }
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

        const hasRole = member.roles.cache.some(role => guildSettings.allowedRoles.includes(role.id));
        if (hasRole) return true;

        await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        return false;
    }

    setupSlashCommands() {
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            if (!await this.checkPermissions(interaction)) return;

            const collaborations = this.loadCollaborations().data;
            const { commandName } = interaction;

            if (commandName === 'upcomingevents') {
                const upcoming = this.getUpcomingEvents(collaborations);
                if (!upcoming.length) {
                    await interaction.reply('✅ No upcoming events.');
                    return;
                }
                const embed = new EmbedBuilder()
                    .setColor(0x7289da)
                    .setTitle('📅 Upcoming Events')
                    .setDescription(
                        upcoming.slice(0, 10)
                            .map(e => `**${e.collaboration}** (${e.type})\n📆 ${e.date.toLocaleDateString()} (${e.daysUntil} days)\n🟢 ${e.status}`)
                            .join('\n\n')
                    );
                await interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'competitionstatus') {
                const name = interaction.options.getString('name');
                const match = collaborations.find(c => c['Collaborator'].toLowerCase().includes(name.toLowerCase()));
                if (!match) {
                    await interaction.reply(`❌ No competition found with name matching "${name}".`);
                    return;
                }
                const embed = new EmbedBuilder()
                    .setColor(0x00bfff)
                    .setTitle(`ℹ️ ${match['Collaborator']}`)
                    .addFields(
                        { name: 'Status', value: match['Status'] || 'N/A' },
                        { name: 'Product', value: match['Product'] || 'N/A' },
                        { name: 'Last Contact', value: match['Last Contact'] || 'N/A' },
                        { name: 'Notes', value: match['Notes'] || 'N/A' }
                    );
                await interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'competitionsummary') {
                const counts = collaborations.reduce((acc, c) => {
                    acc[c.Status] = (acc[c.Status] || 0) + 1;
                    return acc;
                }, {});
                const embed = new EmbedBuilder()
                    .setColor(0x00ff99)
                    .setTitle('📊 Competitions Summary')
                    .setDescription(
                        Object.entries(counts)
                            .map(([status, count]) => `**${status}**: ${count}`)
                            .join('\n')
                    );
                await interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'lastcontact') {
                const sorted = [...collaborations].sort((a, b) => {
                    const dateA = new Date(a['Last Contact'] || 0);
                    const dateB = new Date(b['Last Contact'] || 0);
                    return dateB - dateA;
                });
                const embed = new EmbedBuilder()
                    .setColor(0xcccccc)
                    .setTitle('🕐 Last Contact')
                    .setDescription(
                        sorted.slice(0, 10)
                            .map(c => `**${c['Collaborator']}**\n🟢 ${c['Status']}\n📆 ${c['Last Contact'] || 'N/A'}`)
                            .join('\n\n')
                    );
                await interaction.reply({ embeds: [embed] });
            }
        });
    }

    getSlashCommands() {
        return [
            new SlashCommandBuilder().setName('upcomingevents').setDescription('Show upcoming competitions and events.'),
            new SlashCommandBuilder().setName('competitionstatus').setDescription('Get the status of a specific competition.')
                .addStringOption(option => option.setName('name').setDescription('Part of the collaborator name').setRequired(true)),
            new SlashCommandBuilder().setName('competitionsummary').setDescription('Show counts of competitions per status.'),
            new SlashCommandBuilder().setName('lastcontact').setDescription('Show recent contacts sorted by date.')
        ].map(cmd => cmd.toJSON());
    }

    setupRoutes() {
        this.app.get('/api/plugins/eventmanager/settings/:guildId', this.ensureAuthenticated, (req, res) => {
            const settings = this.loadSettings();
            res.json(settings[req.params.guildId] || { allowedRoles: [], allowedChannels: [] });
        });

        this.app.post('/api/plugins/eventmanager/settings/:guildId', this.ensureAuthenticated, (req, res) => {
            const settings = this.loadSettings();
            settings[req.params.guildId] = req.body;
            this.saveSettings(settings);
            res.json({ success: true });
        });

        this.app.get('/api/plugins/eventmanager/server-data/:guildId', this.ensureAuthenticated, (req, res) => {
            const guild = this.client.guilds.cache.get(req.params.guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });
            const roles = guild.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name }));
            const channels = guild.channels.cache.filter(c => c.isTextBased()).map(c => ({ id: c.id, name: c.name }));
            res.json({ roles, channels });
        });

        this.app.post('/api/plugins/eventmanager/sync', this.ensureAuthenticated, async (req, res) => {
            try {
                const collaborations = await this.syncFromGoogleSheets();
                res.json({ success: true, data: collaborations });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    getFrontendComponent() {
        return {
            id: 'event-manager',
            name: 'Event Manager',
            description: 'Manage competitions and collaborations',
            icon: '📅',
            containerId: 'eventManagerContainer',
            pageId: 'event-manager',
            navIcon: '📅',
            html: `<div class="plugin-container glass-panel">
                <div class="plugin-header">
                    <h3><span class="plugin-icon">📅</span> Event Manager</h3>
                    <p>Manage collaborations and competition permissions</p>
                </div>
                <div class="form-group">
                    <label>Server</label>
                    <select id="eventServerSelect" class="form-control"></select>
                </div>
                <div id="eventSettings" style="display:none; margin-top:20px;">
                    <div class="form-group">
                        <label>Allowed Roles</label>
                        <select id="eventRoles" class="form-control" multiple></select>
                    </div>
                    <div class="form-group">
                        <label>Allowed Channels</label>
                        <select id="eventChannels" class="form-control" multiple></select>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:10px;">
                        <button id="saveEventSettingsBtn" class="btn-primary">💾 Save Settings</button>
                        <button id="syncEventsBtn" class="btn-secondary">🔄 Sync Google Sheet</button>
                    </div>
                </div>
            </div>`,
            script: `(function(){
                const serverSelect = document.getElementById('eventServerSelect');
                const settingsDiv = document.getElementById('eventSettings');
                const rolesSelect = document.getElementById('eventRoles');
                const channelsSelect = document.getElementById('eventChannels');
                const saveBtn = document.getElementById('saveEventSettingsBtn');
                const syncBtn = document.getElementById('syncEventsBtn');
                let currentServer = null;
                async function loadServers(){
                    const res = await fetch('/api/servers');
                    const servers = await res.json();
                    serverSelect.innerHTML = '<option value="">Select server...</option>';
                    servers.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.name;
                        serverSelect.appendChild(opt);
                    });
                }
                async function loadServerData(serverId){
                    const res = await fetch('/api/plugins/eventmanager/server-data/' + serverId);
                    const data = await res.json();
                    rolesSelect.innerHTML = '';
                    channelsSelect.innerHTML = '';
                    data.roles.forEach(r => {
                        const opt = document.createElement('option');
                        opt.value = r.id;
                        opt.textContent = r.name;
                        rolesSelect.appendChild(opt);
                    });
                    data.channels.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c.id;
                        opt.textContent = '#' + c.name;
                        channelsSelect.appendChild(opt);
                    });
                }
                async function loadSettings(serverId){
                    const res = await fetch('/api/plugins/eventmanager/settings/' + serverId);
                    const settings = await res.json();
                    [...rolesSelect.options].forEach(o => {
                        o.selected = (settings.allowedRoles && settings.allowedRoles.includes(o.value));
                    });
                    [...channelsSelect.options].forEach(o => {
                        o.selected = (settings.allowedChannels && settings.allowedChannels.includes(o.value));
                    });
                }
                serverSelect.addEventListener('change', async ()=>{
                    currentServer = serverSelect.value;
                    if(!currentServer){
                        settingsDiv.style.display='none';
                        return;
                    }
                    await loadServerData(currentServer);
                    await loadSettings(currentServer);
                    settingsDiv.style.display='block';
                });
                saveBtn.addEventListener('click', async ()=>{
                    if(!currentServer) return;
                    const body={
                        allowedRoles: [...rolesSelect.selectedOptions].map(o=>o.value),
                        allowedChannels: [...channelsSelect.selectedOptions].map(o=>o.value)
                    };
                    await fetch('/api/plugins/eventmanager/settings/' + currentServer,{
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify(body)
                    });
                    alert('✅ Settings saved.');
                });
                syncBtn.addEventListener('click', async ()=>{
                    await fetch('/api/plugins/eventmanager/sync',{method:'POST'});
                    alert('✅ Synced from Google Sheets.');
                });
                loadServers();
            })()`
        };
    }
}

module.exports = EventManagerPlugin;
