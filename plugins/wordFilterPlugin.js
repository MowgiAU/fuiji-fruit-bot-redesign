const fs = require('fs');
const path = require('path');

class WordFilterPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Word Filter';
        this.description = 'Automatically detect and filter inappropriate words from messages';
        this.version = '1.1.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // Storage for filter settings per server
        this.filterSettings = this.loadFilterSettings();
        
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
                    repostCensored: true,  // NEW: Option to repost censored messages
                    dmUser: true           // NEW: Option to DM users
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
                const { enabled, logChannelId, blockedWords, repostCensored, dmUser } = req.body;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                this.filterSettings[serverId] = {
                    enabled: enabled || false,
                    logChannelId: logChannelId || null,
                    blockedWords: blockedWords || [],
                    repostCensored: repostCensored !== false, // Default to true
                    dmUser: dmUser !== false                   // Default to true
                };
                
                this.saveFilterSettings();
                res.json({ success: true, message: 'Filter settings updated successfully' });
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
                
                if (!word || !word.trim()) {
                    return res.status(400).json({ error: 'Word is required' });
                }
                
                const normalizedWord = word.trim().toLowerCase();
                
                if (!this.filterSettings[serverId]) {
                    this.filterSettings[serverId] = {
                        enabled: false,
                        logChannelId: null,
                        blockedWords: [],
                        repostCensored: true,
                        dmUser: true
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
    }

    setupMessageListener() {
        this.client.on('messageCreate', async (message) => {
            // Ignore bot messages
            if (message.author.bot) return;
            
            // Ignore DMs
            if (!message.guild) return;
            
            const serverId = message.guild.id;
            const settings = this.filterSettings[serverId];
            
            // Check if filter is enabled for this server
            if (!settings || !settings.enabled || !settings.blockedWords.length) return;
            
            // Check for blocked words
            const detectedWords = this.detectBlockedWords(message.content, settings.blockedWords);
            if (detectedWords.length === 0) return;
            
            try {
                // Store original message data before deletion
                const originalData = {
                    content: message.content,
                    author: {
                        username: message.author.username,
                        displayName: message.author.displayName || message.author.username,
                        avatarURL: message.author.displayAvatarURL({ dynamic: true, size: 128 }),
                        id: message.author.id
                    },
                    attachments: Array.from(message.attachments.values()),
                    embeds: message.embeds,
                    timestamp: message.createdAt,
                    reference: message.reference // For reply context
                };

                // Delete the original message
                await message.delete();
                
                // Create censored content
                let censoredContent = this.censorContent(originalData.content, detectedWords);
                
                // Repost the censored message if enabled
                if (settings.repostCensored !== false) {
                    await this.repostCensoredMessage(message.channel, originalData, censoredContent, detectedWords);
                }
                
                // Send DM to user if enabled
                if (settings.dmUser !== false) {
                    await this.sendUserDM(message.author, detectedWords, message.channel, message.guild);
                }
                
                // Log to channel if configured
                if (settings.logChannelId) {
                    await this.logFilteredMessage(settings.logChannelId, originalData, detectedWords, message.channel, message.guild);
                }
                
            } catch (error) {
                console.error('Error processing filtered message:', error);
            }
        });
    }

    async repostCensoredMessage(channel, originalData, censoredContent, detectedWords) {
        try {
            // Create or get webhook for this channel
            const webhook = await this.getChannelWebhook(channel);
            
            if (!webhook) {
                // Fallback: post as bot with embed showing original author
                const embed = {
                    color: 0xffa500,
                    author: {
                        name: `${originalData.author.displayName} (message filtered)`,
                        icon_url: originalData.author.avatarURL
                    },
                    description: censoredContent || '*No text content*',
                    footer: {
                        text: `🚫 Filtered: ${detectedWords.join(', ')}`
                    },
                    timestamp: originalData.timestamp.toISOString()
                };

                const messageOptions = { embeds: [embed] };

                // Handle attachments
                if (originalData.attachments.length > 0) {
                    const attachmentsList = originalData.attachments
                        .map(att => `📎 ${att.name} (${this.formatFileSize(att.size)})`)
                        .join('\n');
                    
                    embed.fields = [{
                        name: 'Attachments',
                        value: attachmentsList,
                        inline: false
                    }];
                }

                return await channel.send(messageOptions);
            } else {
                // Use webhook to post as original user
                const webhookOptions = {
                    username: originalData.author.displayName,
                    avatarURL: originalData.author.avatarURL,
                    content: censoredContent || undefined
                };

                // Handle attachments (note: webhooks can't repost original attachments)
                if (originalData.attachments.length > 0) {
                    const attachmentsList = originalData.attachments
                        .map(att => `📎 ${att.name}`)
                        .join(' ');
                    
                    webhookOptions.content = (webhookOptions.content || '') + `\n\n*[Original attachments: ${attachmentsList}]*`;
                }

                // Add filter notice
                webhookOptions.content = (webhookOptions.content || '') + `\n\n*🥭*`;

                return await webhook.send(webhookOptions);
            }
        } catch (error) {
            console.error('Error reposting censored message:', error);
        }
    }

    async getChannelWebhook(channel) {
        try {
            // Check if bot has permission to manage webhooks
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
            // User might have DMs disabled, which is fine
        }
    }

    async logFilteredMessage(logChannelId, originalData, detectedWords, channel, guild) {
        try {
            const logChannel = this.client.channels.cache.get(logChannelId);
            if (!logChannel) return;

            const embed = {
                color: 0xff0000,
                title: '🚫 Word Filter Alert',
                fields: [
                    { 
                        name: 'User', 
                        value: `${originalData.author.displayName} (${originalData.author.id})`, 
                        inline: true 
                    },
                    { 
                        name: 'Channel', 
                        value: `#${channel.name}`, 
                        inline: true 
                    },
                    { 
                        name: 'Detected Words', 
                        value: detectedWords.join(', '), 
                        inline: false 
                    },
                    { 
                        name: 'Original Message', 
                        value: originalData.content.substring(0, 1024) || '*No text content*', 
                        inline: false 
                    }
                ],
                timestamp: new Date().toISOString()
            };

            // Add attachment info if any
            if (originalData.attachments.length > 0) {
                const attachmentInfo = originalData.attachments
                    .map(att => `${att.name} (${this.formatFileSize(att.size)})`)
                    .join('\n');
                
                embed.fields.push({
                    name: 'Attachments',
                    value: attachmentInfo,
                    inline: false
                });
            }
            
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging filtered message:', error);
        }
    }

    censorContent(content, detectedWords) {
        if (!content) return content;
        
        let censoredContent = this.sanitizeMentions(content);
        
        detectedWords.forEach(word => {
            // Use word boundaries to avoid over-censoring
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            censoredContent = censoredContent.replace(regex, '❌');
        });
        
        return censoredContent;
    }

    sanitizeMentions(content) {
        if (!content) return content;
        
        // Replace @everyone and @here with sanitized versions
        return content
            .replace(/@everyone/g, '@​everyone') // Add zero-width space
            .replace(/@here/g, '@​here')       // Add zero-width space
            .replace(/(?<!<)@(?!\u200B)/g, '@​'); // Add zero-width space after @ if not already present
    }

    detectBlockedWords(content, blockedWords) {
        if (!content) return [];
        
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

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    getFrontendComponent() {
        return {
            // Plugin identification
            id: 'wordfilter-plugin',
            name: 'Word Filter',
            description: 'Automatically detect and filter inappropriate words from messages',
            icon: '🚫',
            version: '1.1.0',
            
            // NEW: Plugin defines its own targets (no more dashboard hardcoding!)
            containerId: 'wordFilterPluginContainer',  // Where to inject HTML
            pageId: 'word-filter',                     // Page ID for navigation
            navIcon: '🚫',                            // Icon for navigation
            
            // Complete HTML and script
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🚫</span> Word Filter</h3>
                        <p>Automatically detect and filter inappropriate words from messages</p>
                    </div>
                    
                    <form id="wordFilterForm">
                        <div class="form-group">
                            <label for="filterServerSelect">Server</label>
                            <select id="filterServerSelect" required>
                                <option value="">Select a server...</option>
                            </select>
                        </div>
                        
                        <div id="filterSettings" style="display: none;">
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="filterEnabled" style="margin-right: 8px;">
                                    Enable Word Filter
                                </label>
                            </div>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="repostCensored" style="margin-right: 8px;" checked>
                                    Repost Censored Messages
                                </label>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Repost the message with blocked words censored instead of just deleting
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="dmUser" style="margin-right: 8px;" checked>
                                    Send DM Notifications
                                </label>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Send a DM to users when their messages are filtered
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="logChannelSelect">Log Channel (Optional)</label>
                                <select id="logChannelSelect">
                                    <option value="">Select a channel for logs...</option>
                                </select>
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    Choose where filtered message logs will be sent
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="newWord">Add Blocked Word</label>
                                <div style="display: flex; gap: 10px;">
                                    <input type="text" id="newWord" placeholder="Enter word to block...">
                                    <button type="button" id="addWordBtn" style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">Add Word</button>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Blocked Words</label>
                                <div id="blockedWordsList" style="min-height: 100px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;">
                                    <div id="noWordsMessage" style="opacity: 0.6; text-align: center; padding: 20px;">
                                        No blocked words configured
                                    </div>
                                </div>
                            </div>
                            
                            <button type="button" id="saveFilterSettings" class="btn-primary">
                                <span class="btn-text">Save Settings</span>
                                <span class="btn-loader" style="display: none;">Saving...</span>
                            </button>
                        </div>
                    </form>
                </div>
            `,
            script: `
                // Word Filter Plugin Frontend Logic
                (function() {
                    const filterServerSelect = document.getElementById('filterServerSelect');
                    const logChannelSelect = document.getElementById('logChannelSelect');
                    const filterSettings = document.getElementById('filterSettings');
                    const filterEnabled = document.getElementById('filterEnabled');
                    const repostCensored = document.getElementById('repostCensored');
                    const dmUser = document.getElementById('dmUser');
                    const newWord = document.getElementById('newWord');
                    const addWordBtn = document.getElementById('addWordBtn');
                    const blockedWordsList = document.getElementById('blockedWordsList');
                    const noWordsMessage = document.getElementById('noWordsMessage');
                    const saveFilterSettings = document.getElementById('saveFilterSettings');
                    const btnText = saveFilterSettings ? saveFilterSettings.querySelector('.btn-text') : null;
                    const btnLoader = saveFilterSettings ? saveFilterSettings.querySelector('.btn-loader') : null;
                    
                    let currentServerId = null;
                    let currentSettings = null;
                    
                    // Initialize if elements exist
                    if (filterServerSelect) {
                        filterServerSelect.addEventListener('change', function() {
                            const serverId = this.value;
                            if (serverId) {
                                currentServerId = serverId;
                                loadFilterChannels(serverId);
                                loadFilterSettings(serverId);
                                if (filterSettings) filterSettings.style.display = 'block';
                            } else {
                                if (filterSettings) filterSettings.style.display = 'none';
                            }
                        });
                        loadFilterServers();
                    }
                    
                    if (addWordBtn) {
                        addWordBtn.addEventListener('click', addBlockedWord);
                    }
                    
                    if (newWord) {
                        newWord.addEventListener('keypress', function(e) {
                            if (e.key === 'Enter') {
                                addBlockedWord();
                            }
                        });
                    }
                    
                    if (saveFilterSettings) {
                        saveFilterSettings.addEventListener('click', saveFilterSettings_internal);
                    }
                    
                    async function loadFilterServers() {
                        try {
                            const response = await fetch('/api/servers');
                            const servers = await response.json();
                            
                            if (filterServerSelect) {
                                filterServerSelect.innerHTML = '<option value="">Select a server...</option>';
                                servers.forEach(server => {
                                    const option = document.createElement('option');
                                    option.value = server.id;
                                    option.textContent = server.name;
                                    filterServerSelect.appendChild(option);
                                });
                            }
                        } catch (error) {
                            console.error('Error loading servers:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading servers', 'error');
                            }
                        }
                    }
                    
                    async function loadFilterChannels(serverId) {
                        try {
                            if (logChannelSelect) {
                                logChannelSelect.innerHTML = '<option value="">Loading...</option>';
                                const response = await fetch(\`/api/channels/\${serverId}\`);
                                const channels = await response.json();
                                
                                logChannelSelect.innerHTML = '<option value="">Select a channel for logs...</option>';
                                channels.forEach(channel => {
                                    const option = document.createElement('option');
                                    option.value = channel.id;
                                    option.textContent = \`# \${channel.name}\`;
                                    logChannelSelect.appendChild(option);
                                });
                            }
                        } catch (error) {
                            console.error('Error loading channels:', error);
                            if (logChannelSelect) {
                                logChannelSelect.innerHTML = '<option value="">Error loading channels</option>';
                            }
                        }
                    }
                    
                    async function loadFilterSettings(serverId) {
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/settings/\${serverId}\`);
                            const settings = await response.json();
                            
                            currentSettings = settings;
                            
                            if (filterEnabled) filterEnabled.checked = settings.enabled;
                            if (repostCensored) repostCensored.checked = settings.repostCensored !== false;
                            if (dmUser) dmUser.checked = settings.dmUser !== false;
                            if (settings.logChannelId && logChannelSelect) {
                                logChannelSelect.value = settings.logChannelId;
                            }
                            
                            displayBlockedWords(settings.blockedWords || []);
                        } catch (error) {
                            console.error('Error loading filter settings:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading filter settings', 'error');
                            }
                        }
                    }
                    
                    function displayBlockedWords(words) {
                        if (!blockedWordsList) return;
                        
                        if (words.length === 0) {
                            blockedWordsList.innerHTML = '<div style="opacity: 0.6; text-align: center; padding: 20px;">No blocked words configured</div>';
                            return;
                        }
                        
                        blockedWordsList.innerHTML = '';
                        words.forEach(word => {
                            const wordElement = document.createElement('div');
                            wordElement.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 4px; background: rgba(255,255,255,0.1); border-radius: 6px;';
                            wordElement.innerHTML = \`
                                <span style="font-family: monospace;">\${word}</span>
                                <button type="button" onclick="window.removeFilterWord('\${word}')" style="padding: 2px 8px; background: rgba(255,0,0,0.3); border: none; border-radius: 4px; color: white; cursor: pointer;">Remove</button>
                            \`;
                            blockedWordsList.appendChild(wordElement);
                        });
                    }
                    
                    async function addBlockedWord() {
                        const word = newWord ? newWord.value.trim() : '';
                        if (!word || !currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please enter a word and select a server', 'error');
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
                                if (newWord) newWord.value = '';
                                displayBlockedWords(result.blockedWords);
                                currentSettings.blockedWords = result.blockedWords;
                                if (window.showNotification) {
                                    window.showNotification('Word added successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to add word');
                            }
                        } catch (error) {
                            console.error('Error adding word:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        }
                    }
                    
                    // Global function for removing words (called from HTML)
                    window.removeFilterWord = async function(word) {
                        if (!currentServerId) return;
                        
                        try {
                            const response = await fetch(\`/api/plugins/wordfilter/words/\${currentServerId}/\${encodeURIComponent(word)}\`, {
                                method: 'DELETE'
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                displayBlockedWords(result.blockedWords);
                                currentSettings.blockedWords = result.blockedWords;
                                if (window.showNotification) {
                                    window.showNotification('Word removed successfully', 'success');
                                }
                            } else {
                                throw new Error(result.error || 'Failed to remove word');
                            }
                        } catch (error) {
                            console.error('Error removing word:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        }
                    };
                    
                    async function saveFilterSettings_internal() {
                        if (!currentServerId) {
                            if (window.showNotification) {
                                window.showNotification('Please select a server first', 'error');
                            }
                            return;
                        }
                        
                        try {
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (saveFilterSettings) saveFilterSettings.disabled = true;
                            
                            const settings = {
                                enabled: filterEnabled ? filterEnabled.checked : false,
                                repostCensored: repostCensored ? repostCensored.checked : true,
                                dmUser: dmUser ? dmUser.checked : true,
                                logChannelId: logChannelSelect ? logChannelSelect.value || null : null,
                                blockedWords: currentSettings?.blockedWords || []
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
                                if (window.showNotification) {
                                    window.showNotification('Filter settings saved successfully!', 'success');
                                }
                                currentSettings = { ...currentSettings, ...settings };
                            } else {
                                throw new Error(result.error || 'Failed to save settings');
                            }
                        } catch (error) {
                            console.error('Error saving settings:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        } finally {
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (saveFilterSettings) saveFilterSettings.disabled = false;
                        }
                    }
                })();
            `
        };
    }
}

module.exports = WordFilterPlugin;