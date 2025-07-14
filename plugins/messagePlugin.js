const multer = require('multer');
const fs = require('fs');
const path = require('path');

class MessagePlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Message Sender';
        this.description = 'Send messages to Discord channels with optional attachments, replies, emojis, and stickers';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        this.setupRoutes();
    }

    setupRoutes() {
        // File upload configuration
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

        // API endpoint for fetching server emojis and stickers
        this.app.get('/api/plugins/message/emojis/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const guild = this.client.guilds.cache.get(serverId);
                if (!guild) {
                    return res.status(404).json({ error: 'Server not found' });
                }
                
                // Get custom emojis
                const emojis = guild.emojis.cache.map(emoji => ({
                    id: emoji.id,
                    name: emoji.name,
                    url: emoji.url,
                    animated: emoji.animated,
                    usage: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
                }));
                
                // Get stickers
                const stickers = guild.stickers.cache.map(sticker => ({
                    id: sticker.id,
                    name: sticker.name,
                    description: sticker.description,
                    url: sticker.url,
                    format: sticker.format
                }));
                
                res.json({
                    emojis: emojis,
                    stickers: stickers
                });
            } catch (error) {
                console.error('Error fetching emojis and stickers:', error);
                res.status(500).json({ error: 'Failed to fetch emojis and stickers' });
            }
        });

        // API endpoint for fetching message details (for replies)
        this.app.get('/api/plugins/message/:channelId/:messageId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { channelId, messageId } = req.params;
                
                const channel = this.client.channels.cache.get(channelId);
                if (!channel) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                const hasAdmin = await this.hasAdminPermissions(req.user.id, channel.guild.id);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }

                const message = await channel.messages.fetch(messageId);
                if (!message) {
                    return res.status(404).json({ error: 'Message not found' });
                }

                res.json({
                    id: message.id,
                    content: message.content,
                    author: {
                        username: message.author.username,
                        displayName: message.author.displayName,
                        avatar: message.author.displayAvatarURL()
                    },
                    createdAt: message.createdAt.toISOString(),
                    channelName: channel.name,
                    guildName: channel.guild.name
                });
            } catch (error) {
                console.error('Error fetching message:', error);
                if (error.code === 10008) {
                    return res.status(404).json({ error: 'Message not found' });
                }
                res.status(500).json({ error: 'Failed to fetch message' });
            }
        });

        // API endpoint for sending messages
        this.app.post('/api/plugins/message/send', this.ensureAuthenticated, upload.array('attachments'), async (req, res) => {
            try {
                const { serverId, channelId, message, replyToMessageId, stickerId } = req.body;
                const files = req.files;
                
                // Check admin permissions
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                // Get the channel
                const channel = this.client.channels.cache.get(channelId);
                if (!channel) {
                    return res.status(404).json({ error: 'Channel not found' });
                }
                
                // Prepare message options
                const messageOptions = {};
                
                if (message && message.trim()) {
                    messageOptions.content = message;
                }
                
                if (files && files.length > 0) {
                    messageOptions.files = files.map(file => ({
                        attachment: file.path,
                        name: file.originalname
                    }));
                }
                
                // Add sticker if provided
                if (stickerId) {
                    messageOptions.stickers = [stickerId];
                }
                
                // Must have either message, attachments, or sticker
                if (!messageOptions.content && !messageOptions.files && !messageOptions.stickers) {
                    return res.status(400).json({ error: 'Message, attachments, or sticker required' });
                }

                // Handle reply functionality
                if (replyToMessageId) {
                    try {
                        const originalMessage = await channel.messages.fetch(replyToMessageId);
                        messageOptions.reply = {
                            messageReference: originalMessage,
                            failIfNotExists: false
                        };
                    } catch (error) {
                        console.error('Error fetching original message for reply:', error);
                        // Continue without reply if original message not found
                    }
                }
                
                // Send the message
                await channel.send(messageOptions);
                
                // Clean up uploaded files
                if (files) {
                    files.forEach(file => {
                        fs.unlink(file.path, (err) => {
                            if (err) console.error('Error deleting file:', err);
                        });
                    });
                }
                
                res.json({ success: true, message: 'Message sent successfully' });
            } catch (error) {
                console.error('Error sending message:', error);
                res.status(500).json({ error: 'Failed to send message' });
            }
        });
    }

    getFrontendComponent() {
        return {
            id: 'message-plugin',
            name: 'Message Sender',
            description: 'Send messages to Discord channels with optional attachments, replies, emojis, and stickers',
            icon: '💬',
            version: '1.0.0',
            containerId: 'messagePluginContainer',
            pageId: 'message-sender',
            navIcon: '💬',
            
            // --- CORRECTED HTML STRUCTURE ---
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">💬</span> Message Sender</h3>
                        <p>Send messages to your Discord channels with optional attachments, replies, emojis, and stickers</p>
                    </div>
                    
                    <form id="messageForm" enctype="multipart/form-data">
                        <div class="form-group">
                            <label for="serverSelect">Server</label>
                            <select id="serverSelect" required>
                                <option value="">Select a server...</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="channelSelect">Channel</label>
                            <input type="text" id="messageChannelSearch" class="form-control" placeholder="🔍 Search channels..." style="margin-bottom: 10px; display: none;">
                            <select id="channelSelect" required disabled>
                                <option value="">Select a channel...</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="replyMessageId">Reply to Message (Optional)</label>
                            <div style="display: flex; gap: 10px;">
                                <input type="text" id="replyMessageId" placeholder="Enter message ID to reply to...">
                                <button type="button" id="fetchMessageBtn" disabled style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">Fetch</button>
                            </div>
                            <div id="originalMessagePreview" style="display: none; margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; border-left: 4px solid #7289da;">
                                <div id="originalMessageContent"></div>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="messageText">Message</label>
                            <textarea id="messageText" placeholder="Type your message here..." rows="4"></textarea>
                            <div style="display: flex; gap: 10px; margin-top: 10px;">
                                <button type="button" id="emojiBtn" disabled style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">😀 Emojis</button>
                                <button type="button" id="stickerBtn" disabled style="padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">🎭 Stickers</button>
                            </div>
                            <div id="emojiPicker" style="display: none; margin-top: 10px; max-height: 300px; overflow-y: auto; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 10px;">
                                <div id="emojiGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 5px;"></div>
                            </div>
                            <div id="stickerPicker" style="display: none; margin-top: 10px; max-height: 300px; overflow-y: auto; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 10px;">
                                <div id="stickerGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 10px;"></div>
                                <div id="selectedSticker" style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; display: none;">
                                    <strong>Selected Sticker:</strong> <span id="selectedStickerName"></span>
                                    <button type="button" id="clearStickerBtn" style="margin-left: 10px; padding: 2px 8px; background: rgba(255,0,0,0.3); border: none; border-radius: 4px; color: white; cursor: pointer;">Clear</button>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="attachments">Attachments</label>
                            <input type="file" id="attachments" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx">
                            <div id="attachmentPreview" class="attachment-preview"></div>
                        </div>
                        
                        <button type="submit" class="btn-primary" disabled>
                            <span class="btn-text">Send Message</span>
                            <span class="btn-loader" style="display: none;">Sending...</span>
                        </button>
                    </form>
                </div>
            `,

            // --- CORRECTED SCRIPT ---
            script: `
                // Message Plugin Frontend Logic
                (function() {
                    const serverSelect = document.getElementById('serverSelect');
                    const channelSelect = document.getElementById('channelSelect');
                    const messageForm = document.getElementById('messageForm');
                    const messageText = document.getElementById('messageText');
                    const attachments = document.getElementById('attachments');
                    const attachmentPreview = document.getElementById('attachmentPreview');
                    const replyMessageId = document.getElementById('replyMessageId');
                    const fetchMessageBtn = document.getElementById('fetchMessageBtn');
                    const originalMessagePreview = document.getElementById('originalMessagePreview');
                    const originalMessageContent = document.getElementById('originalMessageContent');
                    const emojiBtn = document.getElementById('emojiBtn');
                    const stickerBtn = document.getElementById('stickerBtn');
                    const emojiPicker = document.getElementById('emojiPicker');
                    const stickerPicker = document.getElementById('stickerPicker');
                    const emojiGrid = document.getElementById('emojiGrid');
                    const stickerGrid = document.getElementById('stickerGrid');
                    const selectedSticker = document.getElementById('selectedSticker');
                    const selectedStickerName = document.getElementById('selectedStickerName');
                    const clearStickerBtn = document.getElementById('clearStickerBtn');
                    const submitBtn = messageForm ? messageForm.querySelector('button[type="submit"]') : null;
                    const btnText = submitBtn ? submitBtn.querySelector('.btn-text') : null;
                    const btnLoader = submitBtn ? submitBtn.querySelector('.btn-loader') : null;
                    
                    let currentReplyMessageId = null;
                    let currentStickerId = null;
                    let serverEmojis = [];
                    let serverStickers = [];
                    
                    if (serverSelect) {
                        loadMessageServers();
                        serverSelect.addEventListener('change', function() {
                            const serverId = this.value;
                            if (serverId) {
                                loadMessageChannels(serverId);
                                loadEmojisAndStickers(serverId);
                                channelSelect.disabled = false;
                                if (emojiBtn) emojiBtn.disabled = false;
                                if (stickerBtn) stickerBtn.disabled = false;
                            } else {
                                channelSelect.disabled = true;
                                channelSelect.innerHTML = '<option value="">Select a channel...</option>';
                                if (emojiBtn) emojiBtn.disabled = true;
                                if (stickerBtn) stickerBtn.disabled = true;
                                if (emojiPicker) emojiPicker.style.display = 'none';
                                if (stickerPicker) stickerPicker.style.display = 'none';
                            }
                            updateFetchButton();
                            updateSubmitButton();
                        });
                    }
                    
                    if (channelSelect) {
                        channelSelect.addEventListener('change', function() {
                            updateFetchButton();
                            updateSubmitButton();
                            clearReplyPreview();
                        });
                    }
                    
                    if (replyMessageId) {
                        replyMessageId.addEventListener('input', function() {
                            updateFetchButton();
                            clearReplyPreview();
                        });
                    }
                    
                    if (fetchMessageBtn) {
                        fetchMessageBtn.addEventListener('click', async function() {
                            await fetchOriginalMessage();
                        });
                    }
                    
                    if (emojiBtn) {
                        emojiBtn.addEventListener('click', function() {
                            if (emojiPicker.style.display === 'none') {
                                emojiPicker.style.display = 'block';
                                if (stickerPicker) stickerPicker.style.display = 'none';
                            } else {
                                emojiPicker.style.display = 'none';
                            }
                        });
                    }
                    
                    if (stickerBtn) {
                        stickerBtn.addEventListener('click', function() {
                            if (stickerPicker.style.display === 'none') {
                                stickerPicker.style.display = 'block';
                                if (emojiPicker) emojiPicker.style.display = 'none';
                            } else {
                                stickerPicker.style.display = 'none';
                            }
                        });
                    }
                    
                    if (clearStickerBtn) {
                        clearStickerBtn.addEventListener('click', function() {
                            currentStickerId = null;
                            selectedSticker.style.display = 'none';
                            updateSubmitButton();
                        });
                    }
                    
                    if (messageText) {
                        messageText.addEventListener('input', updateSubmitButton);
                    }
                    
                    if (attachments) {
                        attachments.addEventListener('change', function() {
                            updateAttachmentPreview();
                            updateSubmitButton();
                        });
                    }
                    
                    if (messageForm) {
                        messageForm.addEventListener('submit', async function(e) {
                            e.preventDefault();
                            await sendMessage();
                        });
                    }
                    
                    async function loadMessageServers() {
                        try {
                            const response = await fetch('/api/servers');
                            const servers = await response.json();
                            
                            serverSelect.innerHTML = '<option value="">Select a server...</option>';
                            servers.forEach(server => {
                                const option = document.createElement('option');
                                option.value = server.id;
                                option.textContent = server.name;
                                serverSelect.appendChild(option);
                            });
                        } catch (error) {
                            console.error('Error loading servers:', error);
                            if (window.showNotification) {
                                window.showNotification('Error loading servers', 'error');
                            }
                        }
                    }
                    
                    async function loadMessageChannels(serverId) {
                        const searchInput = document.getElementById('messageChannelSearch');
                        try {
                            channelSelect.innerHTML = '<option value="">Loading...</option>';
                            if (searchInput) searchInput.style.display = 'none';

                            const response = await fetch(\`/api/channels/\${serverId}\`);
                            const channels = await response.json();
                            
                            channelSelect.innerHTML = '<option value="">Select a channel...</option>';
                            channels.forEach(channel => {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`# \${channel.name}\`;
                                channelSelect.appendChild(option);
                            });

                            if (searchInput) searchInput.style.display = 'block';
                            window.setupChannelSearch('messageChannelSearch', 'channelSelect');

                        } catch (error) {
                            console.error('Error loading channels:', error);
                            channelSelect.innerHTML = '<option value="">Error loading channels</option>';
                            if (searchInput) searchInput.style.display = 'none';
                        }
                    }
                    
                    async function loadEmojisAndStickers(serverId) {
                        try {
                            const response = await fetch(\`/api/plugins/message/emojis/\${serverId}\`);
                            const data = await response.json();
                            
                            if (response.ok) {
                                serverEmojis = data.emojis;
                                serverStickers = data.stickers;
                                displayEmojis();
                                displayStickers();
                            } else {
                                console.error('Error loading emojis and stickers:', data.error);
                            }
                        } catch (error) {
                            console.error('Error loading emojis and stickers:', error);
                        }
                    }
                    
                    function displayEmojis() {
                        if (!emojiGrid) return;
                        
                        emojiGrid.innerHTML = '';
                        serverEmojis.forEach(emoji => {
                            const emojiElement = document.createElement('div');
                            emojiElement.style.cssText = 'cursor: pointer; padding: 5px; border-radius: 4px; text-align: center; transition: background 0.2s;';
                            emojiElement.innerHTML = \`<img src="\${emoji.url}" alt="\${emoji.name}" title="\${emoji.name}" style="width: 32px; height: 32px;">\`;
                            
                            emojiElement.addEventListener('click', function() {
                                insertEmoji(emoji.usage);
                            });
                            
                            emojiElement.addEventListener('mouseenter', function() {
                                this.style.background = 'rgba(255,255,255,0.1)';
                            });
                            
                            emojiElement.addEventListener('mouseleave', function() {
                                this.style.background = 'transparent';
                            });
                            
                            emojiGrid.appendChild(emojiElement);
                        });
                    }
                    
                    function displayStickers() {
                        if (!stickerGrid) return;
                        
                        stickerGrid.innerHTML = '';
                        serverStickers.forEach(sticker => {
                            const stickerElement = document.createElement('div');
                            stickerElement.style.cssText = 'cursor: pointer; padding: 5px; border-radius: 4px; text-align: center; transition: background 0.2s;';
                            stickerElement.innerHTML = \`<img src="\${sticker.url}" alt="\${sticker.name}" title="\${sticker.name}" style="width: 50px; height: 50px; object-fit: contain;">\`;
                            
                            stickerElement.addEventListener('click', function() {
                                selectSticker(sticker);
                            });
                            
                            stickerElement.addEventListener('mouseenter', function() {
                                this.style.background = 'rgba(255,255,255,0.1)';
                            });
                            
                            stickerElement.addEventListener('mouseleave', function() {
                                this.style.background = 'transparent';
                            });
                            
                            stickerGrid.appendChild(stickerElement);
                        });
                    }
                    
                    function insertEmoji(emojiUsage) {
                        if (!messageText) return;
                        
                        const currentText = messageText.value;
                        const cursorPos = messageText.selectionStart;
                        const newText = currentText.slice(0, cursorPos) + emojiUsage + ' ' + currentText.slice(cursorPos);
                        
                        messageText.value = newText;
                        messageText.focus();
                        messageText.setSelectionRange(cursorPos + emojiUsage.length + 1, cursorPos + emojiUsage.length + 1);
                        updateSubmitButton();
                    }
                    
                    function selectSticker(sticker) {
                        currentStickerId = sticker.id;
                        if (selectedStickerName) selectedStickerName.textContent = sticker.name;
                        if (selectedSticker) selectedSticker.style.display = 'block';
                        if (stickerPicker) stickerPicker.style.display = 'none';
                        updateSubmitButton();
                    }
                    
                    async function fetchOriginalMessage() {
                        const channelId = channelSelect ? channelSelect.value : '';
                        const messageId = replyMessageId ? replyMessageId.value.trim() : '';
                        
                        if (!channelId || !messageId) return;
                        
                        try {
                            if (fetchMessageBtn) {
                                fetchMessageBtn.textContent = 'Fetching...';
                                fetchMessageBtn.disabled = true;
                            }
                            
                            const response = await fetch(\`/api/plugins/message/\${channelId}/\${messageId}\`);
                            const messageData = await response.json();
                            
                            if (response.ok) {
                                currentReplyMessageId = messageId;
                                displayOriginalMessage(messageData);
                                updateSubmitButton();
                            } else {
                                throw new Error(messageData.error || 'Failed to fetch message');
                            }
                        } catch (error) {
                            console.error('Error fetching message:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                            clearReplyPreview();
                        } finally {
                            if (fetchMessageBtn) {
                                fetchMessageBtn.textContent = 'Fetch';
                                updateFetchButton();
                            }
                        }
                    }
                    
                    function displayOriginalMessage(messageData) {
                        if (!originalMessageContent) return;
                        
                        const createdAt = new Date(messageData.createdAt).toLocaleString();
                        originalMessageContent.innerHTML = \`
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <img src="\${messageData.author.avatar}" alt="Avatar" style="width: 20px; height: 20px; border-radius: 50%;">
                                <strong>\${messageData.author.username}</strong>
                                <span style="opacity: 0.7; font-size: 0.9em;">\${createdAt}</span>
                            </div>
                            <div style="margin-left: 28px;">
                                \${messageData.content || '<em>No text content</em>'}
                            </div>
                            <div style="margin-left: 28px; margin-top: 4px; opacity: 0.7; font-size: 0.9em;">
                                in #\${messageData.channelName} • \${messageData.guildName}
                            </div>
                        \`;
                        if (originalMessagePreview) originalMessagePreview.style.display = 'block';
                    }
                    
                    function clearReplyPreview() {
                        currentReplyMessageId = null;
                        if (originalMessagePreview) originalMessagePreview.style.display = 'none';
                        updateSubmitButton();
                    }
                    
                    function updateFetchButton() {
                        if (!fetchMessageBtn) return;
                        
                        const hasChannel = channelSelect ? channelSelect.value : false;
                        const hasMessageId = replyMessageId ? replyMessageId.value.trim() : false;
                        fetchMessageBtn.disabled = !hasChannel || !hasMessageId;
                    }
                    
                    function updateAttachmentPreview() {
                        if (!attachmentPreview || !attachments) return;
                        
                        const files = Array.from(attachments.files);
                        attachmentPreview.innerHTML = '';
                        
                        if (files.length > 0) {
                            files.forEach((file, index) => {
                                const fileDiv = document.createElement('div');
                                fileDiv.className = 'attachment-item';
                                fileDiv.innerHTML = \`
                                    <span class="attachment-name">\${file.name}</span>
                                    <span class="attachment-size">(\${formatFileSize(file.size)})</span>
                                \`;
                                attachmentPreview.appendChild(fileDiv);
                            });
                        }
                    }
                    
                    function updateSubmitButton() {
                        if (!submitBtn) return;
                        
                        const hasServer = serverSelect ? serverSelect.value : false;
                        const hasChannel = channelSelect ? channelSelect.value : false;
                        const hasMessage = messageText ? messageText.value.trim() : false;
                        const hasAttachments = attachments ? attachments.files.length > 0 : false;
                        const hasSticker = currentStickerId;
                        
                        const canSubmit = hasServer && hasChannel && (hasMessage || hasAttachments || hasSticker);
                        submitBtn.disabled = !canSubmit;
                    }
                    
                    async function sendMessage() {
                        if (!serverSelect || !channelSelect) return;
                        
                        const formData = new FormData();
                        formData.append('serverId', serverSelect.value);
                        formData.append('channelId', channelSelect.value);
                        formData.append('message', messageText ? messageText.value : '');
                        
                        if (currentReplyMessageId) {
                            formData.append('replyToMessageId', currentReplyMessageId);
                        }
                        
                        if (currentStickerId) {
                            formData.append('stickerId', currentStickerId);
                        }
                        
                        if (attachments) {
                            Array.from(attachments.files).forEach(file => {
                                formData.append('attachments', file);
                            });
                        }
                        
                        try {
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (submitBtn) submitBtn.disabled = true;
                            
                            const response = await fetch('/api/plugins/message/send', {
                                method: 'POST',
                                body: formData
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                let messageType = 'Message sent successfully!';
                                if (currentReplyMessageId && currentStickerId) {
                                    messageType = 'Reply with sticker sent successfully!';
                                } else if (currentReplyMessageId) {
                                    messageType = 'Reply sent successfully!';
                                } else if (currentStickerId) {
                                    messageType = 'Sticker sent successfully!';
                                }
                                
                                if (window.showNotification) {
                                    window.showNotification(messageType, 'success');
                                }
                                
                                // Clear form
                                if (messageText) messageText.value = '';
                                if (attachments) attachments.value = '';
                                if (replyMessageId) replyMessageId.value = '';
                                currentStickerId = null;
                                if (selectedSticker) selectedSticker.style.display = 'none';
                                updateAttachmentPreview();
                                clearReplyPreview();
                                updateSubmitButton();
                                updateFetchButton();
                            } else {
                                throw new Error(result.error || 'Failed to send message');
                            }
                        } catch (error) {
                            console.error('Error sending message:', error);
                            if (window.showNotification) {
                                window.showNotification(error.message, 'error');
                            }
                        } finally {
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            updateSubmitButton();
                        }
                    }
                    
                    function formatFileSize(bytes) {
                        if (bytes === 0) return '0 Bytes';
                        const k = 1024;
                        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                    }
                })();
            `
        };
    }
}

module.exports = MessagePlugin;
                                