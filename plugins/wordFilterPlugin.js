const fs = require('fs');
const path = require('path');

class WordFilterPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Word Filter';
        this.description = 'Automatically detect and filter inappropriate words from messages';
        this.version = '1.2.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // Storage for filter settings per server
        this.filterSettings = this.loadFilterSettings();
        
        // Statistics tracking
        this.filterStats = this.loadFilterStats();
        
        this.setupRoutes();
        this.setupMessageListener();
    }

    loadFilterSettings() {
        try {
            const settingsPath = './data/wordFilterSettings.json';
            if (fs.existsSync(settingsPath)) {
                return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading word filter settings:', error);
        }
        return {};
    }

    saveFilterSettings() {
        try {
            const dataDir = './data';
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir);
            }
            fs.writeFileSync('./data/wordFilterSettings.json', JSON.stringify(this.filterSettings, null, 2));
        } catch (error) {
            console.error('Error saving word filter settings:', error);
        }
    }

    loadFilterStats() {
        try {
            const statsPath = './data/wordFilterStats.json';
            if (fs.existsSync(statsPath)) {
                return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading word filter stats:', error);
        }
        return {};
    }

    saveFilterStats() {
        try {
            const dataDir = './data';
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir);
            }
            fs.writeFileSync('./data/wordFilterStats.json', JSON.stringify(this.filterStats, null, 2));
        } catch (error) {
            console.error('Error saving word filter stats:', error);
        }
    }

    updateFilterStats(serverId, userId, detectedWords) {
        const today = new Date().toDateString();
        
        if (!this.filterStats[serverId]) {
            this.filterStats[serverId] = {
                totalFiltered: 0,
                dailyStats: {},
                topWords: {},
                topUsers: {}
            };
        }
        
        const serverStats = this.filterStats[serverId];
        
        // Update total
        serverStats.totalFiltered++;
        
        // Update daily stats
        if (!serverStats.dailyStats[today]) {
            serverStats.dailyStats[today] = 0;
        }
        serverStats.dailyStats[today]++;
        
        // Update word stats
        detectedWords.forEach(word => {
            if (!serverStats.topWords[word]) {
                serverStats.topWords[word] = 0;
            }
            serverStats.topWords[word]++;
        });
        
        // Update user stats
        if (!serverStats.topUsers[userId]) {
            serverStats.topUsers[userId] = 0;
        }
        serverStats.topUsers[userId]++;
        
        this.saveFilterStats();
    }

    setupRoutes() {
        // Get filter settings for a server
        this.app.get('/api/plugins/wordfilter/settings/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const settings = this.filterSettings[serverId] || {
                    enabled: false,
                    logChannelId: null,
                    blockedWords: [],
                    repostCensored: true,
                    dmUser: true,
                    severity: 'medium', // low, medium, high
                    exemptRoles: [],
                    exemptChannels: []
                };
                
                res.json(settings);
            } catch (error) {
                console.error('Error getting filter settings:', error);
                res.status(500).json({ error: 'Failed to get filter settings' });
            }
        });

        // Update filter settings for a server
        this.app.post('/api/plugins/wordfilter/settings/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const settings = req.body;
                this.filterSettings[serverId] = {
                    ...this.filterSettings[serverId],
                    ...settings
                };
                
                this.saveFilterSettings();
                res.json({ success: true, settings: this.filterSettings[serverId] });
            } catch (error) {
                console.error('Error updating filter settings:', error);
                res.status(500).json({ error: 'Failed to update filter settings' });
            }
        });

        // Add a blocked word
        this.app.post('/api/plugins/wordfilter/words/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                const { word } = req.body;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const normalizedWord = word.trim().toLowerCase();
                
                if (!this.filterSettings[serverId]) {
                    this.filterSettings[serverId] = {
                        enabled: false,
                        logChannelId: null,
                        blockedWords: [],
                        repostCensored: true,
                        dmUser: true,
                        severity: 'medium',
                        exemptRoles: [],
                        exemptChannels: []
                    };
                }
                
                if (!this.filterSettings[serverId].blockedWords.includes(normalizedWord)) {
                    this.filterSettings[serverId].blockedWords.push(normalizedWord);
                    this.saveFilterSettings();
                }
                
                res.json({ success: true, blockedWords: this.filterSettings[serverId].blockedWords });
            } catch (error) {
                console.error('Error adding blocked word:', error);
                res.status(500).json({ error: 'Failed to add blocked word' });
            }
        });

        // Remove a blocked word
        this.app.delete('/api/plugins/wordfilter/words/:serverId/:word', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId, word } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                if (this.filterSettings[serverId]) {
                    const normalizedWord = decodeURIComponent(word).toLowerCase();
                    this.filterSettings[serverId].blockedWords = this.filterSettings[serverId].blockedWords
                        .filter(w => w !== normalizedWord);
                    this.saveFilterSettings();
                }
                
                res.json({ success: true, blockedWords: this.filterSettings[serverId]?.blockedWords || [] });
            } catch (error) {
                console.error('Error removing blocked word:', error);
                res.status(500).json({ error: 'Failed to remove blocked word' });
            }
        });

        // Get filter statistics
        this.app.get('/api/plugins/wordfilter/stats/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const stats = this.filterStats[serverId] || {
                    totalFiltered: 0,
                    dailyStats: {},
                    topWords: {},
                    topUsers: {}
                };
                
                // Get last 7 days of stats
                const last7Days = [];
                for (let i = 6; i >= 0; i--) {
                    const date = new Date();
                    date.setDate(date.getDate() - i);
                    const dateStr = date.toDateString();
                    last7Days.push({
                        date: dateStr,
                        count: stats.dailyStats[dateStr] || 0
                    });
                }
                
                // Get top 5 words
                const topWords = Object.entries(stats.topWords)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([word, count]) => ({ word, count }));
                
                res.json({
                    totalFiltered: stats.totalFiltered,
                    last7Days,
                    topWords,
                    todayCount: stats.dailyStats[new Date().toDateString()] || 0
                });
            } catch (error) {
                console.error('Error getting filter stats:', error);
                res.status(500).json({ error: 'Failed to get filter stats' });
            }
        });

        // Import predefined word lists
        this.app.post('/api/plugins/wordfilter/import/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                const { category } = req.body;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const predefinedLists = {
                    basic: ['spam', 'scam', 'fake', 'bot'],
                    profanity: ['mild profanity examples'], // Add appropriate words for your use case
                    toxicity: ['toxic', 'hate', 'harassment'],
                    custom: [] // Allow custom imports
                };
                
                const wordsToAdd = predefinedLists[category] || [];
                
                if (!this.filterSettings[serverId]) {
                    this.filterSettings[serverId] = {
                        enabled: false,
                        logChannelId: null,
                        blockedWords: [],
                        repostCensored: true,
                        dmUser: true,
                        severity: 'medium',
                        exemptRoles: [],
                        exemptChannels: []
                    };
                }
                
                // Add words that don't already exist
                const existingWords = this.filterSettings[serverId].blockedWords;
                const newWords = wordsToAdd.filter(word => !existingWords.includes(word.toLowerCase()));
                
                this.filterSettings[serverId].blockedWords.push(...newWords);
                this.saveFilterSettings();
                
                res.json({ 
                    success: true, 
                    added: newWords.length,
                    blockedWords: this.filterSettings[serverId].blockedWords 
                });
            } catch (error) {
                console.error('Error importing word list:', error);
                res.status(500).json({ error: 'Failed to import word list' });
            }
        });
    }

    setupMessageListener() {
        this.client.on('messageCreate', async (message) => {
            // Skip if bot message or no guild
            if (message.author.bot || !message.guild) return;
            
            const serverId = message.guild.id;
            const settings = this.filterSettings[serverId];
            
            // Skip if filter not enabled
            if (!settings || !settings.enabled) return;
            
            // Skip if user has exempt role
            if (settings.exemptRoles && settings.exemptRoles.length > 0) {
                const hasExemptRole = message.member.roles.cache.some(role => 
                    settings.exemptRoles.includes(role.id)
                );
                if (hasExemptRole) return;
            }
            
            // Skip if channel is exempt
            if (settings.exemptChannels && settings.exemptChannels.includes(message.channel.id)) {
                return;
            }
            
            // Check for blocked words
            const detectedWords = this.detectBlockedWords(message.content, settings.blockedWords);
            
            if (detectedWords.length > 0) {
                try {
                    // Update statistics
                    this.updateFilterStats(serverId, message.author.id, detectedWords);
                    
                    // Delete original message
                    await message.delete();
                    
                    // Send log to designated channel
                    if (settings.logChannelId) {
                        await this.logFilteredMessage(message, detectedWords, settings.logChannelId);
                    }
                    
                    // Repost censored message if enabled
                    if (settings.repostCensored) {
                        await this.repostCensoredMessage(message, detectedWords);
                    }
                    
                    // DM user if enabled
                    if (settings.dmUser) {
                        await this.sendUserDM(message.author, detectedWords, message.channel, message.guild);
                    }
                    
                    console.log(`🚫 Filtered message from ${message.author.username} in ${message.guild.name}: ${detectedWords.join(', ')}`);
                    
                } catch (error) {
                    console.error('Error processing filtered message:', error);
                }
            }
        });
    }

    detectBlockedWords(content, blockedWords) {
        if (!content || !blockedWords || blockedWords.length === 0) return [];
        
        const detected = [];
        const normalizedContent = content.toLowerCase();
        
        blockedWords.forEach(word => {
            // Use word boundaries to avoid false positives
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (regex.test(normalizedContent)) {
                detected.push(word);
            }
        });
        
        return detected;
    }

    censorContent(content, blockedWords) {
        if (!content || !blockedWords || blockedWords.length === 0) return content;
        
        let censoredContent = content;
        
        blockedWords.forEach(word => {
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            censoredContent = censoredContent.replace(regex, '❌');
        });
        
        return censoredContent;
    }

    async logFilteredMessage(message, detectedWords, logChannelId) {
        try {
            const logChannel = this.client.channels.cache.get(logChannelId);
            if (!logChannel) return;
            
            const embed = {
                color: 0xff6b6b,
                title: '🚫 Message Filtered',
                fields: [
                    {
                        name: 'User',
                        value: `${message.author.username} (${message.author.id})`,
                        inline: true
                    },
                    {
                        name: 'Channel',
                        value: `${message.channel.name}`,
                        inline: true
                    },
                    {
                        name: 'Detected Words',
                        value: detectedWords.map(word => `\`${word}\``).join(', '),
                        inline: false
                    },
                    {
                        name: 'Original Message',
                        value: message.content.length > 1000 ? 
                            message.content.substring(0, 1000) + '...' : 
                            message.content,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Word Filter Log'
                }
            };
            
            await logChannel.send({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error logging filtered message:', error);
        }
    }

    async repostCensoredMessage(originalMessage, detectedWords) {
        try {
            const webhook = await this.getChannelWebhook(originalMessage.channel);
            if (!webhook) return;
            
            const censoredContent = this.censorContent(originalMessage.content, detectedWords);
            
            const webhookOptions = {
                content: censoredContent + '\n\n*🥭*',
                username: originalMessage.author.username,
                avatarURL: originalMessage.author.displayAvatarURL()
            };
            
            return await webhook.send(webhookOptions);
            
        } catch (error) {
            console.error('Error reposting censored message:', error);
        }
    }

    async getChannelWebhook(channel) {
        try {
            if (!channel.guild.members.me.permissions.has('ManageWebhooks')) {
                return null;
            }

            const webhooks = await channel.fetchWebhooks();
            let webhook = webhooks.find(wh => wh.owner.id === this.client.user.id && wh.name === 'Fuji Word Filter');
            
            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: 'Fuji Word Filter',
                    reason: 'Created for word filter message reposting'
                });
            }
            
            return webhook;
        } catch (error) {
            console.error('Error creating/getting webhook:', error);
            return null;
        }
    }

    async sendUserDM(user, detectedWords, channel, guild) {
        try {
            const embed = {
                color: 0xff6b6b,
                title: '🚫 Message Filtered',
                description: `Your message in **${guild.name}** was filtered for containing inappropriate content.`,
                fields: [
                    {
                        name: 'Channel',
                        value: `#${channel.name}`,
                        inline: true
                    },
                    {
                        name: 'Detected Words',
                        value: detectedWords.map(word => `\`${word}\``).join(', '),
                        inline: true
                    }
                ],
                footer: {
                    text: 'Your message has been reposted with the inappropriate words censored.'
                },
                timestamp: new Date().toISOString()
            };
            
            await user.send({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error sending DM to user:', error);
        }
    }

    getFrontendComponent() {
        return {
            id: 'word-filter',
            name: 'Word Filter',
            description: 'Automatically detect and filter inappropriate words from messages',
            icon: '🚫',
            version: '1.2.0',
            containerId: 'wordFilterPluginContainer',
            pageId: 'word-filter',
            
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🚫</span> Word Filter</h3>
                        <p>Automatically detect and filter inappropriate words from messages</p>
                    </div>
                    
                    <!-- Server Selection with Dashboard Integration -->
                    <div class="server-sync-notice" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🔗</span>
                            <div>
                                <strong>Dashboard Integration</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Managing server: <span id="currentServerName">Auto-detected</span></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Filter Statistics -->
                    <div class="stats-section" style="margin-bottom: 24px;">
                        <h4>Filter Statistics</h4>
                        <div class="filter-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div class="stat-card">
                                <div class="stat-value" id="totalFiltered">0</div>
                                <div class="stat-label">Total Filtered</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="todayFiltered">0</div>
                                <div class="stat-label">Filtered Today</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="blockedWordsCount">0</div>
                                <div class="stat-label">Blocked Words</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Settings Form -->
                    <form id="wordFilterForm" class="filter-form">
                        <!-- Basic Settings -->
                        <div class="settings-section">
                            <h4>Basic Settings</h4>
                            
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="filterEnabled">
                                    <span class="checkmark"></span>
                                    Enable Word Filter
                                </label>
                            </div>
                            
                            <div class="form-group">
                                <label for="logChannelSelect">Log Channel (Optional)</label>
                                <select id="logChannelSelect" class="form-control">
                                    <option value="">Select a channel for logging...</option>
                                </select>
                                <small>Channel where filtered messages will be logged</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="severitySelect">Filter Severity</label>
                                <select id="severitySelect" class="form-control">
                                    <option value="low">Low - Basic filtering</option>
                                    <option value="medium">Medium - Standard filtering</option>
                                    <option value="high">High - Strict filtering</option>
                                </select>
                            </div>
                        </div>
                        
                        <!-- Advanced Options -->
                        <div class="settings-section">
                            <h4>Advanced Options</h4>
                            
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="repostCensored">
                                    <span class="checkmark"></span>
                                    Repost Censored Messages
                                </label>
                                <small>Automatically repost messages with blocked words replaced by ❌</small>
                            </div>
                            
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="dmUser">
                                    <span class="checkmark"></span>
                                    DM Users When Filtered
                                </label>
                                <small>Send a direct message to users when their messages are filtered</small>
                            </div>
                        </div>
                        
                        <!-- Exempt Roles -->
                        <div class="settings-section">
                            <h4>Exempt Roles</h4>
                            <div class="form-group">
                                <label for="exemptRolesSelect">Roles Exempt from Filtering</label>
                                <select id="exemptRolesSelect" class="form-control" multiple>
                                    <!-- Will be populated with server roles -->
                                </select>
                                <small>Users with these roles will bypass the word filter</small>
                            </div>
                        </div>
                        
                        <!-- Exempt Channels -->
                        <div class="settings-section">
                            <h4>Exempt Channels</h4>
                            <div class="form-group">
                                <label for="exemptChannelsSelect">Channels Exempt from Filtering</label>
                                <select id="exemptChannelsSelect" class="form-control" multiple>
                                    <!-- Will be populated with server channels -->
                                </select>
                                <small>Messages in these channels will not be filtered</small>
                            </div>
                        </div>
                        
                        <!-- Save Button -->
                        <div class="form-actions">
                            <button type="submit" id="saveFilterSettings" class="btn btn-primary">
                                <span class="btn-icon">💾</span>
                                <span class="btn-text">Save Settings</span>
                                <span class="btn-loader" style="display: none;">Saving...</span>
                            </button>
                        </div>
                    </form>
                    
                    <!-- Blocked Words Management -->
                    <div class="words-section">
                        <div class="section-header">
                            <h4>Blocked Words Management</h4>
                            <div class="header-actions">
                                <button type="button" id="importWordsBtn" class="btn btn-secondary">
                                    <span class="btn-icon">📥</span>
                                    Import List
                                </button>
                                <button type="button" id="exportWordsBtn" class="btn btn-secondary">
                                    <span class="btn-icon">📤</span>
                                    Export List
                                </button>
                            </div>
                        </div>
                        
                        <!-- Add Word Form -->
                        <div class="add-word-form">
                            <div class="form-group">
                                <label for="newWordInput">Add Blocked Word</label>
                                <div style="display: flex; gap: 8px;">
                                    <input type="text" id="newWordInput" class="form-control" placeholder="Enter word to block..." style="flex: 1;">
                                    <button type="button" id="addWordBtn" class="btn btn-primary">
                                        <span class="btn-icon">➕</span>
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Blocked Words List -->
                        <div class="blocked-words-container">
                            <div class="words-header">
                                <h5>Current Blocked Words (<span id="wordsCount">0</span>)</h5>
                                <div class="words-actions">
                                    <input type="text" id="searchWords" class="form-control" placeholder="Search words..." style="width: 200px;">
                                    <button type="button" id="clearAllWords" class="btn btn-danger btn-sm">
                                        Clear All
                                    </button>
                                </div>
                            </div>
                            <div id="blockedWordsList" class="words-list">
                                <div class="loading-words">Loading blocked words...</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Import Modal -->
                    <div id="importModal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h4>Import Word List</h4>
                                <button type="button" class="close-modal">×</button>
                            </div>
                            <div class="modal-body">
                                <p>Choose a predefined word list to import:</p>
                                <div class="import-options">
                                    <button type="button" class="import-option" data-category="basic">
                                        <strong>Basic Filter</strong>
                                        <div>Common spam and scam terms</div>
                                    </button>
                                    <button type="button" class="import-option" data-category="toxicity">
                                        <strong>Toxicity Filter</strong>
                                        <div>Hate speech and harassment terms</div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Success/Error Messages -->
                    <div id="filterResult" class="result-message" style="display: none;"></div>
                </div>
            `,

            script: `
                // Enhanced Word Filter Plugin Frontend Logic with Dashboard Integration
                (function() {
                    console.log('🚫 Enhanced Word Filter Plugin: Initializing...');
                    
                    // Get form elements
                    const filterForm = document.getElementById('wordFilterForm');
                    const filterEnabled = document.getElementById('filterEnabled');
                    const logChannelSelect = document.getElementById('logChannelSelect');
                    const severitySelect = document.getElementById('severitySelect');
                    const repostCensored = document.getElementById('repostCensored');
                    const dmUser = document.getElementById('dmUser');
                    const exemptRolesSelect = document.getElementById('exemptRolesSelect');
                    const exemptChannelsSelect = document.getElementById('exemptChannelsSelect');
                    const saveBtn = document.getElementById('saveFilterSettings');
                    const currentServerName = document.getElementById('currentServerName');
                    const filterResult = document.getElementById('filterResult');
                    
                    // Words management elements
                    const newWordInput = document.getElementById('newWordInput');
                    const addWordBtn = document.getElementById('addWordBtn');
                    const blockedWordsList = document.getElementById('blockedWordsList');
                    const searchWords = document.getElementById('searchWords');
                    const wordsCount = document.getElementById('wordsCount');
                    const clearAllWords = document.getElementById('clearAllWords');
                    const importWordsBtn = document.getElementById('importWordsBtn');
                    const exportWordsBtn = document.getElementById('exportWordsBtn');
                    const importModal = document.getElementById('importModal');
                    
                    // Stats elements
                    const totalFiltered = document.getElementById('totalFiltered');
                    const todayFiltered = document.getElementById('todayFiltered');
                    const blockedWordsCount = document.getElementById('blockedWordsCount');
                    
                    // State variables
                    let currentServerId = null;
                    let currentSettings = {};
                    let allBlockedWords = [];
                    let filteredWords = [];
                    
                    // Initialize plugin
                    function initializeWordFilterPlugin() {
                        console.log('🚫 Initializing enhanced word filter plugin...');
                        
                        // Get current server from dashboard
                        if (window.dashboardAPI && window.dashboardAPI.currentServer) {
                            currentServerId = window.dashboardAPI.currentServer();
                            console.log('🚫 Current server from dashboard:', currentServerId);
                            
                            if (currentServerId) {
                                loadServerData();
                                updateServerDisplay();
                            }
                        }
                        
                        setupEventListeners();
                        
                        console.log('✅ Enhanced word filter plugin initialized');
                    }
                    
                    // Load all server data
                    async function loadServerData() {
                        if (!currentServerId) return;
                        
                        await Promise.all([
                            loadFilterSettings(),
                            loadFilterStats(),
                            loadChannelsAndRoles()
                        ]);
                    }
                    
                    // Load filter settings
                    async function loadFilterSettings() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/settings/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load settings');
                            
                            currentSettings = await response.json();
                            displaySettings(currentSettings);
                            allBlockedWords = currentSettings.blockedWords || [];
                            displayBlockedWords(allBlockedWords);
                            
                            console.log('🚫 Loaded filter settings:', currentSettings);
                        } catch (error) {
                            console.error('Error loading filter settings:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Failed to load filter settings', 'error');
                            }
                        }
                    }
                    
                    // Load filter statistics
                    async function loadFilterStats() {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/stats/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load stats');
                            
                            const stats = await response.json();
                            displayStats(stats);
                            
                            console.log('🚫 Loaded filter stats:', stats);
                        } catch (error) {
                            console.error('Error loading filter stats:', error);
                        }
                    }
                    
                    // Load channels and roles for dropdowns
                    async function loadChannelsAndRoles() {
                        if (!currentServerId) return;
                        
                        try {
                            // Load channels
                            const channelsResponse = await fetch(\`/api/channels/\${currentServerId}\`);
                            if (channelsResponse.ok) {
                                const channels = await channelsResponse.json();
                                populateChannelDropdowns(channels);
                            }
                            
                            // Load roles
                            const rolesResponse = await fetch(\`/api/roles/\${currentServerId}\`);
                            if (rolesResponse.ok) {
                                const roles = await rolesResponse.json();
                                populateRoleDropdown(roles);
                            }
                            
                        } catch (error) {
                            console.error('Error loading channels and roles:', error);
                        }
                    }
                    
                    // Update server display
                    function updateServerDisplay() {
                        if (currentServerName && window.dashboardAPI && window.dashboardAPI.getServerName) {
                            const serverName = window.dashboardAPI.getServerName(currentServerId);
                            currentServerName.textContent = serverName || 'Unknown Server';
                        }
                    }
                    
                    // Display settings in form
                    function displaySettings(settings) {
                        if (filterEnabled) filterEnabled.checked = settings.enabled || false;
                        if (logChannelSelect) logChannelSelect.value = settings.logChannelId || '';
                        if (severitySelect) severitySelect.value = settings.severity || 'medium';
                        if (repostCensored) repostCensored.checked = settings.repostCensored !== false;
                        if (dmUser) dmUser.checked = settings.dmUser !== false;
                        
                        // Set exempt roles
                        if (exemptRolesSelect && settings.exemptRoles) {
                            Array.from(exemptRolesSelect.options).forEach(option => {
                                option.selected = settings.exemptRoles.includes(option.value);
                            });
                        }
                        
                        // Set exempt channels
                        if (exemptChannelsSelect && settings.exemptChannels) {
                            Array.from(exemptChannelsSelect.options).forEach(option => {
                                option.selected = settings.exemptChannels.includes(option.value);
                            });
                        }
                    }
                    
                    // Display statistics
                    function displayStats(stats) {
                        if (totalFiltered) totalFiltered.textContent = stats.totalFiltered.toLocaleString();
                        if (todayFiltered) todayFiltered.textContent = stats.todayCount.toLocaleString();
                        if (blockedWordsCount) blockedWordsCount.textContent = allBlockedWords.length.toLocaleString();
                    }
                    
                    // Populate channel dropdowns
                    function populateChannelDropdowns(channels) {
                        // Log channel dropdown
                        if (logChannelSelect) {
                            logChannelSelect.innerHTML = '<option value="">Select a channel for logging...</option>';
                            channels.forEach(channel => {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`# \${channel.name}\`;
                                logChannelSelect.appendChild(option);
                            });
                        }
                        
                        // Exempt channels dropdown
                        if (exemptChannelsSelect) {
                            exemptChannelsSelect.innerHTML = '';
                            channels.forEach(channel => {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`# \${channel.name}\`;
                                exemptChannelsSelect.appendChild(option);
                            });
                        }
                    }
                    
                    // Populate role dropdown
                    function populateRoleDropdown(roles) {
                        if (!exemptRolesSelect) return;
                        
                        exemptRolesSelect.innerHTML = '';
                        roles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role.id;
                            option.textContent = role.name;
                            exemptRolesSelect.appendChild(option);
                        });
                    }
                    
                    // Display blocked words
                    function displayBlockedWords(words) {
                        if (!blockedWordsList) return;
                        
                        filteredWords = words;
                        
                        if (words.length === 0) {
                            blockedWordsList.innerHTML = '<div class="empty-words">No blocked words configured</div>';
                            if (wordsCount) wordsCount.textContent = '0';
                            return;
                        }
                        
                        if (wordsCount) wordsCount.textContent = words.length.toString();
                        
                        blockedWordsList.innerHTML = '';
                        words.forEach(word => {
                            const wordElement = document.createElement('div');
                            wordElement.className = 'word-item';
                            wordElement.innerHTML = \`
                                <span class="word-text">\${word}</span>
                                <button type="button" class="remove-word-btn" data-word="\${word}">
                                    <span>×</span>
                                </button>
                            \`;
                            blockedWordsList.appendChild(wordElement);
                        });
                    }
                    
                    // Filter words based on search
                    function filterWords(searchTerm) {
                        const filtered = allBlockedWords.filter(word => 
                            word.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        displayBlockedWords(filtered);
                    }
                    
                    // Setup event listeners
                    function setupEventListeners() {
                        // Form submission
                        if (filterForm) {
                            filterForm.addEventListener('submit', handleSettingsSave);
                        }
                        
                        // Add word
                        if (addWordBtn) {
                            addWordBtn.addEventListener('click', handleAddWord);
                        }
                        
                        if (newWordInput) {
                            newWordInput.addEventListener('keypress', function(e) {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddWord();
                                }
                            });
                        }
                        
                        // Remove word (delegated event)
                        if (blockedWordsList) {
                            blockedWordsList.addEventListener('click', function(e) {
                                if (e.target.closest('.remove-word-btn')) {
                                    const word = e.target.closest('.remove-word-btn').dataset.word;
                                    handleRemoveWord(word);
                                }
                            });
                        }
                        
                        // Search words
                        if (searchWords) {
                            searchWords.addEventListener('input', function(e) {
                                filterWords(e.target.value);
                            });
                        }
                        
                        // Clear all words
                        if (clearAllWords) {
                            clearAllWords.addEventListener('click', handleClearAllWords);
                        }
                        
                        // Import/Export
                        if (importWordsBtn) {
                            importWordsBtn.addEventListener('click', showImportModal);
                        }
                        
                        if (exportWordsBtn) {
                            exportWordsBtn.addEventListener('click', handleExportWords);
                        }
                        
                        // Modal events
                        document.addEventListener('click', function(e) {
                            if (e.target.classList.contains('close-modal')) {
                                hideImportModal();
                            }
                            
                            if (e.target.classList.contains('import-option')) {
                                const category = e.target.dataset.category;
                                handleImportWords(category);
                            }
                        });
                        
                        console.log('🚫 Event listeners setup complete');
                    }
                    
                    // Handle settings save
                    async function handleSettingsSave(e) {
                        e.preventDefault();
                        
                        if (!currentServerId) {
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('No server selected', 'error');
                            }
                            return;
                        }
                        
                        const btnText = saveBtn.querySelector('.btn-text');
                        const btnLoader = saveBtn.querySelector('.btn-loader');
                        
                        // Show loading state
                        if (btnText) btnText.style.display = 'none';
                        if (btnLoader) btnLoader.style.display = 'inline';
                        saveBtn.disabled = true;
                        
                        try {
                            const settings = {
                                enabled: filterEnabled ? filterEnabled.checked : false,
                                logChannelId: logChannelSelect ? logChannelSelect.value || null : null,
                                severity: severitySelect ? severitySelect.value : 'medium',
                                repostCensored: repostCensored ? repostCensored.checked : true,
                                dmUser: dmUser ? dmUser.checked : true,
                                exemptRoles: exemptRolesSelect ? Array.from(exemptRolesSelect.selectedOptions).map(opt => opt.value) : [],
                                exemptChannels: exemptChannelsSelect ? Array.from(exemptChannelsSelect.selectedOptions).map(opt => opt.value) : []
                            };
                            
                            const response = await fetch(\`/api/plugins/wordfilter/settings/\${currentServerId}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(settings)
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                currentSettings = result.settings;
                                showResult('Settings saved successfully!', 'success');
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification('Word filter settings saved', 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', 'Word filter settings updated');
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to save settings');
                            }
                            
                        } catch (error) {
                            console.error('Error saving settings:', error);
                            showResult(\`Error: \${error.message}\`, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            saveBtn.disabled = false;
                        }
                    }
                    
                    // Handle add word
                    async function handleAddWord() {
                        const word = newWordInput ? newWordInput.value.trim() : '';
                        
                        if (!word || !currentServerId) {
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Please enter a word', 'error');
                            }
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/words/\${currentServerId}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ word })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                if (newWordInput) newWordInput.value = '';
                                allBlockedWords = result.blockedWords;
                                displayBlockedWords(allBlockedWords);
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification(\`Added "\${word}" to blocked words\`, 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('info', \`Added blocked word: \${word}\`);
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to add word');
                            }
                        } catch (error) {
                            console.error('Error adding word:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    // Handle remove word
                    async function handleRemoveWord(word) {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/words/\${currentServerId}/\${encodeURIComponent(word)}\`, {
                                method: 'DELETE'
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                allBlockedWords = result.blockedWords;
                                displayBlockedWords(allBlockedWords);
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification(\`Removed "\${word}" from blocked words\`, 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('info', \`Removed blocked word: \${word}\`);
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to remove word');
                            }
                        } catch (error) {
                            console.error('Error removing word:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    // Handle clear all words
                    async function handleClearAllWords() {
                        if (!currentServerId || allBlockedWords.length === 0) return;
                        
                        if (!confirm(\`Are you sure you want to remove all \${allBlockedWords.length} blocked words?\`)) {
                            return;
                        }
                        
                        try {
                            // Remove all words one by one (could be optimized with a bulk endpoint)
                            for (const word of allBlockedWords) {
                                await fetch(\`/api/plugins/wordfilter/words/\${currentServerId}/\${encodeURIComponent(word)}\`, {
                                    method: 'DELETE'
                                });
                            }
                            
                            allBlockedWords = [];
                            displayBlockedWords(allBlockedWords);
                            
                            if (window.dashboardAPI) {
                                if (window.dashboardAPI.showNotification) {
                                    window.dashboardAPI.showNotification('All blocked words cleared', 'success');
                                }
                                if (window.dashboardAPI.addLogEntry) {
                                    window.dashboardAPI.addLogEntry('warning', 'All blocked words cleared');
                                }
                            }
                        } catch (error) {
                            console.error('Error clearing words:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Failed to clear all words', 'error');
                            }
                        }
                    }
                    
                    // Show import modal
                    function showImportModal() {
                        if (importModal) {
                            importModal.style.display = 'flex';
                        }
                    }
                    
                    // Hide import modal
                    function hideImportModal() {
                        if (importModal) {
                            importModal.style.display = 'none';
                        }
                    }
                    
                    // Handle import words
                    async function handleImportWords(category) {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/import/\${currentServerId}\`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ category })
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                allBlockedWords = result.blockedWords;
                                displayBlockedWords(allBlockedWords);
                                hideImportModal();
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification(\`Imported \${result.added} new words from \${category} list\`, 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('info', \`Imported \${result.added} words from \${category} list\`);
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to import words');
                            }
                        } catch (error) {
                            console.error('Error importing words:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    // Handle export words
                    function handleExportWords() {
                        if (allBlockedWords.length === 0) {
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('No words to export', 'error');
                            }
                            return;
                        }
                        
                        const dataStr = JSON.stringify(allBlockedWords, null, 2);
                        const dataBlob = new Blob([dataStr], { type: 'application/json' });
                        const url = URL.createObjectURL(dataBlob);
                        
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = \`blocked-words-\${new Date().toISOString().split('T')[0]}.json\`;
                        link.click();
                        
                        URL.revokeObjectURL(url);
                        
                        if (window.dashboardAPI) {
                            if (window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Blocked words exported', 'success');
                            }
                            if (window.dashboardAPI.addLogEntry) {
                                window.dashboardAPI.addLogEntry('info', 'Blocked words exported to file');
                            }
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!filterResult) return;
                        
                        filterResult.textContent = message;
                        filterResult.className = \`result-message \${type}\`;
                        filterResult.style.display = 'block';
                        
                        // Hide after 5 seconds
                        setTimeout(() => {
                            filterResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Listen for dashboard server changes
                    if (window.dashboardAPI) {
                        // Store original function if it exists
                        const originalHandleServerChange = window.dashboardAPI.handleServerChange;
                        
                        // Override with our enhanced version
                        window.dashboardAPI.handleServerChange = function(serverId) {
                            // Call original function
                            if (originalHandleServerChange) {
                                originalHandleServerChange.call(this, serverId);
                            }
                            
                            // Update our plugin
                            currentServerId = serverId;
                            console.log('🚫 Word filter plugin: Server changed to', serverId);
                            
                            if (serverId) {
                                loadServerData();
                                updateServerDisplay();
                            }
                        };
                    }
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeWordFilterPlugin);
                    } else {
                        initializeWordFilterPlugin();
                    }
                    
                    console.log('✅ Enhanced Word Filter Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = WordFilterPlugin;
                    