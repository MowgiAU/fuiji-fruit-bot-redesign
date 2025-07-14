const multer = require('multer');
const fs = require('fs');
const path = require('path');

class MessagePlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Message Sender';
        this.description = 'Send messages to Discord channels with optional attachments, replies, emojis, and stickers';
        this.version = '1.1.0';
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
                
                res.json({ emojis, stickers });
            } catch (error) {
                console.error('Error fetching emojis/stickers:', error);
                res.status(500).json({ error: 'Failed to fetch emojis/stickers' });
            }
        });

        // API endpoint for fetching a specific message (for replies)
        this.app.get('/api/plugins/message/fetch/:channelId/:messageId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { channelId, messageId } = req.params;
                
                const channel = this.client.channels.cache.get(channelId);
                if (!channel) {
                    return res.status(404).json({ error: 'Channel not found' });
                }
                
                const message = await channel.messages.fetch(messageId);
                
                res.json({
                    id: message.id,
                    content: message.content,
                    author: {
                        username: message.author.username,
                        avatar: message.author.displayAvatarURL()
                    },
                    createdAt: message.createdAt.toISOString(),
                    channelName: channel.name,
                    guildName: message.guild?.name,
                    attachments: message.attachments.map(att => ({
                        name: att.name,
                        url: att.url,
                        size: att.size
                    }))
                });
            } catch (error) {
                console.error('Error fetching message:', error);
                if (error.code === 10008) {
                    return res.status(404).json({ error: 'Message not found' });
                }
                res.status(500).json({ error: 'Failed to fetch message' });
            }
        });

        // Enhanced API endpoint for sending messages with full functionality
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
                const sentMessage = await channel.send(messageOptions);
                
                // Clean up uploaded files
                if (files) {
                    files.forEach(file => {
                        fs.unlink(file.path, (err) => {
                            if (err) console.error('Error deleting file:', err);
                        });
                    });
                }
                
                res.json({ 
                    success: true, 
                    message: 'Message sent successfully',
                    messageId: sentMessage.id,
                    channelName: channel.name,
                    guildName: channel.guild?.name
                });
                
            } catch (error) {
                console.error('Error sending message:', error);
                
                // Clean up files on error
                if (req.files) {
                    req.files.forEach(file => {
                        fs.unlink(file.path, (err) => {
                            if (err) console.error('Error deleting file on error:', err);
                        });
                    });
                }
                
                res.status(500).json({ error: 'Failed to send message' });
            }
        });

        // Legacy endpoint for backwards compatibility (using the original route)
        this.app.post('/api/plugins/message', this.ensureAuthenticated, upload.array('attachments'), async (req, res) => {
            try {
                const { serverId, channelId, message, replyToMessageId, stickerId } = req.body;
                const files = req.files;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const channel = this.client.channels.cache.get(channelId);
                if (!channel) {
                    return res.status(404).json({ error: 'Channel not found' });
                }
                
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
                
                if (stickerId) {
                    messageOptions.stickers = [stickerId];
                }
                
                if (replyToMessageId) {
                    try {
                        const originalMessage = await channel.messages.fetch(replyToMessageId);
                        messageOptions.reply = {
                            messageReference: originalMessage,
                            failIfNotExists: false
                        };
                    } catch (error) {
                        console.error('Error fetching original message for reply:', error);
                    }
                }
                
                await channel.send(messageOptions);
                
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
            id: 'message-sender',
            name: 'Message Sender',
            description: 'Send messages to Discord channels with optional attachments, replies, emojis, and stickers',
            icon: '💬',
            version: '1.1.0',
            containerId: 'messagePluginContainer',
            pageId: 'message-sender',
            
            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">💬</span> Message Sender</h3>
                        <p>Send messages to your Discord channels with optional attachments, replies, emojis, and stickers</p>
                    </div>
                    
                    <!-- Server Selection with Dashboard Integration -->
                    <div class="server-sync-notice" style="background: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🔗</span>
                            <div>
                                <strong>Dashboard Integration</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Using server: <span id="currentServerName">Auto-detected</span></div>
                            </div>
                        </div>
                    </div>
                    
                    <form id="enhancedMessageForm" class="message-form" enctype="multipart/form-data">
                        <div class="form-group">
                            <label for="messageChannelSelect">Channel</label>
                            <select id="messageChannelSelect" class="form-control" required>
                                <option value="">Select a channel...</option>
                            </select>
                        </div>
                        
                        <!-- Reply Section -->
                        <div class="form-group">
                            <label for="replyMessageId">Reply to Message (Optional)</label>
                            <div style="display: flex; gap: 10px;">
                                <input type="text" id="replyMessageId" class="form-control" placeholder="Enter message ID to reply to...">
                                <button type="button" id="fetchMessageBtn" class="btn btn-secondary" disabled>
                                    <span class="btn-text">Fetch</span>
                                    <span class="btn-loader" style="display: none;">Loading...</span>
                                </button>
                            </div>
                            <div id="originalMessagePreview" class="message-preview" style="display: none;">
                                <div class="preview-header">
                                    <span style="font-size: 12px; opacity: 0.7;">Replying to:</span>
                                    <button type="button" id="clearReplyBtn" class="clear-btn">×</button>
                                </div>
                                <div id="originalMessageContent" class="preview-content"></div>
                            </div>
                        </div>
                        
                        <!-- Message Content -->
                        <div class="form-group">
                            <label for="enhancedMessageText">Message</label>
                            <textarea id="enhancedMessageText" class="form-control" placeholder="Type your message here..." rows="4"></textarea>
                            <div class="character-count">
                                <span id="charCount">0</span>/2000 characters
                            </div>
                        </div>
                        
                        <!-- File Attachments -->
                        <div class="form-group">
                            <label for="messageAttachments">Attachments (Optional)</label>
                            <input type="file" id="messageAttachments" class="form-control" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx">
                            <small style="opacity: 0.7;">Max 25MB per file. Supports images, videos, audio, and documents.</small>
                            <div id="attachmentPreview" class="attachment-preview"></div>
                        </div>
                        
                        <!-- Quick Actions Row -->
                        <div class="quick-actions">
                            <button type="button" id="emojiPickerBtn" class="action-btn">
                                😀 Add Emoji
                            </button>
                            <button type="button" id="stickerPickerBtn" class="action-btn">
                                🎭 Add Sticker
                            </button>
                            <button type="button" id="previewBtn" class="action-btn">
                                👁️ Preview
                            </button>
                        </div>
                        
                        <!-- Emoji Picker -->
                        <div id="emojiPicker" class="picker-container" style="display: none;">
                            <div class="picker-header">
                                <h4>Select Emoji</h4>
                                <button type="button" class="close-picker">×</button>
                            </div>
                            <div class="picker-tabs">
                                <button type="button" class="picker-tab active" data-tab="standard">Standard</button>
                                <button type="button" class="picker-tab" data-tab="custom">Server</button>
                            </div>
                            <div class="picker-content">
                                <div id="standardEmojis" class="emoji-grid">
                                    <!-- Standard emojis -->
                                    <span class="emoji-option">😀</span><span class="emoji-option">😃</span><span class="emoji-option">😄</span><span class="emoji-option">😁</span>
                                    <span class="emoji-option">😅</span><span class="emoji-option">😂</span><span class="emoji-option">🤣</span><span class="emoji-option">😊</span>
                                    <span class="emoji-option">😇</span><span class="emoji-option">🙂</span><span class="emoji-option">🙃</span><span class="emoji-option">😉</span>
                                    <span class="emoji-option">😌</span><span class="emoji-option">😍</span><span class="emoji-option">🥰</span><span class="emoji-option">😘</span>
                                    <span class="emoji-option">👍</span><span class="emoji-option">👎</span><span class="emoji-option">👌</span><span class="emoji-option">✌️</span>
                                    <span class="emoji-option">🤞</span><span class="emoji-option">🤟</span><span class="emoji-option">🤘</span><span class="emoji-option">🤙</span>
                                    <span class="emoji-option">❤️</span><span class="emoji-option">🧡</span><span class="emoji-option">💛</span><span class="emoji-option">💚</span>
                                    <span class="emoji-option">💙</span><span class="emoji-option">💜</span><span class="emoji-option">🖤</span><span class="emoji-option">🤍</span>
                                    <span class="emoji-option">🔥</span><span class="emoji-option">⭐</span><span class="emoji-option">⚡</span><span class="emoji-option">💯</span>
                                </div>
                                <div id="customEmojis" class="emoji-grid" style="display: none;">
                                    <div class="loading-emojis">Loading server emojis...</div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Sticker Picker -->
                        <div id="stickerPicker" class="picker-container" style="display: none;">
                            <div class="picker-header">
                                <h4>Select Sticker</h4>
                                <button type="button" class="close-picker">×</button>
                            </div>
                            <div id="stickerGrid" class="sticker-grid">
                                <div class="loading-stickers">Loading server stickers...</div>
                            </div>
                            <div id="selectedStickerPreview" class="selected-sticker" style="display: none;">
                                <span>Selected: <span id="selectedStickerName"></span></span>
                                <button type="button" id="clearStickerBtn" class="clear-btn">Remove</button>
                            </div>
                        </div>
                        
                        <!-- Message Preview -->
                        <div id="messagePreview" class="message-preview" style="display: none;">
                            <div class="preview-header">
                                <span>Message Preview</span>
                                <button type="button" id="closePreviewBtn" class="clear-btn">×</button>
                            </div>
                            <div id="messagePreviewContent" class="preview-content"></div>
                        </div>
                        
                        <!-- Submit Button -->
                        <div class="form-actions">
                            <button type="submit" id="enhancedSendBtn" class="btn btn-primary" disabled>
                                <span class="btn-icon">📤</span>
                                <span class="btn-text">Send Message</span>
                                <span class="btn-loader" style="display: none;">Sending...</span>
                            </button>
                            <button type="button" id="clearFormBtn" class="btn btn-secondary">
                                <span class="btn-icon">🗑️</span>
                                Clear Form
                            </button>
                        </div>
                    </form>
                    
                    <!-- Success/Error Messages -->
                    <div id="messageResult" class="result-message" style="display: none;"></div>
                </div>
            `,

            script: `
                // Enhanced Message Plugin Frontend Logic with Dashboard Integration
                (function() {
                    console.log('💬 Enhanced Message Plugin: Initializing...');
                    
                    // Get form elements
                    const messageForm = document.getElementById('enhancedMessageForm');
                    const channelSelect = document.getElementById('messageChannelSelect');
                    const messageText = document.getElementById('enhancedMessageText');
                    const messageAttachments = document.getElementById('messageAttachments');
                    const attachmentPreview = document.getElementById('attachmentPreview');
                    const replyMessageId = document.getElementById('replyMessageId');
                    const fetchMessageBtn = document.getElementById('fetchMessageBtn');
                    const originalMessagePreview = document.getElementById('originalMessagePreview');
                    const originalMessageContent = document.getElementById('originalMessageContent');
                    const clearReplyBtn = document.getElementById('clearReplyBtn');
                    const sendBtn = document.getElementById('enhancedSendBtn');
                    const clearFormBtn = document.getElementById('clearFormBtn');
                    const charCount = document.getElementById('charCount');
                    const currentServerName = document.getElementById('currentServerName');
                    const messageResult = document.getElementById('messageResult');
                    
                    // Picker elements
                    const emojiPickerBtn = document.getElementById('emojiPickerBtn');
                    const stickerPickerBtn = document.getElementById('stickerPickerBtn');
                    const previewBtn = document.getElementById('previewBtn');
                    const emojiPicker = document.getElementById('emojiPicker');
                    const stickerPicker = document.getElementById('stickerPicker');
                    const messagePreview = document.getElementById('messagePreview');
                    
                    // State variables
                    let currentServerId = null;
                    let selectedStickerId = null;
                    let isFormValid = false;
                    let serverEmojisLoaded = false;
                    
                    // Initialize plugin
                    function initializeMessagePlugin() {
                        console.log('💬 Initializing enhanced message plugin...');
                        
                        // Get current server from dashboard
                        if (window.dashboardAPI && window.dashboardAPI.currentServer) {
                            currentServerId = window.dashboardAPI.currentServer();
                            console.log('💬 Current server from dashboard:', currentServerId);
                            
                            if (currentServerId) {
                                loadChannelsForServer(currentServerId);
                                updateServerDisplay();
                            }
                        }
                        
                        setupEventListeners();
                        updateFormValidation();
                        
                        console.log('✅ Enhanced message plugin initialized');
                    }
                    
                    // Load channels for the current server
                    async function loadChannelsForServer(serverId) {
                        if (!serverId || !channelSelect) return;
                        
                        try {
                            const response = await fetch(\`/api/channels/\${serverId}\`);
                            if (!response.ok) throw new Error('Failed to load channels');
                            
                            const channels = await response.json();
                            
                            channelSelect.innerHTML = '<option value="">Select a channel...</option>';
                            channels.forEach(channel => {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`# \${channel.name}\`;
                                channelSelect.appendChild(option);
                            });
                            
                            console.log(\`💬 Loaded \${channels.length} channels for server\`);
                        } catch (error) {
                            console.error('Error loading channels:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Failed to load channels', 'error');
                            }
                        }
                    }
                    
                    // Update server display
                    function updateServerDisplay() {
                        if (currentServerName && window.dashboardAPI && window.dashboardAPI.getServerName) {
                            const serverName = window.dashboardAPI.getServerName(currentServerId);
                            currentServerName.textContent = serverName || 'Unknown Server';
                        }
                    }
                    
                    // Setup all event listeners
                    function setupEventListeners() {
                        // Form validation
                        if (messageText) {
                            messageText.addEventListener('input', function() {
                                updateCharacterCount();
                                updateFormValidation();
                            });
                        }
                        
                        if (channelSelect) {
                            channelSelect.addEventListener('change', updateFormValidation);
                        }
                        
                        if (messageAttachments) {
                            messageAttachments.addEventListener('change', function() {
                                updateAttachmentPreview();
                                updateFormValidation();
                            });
                        }
                        
                        if (replyMessageId) {
                            replyMessageId.addEventListener('input', function() {
                                updateFetchButtonState();
                            });
                        }
                        
                        // Fetch message for reply
                        if (fetchMessageBtn) {
                            fetchMessageBtn.addEventListener('click', fetchOriginalMessage);
                        }
                        
                        // Clear reply
                        if (clearReplyBtn) {
                            clearReplyBtn.addEventListener('click', clearReply);
                        }
                        
                        // Form submission
                        if (messageForm) {
                            messageForm.addEventListener('submit', handleFormSubmit);
                        }
                        
                        // Clear form
                        if (clearFormBtn) {
                            clearFormBtn.addEventListener('click', clearForm);
                        }
                        
                        // Picker buttons
                        if (emojiPickerBtn) {
                            emojiPickerBtn.addEventListener('click', toggleEmojiPicker);
                        }
                        
                        if (stickerPickerBtn) {
                            stickerPickerBtn.addEventListener('click', toggleStickerPicker);
                        }
                        
                        if (previewBtn) {
                            previewBtn.addEventListener('click', toggleMessagePreview);
                        }
                        
                        // Emoji and sticker selection
                        document.addEventListener('click', function(e) {
                            if (e.target.classList.contains('emoji-option')) {
                                insertEmoji(e.target.textContent);
                            }
                            
                            if (e.target.classList.contains('close-picker')) {
                                closePickers();
                            }
                            
                            if (e.target.classList.contains('picker-tab')) {
                                switchEmojiTab(e.target.dataset.tab);
                            }
                        });
                        
                        console.log('💬 Event listeners setup complete');
                    }
                    
                    // Update character count
                    function updateCharacterCount() {
                        if (!messageText || !charCount) return;
                        
                        const count = messageText.value.length;
                        charCount.textContent = count;
                        
                        if (count > 2000) {
                            charCount.style.color = '#ef4444';
                        } else if (count > 1800) {
                            charCount.style.color = '#f59e0b';
                        } else {
                            charCount.style.color = '#9ca3af';
                        }
                    }
                    
                    // Update attachment preview
                    function updateAttachmentPreview() {
                        if (!attachmentPreview || !messageAttachments) return;
                        
                        const files = Array.from(messageAttachments.files);
                        attachmentPreview.innerHTML = '';
                        
                        if (files.length > 0) {
                            attachmentPreview.style.display = 'block';
                            files.forEach((file, index) => {
                                const fileDiv = document.createElement('div');
                                fileDiv.className = 'attachment-item';
                                fileDiv.innerHTML = \`
                                    <div class="attachment-info">
                                        <span class="attachment-name">\${file.name}</span>
                                        <span class="attachment-size">(\${formatFileSize(file.size)})</span>
                                    </div>
                                    <button type="button" class="remove-attachment" data-index="\${index}">×</button>
                                \`;
                                attachmentPreview.appendChild(fileDiv);
                            });
                            
                            // Add remove buttons
                            attachmentPreview.addEventListener('click', function(e) {
                                if (e.target.classList.contains('remove-attachment')) {
                                    const index = parseInt(e.target.dataset.index);
                                    removeAttachment(index);
                                }
                            });
                        } else {
                            attachmentPreview.style.display = 'none';
                        }
                    }
                    
                    // Remove attachment
                    function removeAttachment(index) {
                        if (!messageAttachments) return;
                        
                        const dt = new DataTransfer();
                        const files = Array.from(messageAttachments.files);
                        
                        files.forEach((file, i) => {
                            if (i !== index) {
                                dt.items.add(file);
                            }
                        });
                        
                        messageAttachments.files = dt.files;
                        updateAttachmentPreview();
                        updateFormValidation();
                    }
                    
                    // Format file size
                    function formatFileSize(bytes) {
                        if (bytes === 0) return '0 Bytes';
                        const k = 1024;
                        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                    }
                    
                    // Update form validation
                    function updateFormValidation() {
                        const hasChannel = channelSelect && channelSelect.value;
                        const hasMessage = messageText && messageText.value.trim();
                        const hasAttachments = messageAttachments && messageAttachments.files.length > 0;
                        const hasSticker = selectedStickerId;
                        const validLength = messageText && messageText.value.length <= 2000;
                        
                        isFormValid = hasChannel && (hasMessage || hasAttachments || hasSticker) && validLength;
                        
                        if (sendBtn) {
                            sendBtn.disabled = !isFormValid;
                        }
                        
                        updateFetchButtonState();
                    }
                    
                    // Update fetch button state
                    function updateFetchButtonState() {
                        if (!fetchMessageBtn) return;
                        
                        const hasChannel = channelSelect && channelSelect.value;
                        const hasMessageId = replyMessageId && replyMessageId.value.trim();
                        
                        fetchMessageBtn.disabled = !hasChannel || !hasMessageId;
                    }
                    
                    // Fetch original message for reply
                    async function fetchOriginalMessage() {
                        if (!channelSelect.value || !replyMessageId.value.trim()) return;
                        
                        const btnText = fetchMessageBtn.querySelector('.btn-text');
                        const btnLoader = fetchMessageBtn.querySelector('.btn-loader');
                        
                        // Show loading state
                        if (btnText) btnText.style.display = 'none';
                        if (btnLoader) btnLoader.style.display = 'inline';
                        fetchMessageBtn.disabled = true;
                        
                        try {
                            const response = await fetch(\`/api/plugins/message/fetch/\${channelSelect.value}/\${replyMessageId.value.trim()}\`);
                            
                            if (!response.ok) {
                                throw new Error('Message not found');
                            }
                            
                            const messageData = await response.json();
                            displayOriginalMessage(messageData);
                            
                        } catch (error) {
                            console.error('Error fetching message:', error);
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Message not found', 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            updateFetchButtonState();
                        }
                    }
                    
                    // Display original message preview
                    function displayOriginalMessage(messageData) {
                        if (!originalMessageContent || !originalMessagePreview) return;
                        
                        const createdAt = new Date(messageData.createdAt).toLocaleString();
                        
                        originalMessageContent.innerHTML = \`
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <img src="\${messageData.author.avatar}" alt="Avatar" style="width: 20px; height: 20px; border-radius: 50%;">
                                <strong>\${messageData.author.username}</strong>
                                <span style="opacity: 0.7; font-size: 0.9em;">\${createdAt}</span>
                            </div>
                            <div style="margin-left: 28px;">
                                \${messageData.content || '<em>No text content</em>'}
                            </div>
                            \${messageData.attachments.length > 0 ? '<div style="margin-left: 28px; margin-top: 4px; opacity: 0.7; font-size: 0.9em;">📎 ' + messageData.attachments.length + ' attachment(s)</div>' : ''}
                            <div style="margin-left: 28px; margin-top: 4px; opacity: 0.7; font-size: 0.9em;">
                                in #\${messageData.channelName} • \${messageData.guildName}
                            </div>
                        \`;
                        
                        originalMessagePreview.style.display = 'block';
                    }
                    
                    // Clear reply
                    function clearReply() {
                        if (replyMessageId) replyMessageId.value = '';
                        if (originalMessagePreview) originalMessagePreview.style.display = 'none';
                        updateFormValidation();
                    }
                    
                    // Toggle emoji picker
                    function toggleEmojiPicker() {
                        closePickers();
                        if (emojiPicker) {
                            emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
                            
                            // Load server emojis if not loaded
                            if (emojiPicker.style.display === 'block' && !serverEmojisLoaded && currentServerId) {
                                loadServerEmojis();
                            }
                        }
                    }
                    
                    // Switch emoji tab
                    function switchEmojiTab(tab) {
                        // Update tab buttons
                        document.querySelectorAll('.picker-tab').forEach(btn => {
                            btn.classList.remove('active');
                        });
                        document.querySelector(\`[data-tab="\${tab}"]\`)?.classList.add('active');
                        
                        // Show/hide content
                        if (tab === 'standard') {
                            document.getElementById('standardEmojis').style.display = 'grid';
                            document.getElementById('customEmojis').style.display = 'none';
                        } else {
                            document.getElementById('standardEmojis').style.display = 'none';
                            document.getElementById('customEmojis').style.display = 'grid';
                            
                            if (!serverEmojisLoaded && currentServerId) {
                                loadServerEmojis();
                            }
                        }
                    }
                    
                    // Load server emojis
                    async function loadServerEmojis() {
                        const customEmojis = document.getElementById('customEmojis');
                        if (!customEmojis || !currentServerId) return;
                        
                        try {
                            customEmojis.innerHTML = '<div class="loading-emojis">Loading server emojis...</div>';
                            
                            const response = await fetch(\`/api/plugins/message/emojis/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load emojis');
                            
                            const data = await response.json();
                            const emojis = data.emojis || [];
                            
                            if (emojis.length === 0) {
                                customEmojis.innerHTML = '<div class="no-emojis">No custom emojis available in this server</div>';
                                return;
                            }
                            
                            customEmojis.innerHTML = '';
                            emojis.forEach(emoji => {
                                const emojiSpan = document.createElement('span');
                                emojiSpan.className = 'emoji-option custom-emoji';
                                emojiSpan.innerHTML = \`<img src="\${emoji.url}" alt="\${emoji.name}" title="\${emoji.name}" style="width: 24px; height: 24px;">\`;
                                emojiSpan.dataset.emojiUsage = emoji.usage;
                                
                                emojiSpan.addEventListener('click', () => {
                                    insertEmoji(emoji.usage);
                                });
                                
                                customEmojis.appendChild(emojiSpan);
                            });
                            
                            serverEmojisLoaded = true;
                            
                        } catch (error) {
                            console.error('Error loading server emojis:', error);
                            customEmojis.innerHTML = '<div class="error-emojis">Failed to load server emojis</div>';
                        }
                    }
                    
                    // Toggle sticker picker
                    async function toggleStickerPicker() {
                        closePickers();
                        
                        if (stickerPicker) {
                            stickerPicker.style.display = stickerPicker.style.display === 'none' ? 'block' : 'none';
                            
                            if (stickerPicker.style.display === 'block' && currentServerId) {
                                await loadServerStickers();
                            }
                        }
                    }
                    
                    // Load server stickers
                    async function loadServerStickers() {
                        const stickerGrid = document.getElementById('stickerGrid');
                        if (!stickerGrid || !currentServerId) return;
                        
                        try {
                            stickerGrid.innerHTML = '<div class="loading-stickers">Loading server stickers...</div>';
                            
                            const response = await fetch(\`/api/plugins/message/emojis/\${currentServerId}\`);
                            if (!response.ok) throw new Error('Failed to load stickers');
                            
                            const data = await response.json();
                            const stickers = data.stickers || [];
                            
                            if (stickers.length === 0) {
                                stickerGrid.innerHTML = '<div class="no-stickers">No custom stickers available in this server</div>';
                                return;
                            }
                            
                            stickerGrid.innerHTML = '';
                            stickers.forEach(sticker => {
                                const stickerDiv = document.createElement('div');
                                stickerDiv.className = 'sticker-option';
                                stickerDiv.dataset.stickerId = sticker.id;
                                stickerDiv.innerHTML = \`
                                    <img src="\${sticker.url}" alt="\${sticker.name}" style="width: 60px; height: 60px; border-radius: 8px;">
                                    <div style="font-size: 12px; margin-top: 4px;">\${sticker.name}</div>
                                \`;
                                
                                stickerDiv.addEventListener('click', () => selectSticker(sticker));
                                stickerGrid.appendChild(stickerDiv);
                            });
                            
                        } catch (error) {
                            console.error('Error loading stickers:', error);
                            stickerGrid.innerHTML = '<div class="error-stickers">Failed to load stickers</div>';
                        }
                    }
                    
                    // Select sticker
                    function selectSticker(sticker) {
                        selectedStickerId = sticker.id;
                        
                        const preview = document.getElementById('selectedStickerPreview');
                        const name = document.getElementById('selectedStickerName');
                        
                        if (preview && name) {
                            name.textContent = sticker.name;
                            preview.style.display = 'block';
                        }
                        
                        updateFormValidation();
                        closePickers();
                    }
                    
                    // Clear sticker selection
                    if (document.getElementById('clearStickerBtn')) {
                        document.getElementById('clearStickerBtn').addEventListener('click', function() {
                            selectedStickerId = null;
                            const preview = document.getElementById('selectedStickerPreview');
                            if (preview) preview.style.display = 'none';
                            updateFormValidation();
                        });
                    }
                    
                    // Toggle message preview
                    function toggleMessagePreview() {
                        const preview = document.getElementById('messagePreview');
                        const content = document.getElementById('messagePreviewContent');
                        
                        if (!preview || !content) return;
                        
                        if (preview.style.display === 'none' || !preview.style.display) {
                            const messageContent = messageText.value.trim() || '<em>No message text</em>';
                            const attachmentCount = messageAttachments ? messageAttachments.files.length : 0;
                            
                            content.innerHTML = \`
                                <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                        <div style="width: 32px; height: 32px; background: #7289da; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                                            \${window.dashboardAPI && window.dashboardAPI.currentUser ? window.dashboardAPI.currentUser().username.charAt(0).toUpperCase() : 'U'}
                                        </div>
                                        <strong>\${window.dashboardAPI && window.dashboardAPI.currentUser ? window.dashboardAPI.currentUser().username : 'You'}</strong>
                                        <span style="opacity: 0.7; font-size: 0.9em;">now</span>
                                    </div>
                                    <div style="margin-left: 40px;">
                                        \${messageContent.replace(/\\n/g, '<br>')}
                                    </div>
                                    \${attachmentCount > 0 ? '<div style="margin-left: 40px; margin-top: 8px; opacity: 0.7; font-size: 0.9em;">📎 ' + attachmentCount + ' attachment(s)</div>' : ''}
                                    \${selectedStickerId ? '<div style="margin-left: 40px; margin-top: 8px; opacity: 0.7; font-size: 0.9em;">🎭 Selected sticker</div>' : ''}
                                </div>
                            \`;
                            preview.style.display = 'block';
                        } else {
                            preview.style.display = 'none';
                        }
                    }
                    
                    // Insert emoji at cursor position
                    function insertEmoji(emoji) {
                        if (!messageText) return;
                        
                        const cursorPos = messageText.selectionStart;
                        const textBefore = messageText.value.substring(0, cursorPos);
                        const textAfter = messageText.value.substring(messageText.selectionEnd);
                        
                        messageText.value = textBefore + emoji + textAfter;
                        messageText.focus();
                        messageText.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
                        
                        updateCharacterCount();
                        updateFormValidation();
                        closePickers();
                    }
                    
                    // Close all pickers
                    function closePickers() {
                        if (emojiPicker) emojiPicker.style.display = 'none';
                        if (stickerPicker) stickerPicker.style.display = 'none';
                        if (messagePreview) messagePreview.style.display = 'none';
                    }
                    
                    // Handle form submission
                    async function handleFormSubmit(e) {
                        e.preventDefault();
                        
                        if (!isFormValid || !currentServerId) {
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Please fill in all required fields', 'error');
                            }
                            return;
                        }
                        
                        // Show loading state
                        const btnText = sendBtn.querySelector('.btn-text');
                        const btnLoader = sendBtn.querySelector('.btn-loader');
                        
                        if (btnText) btnText.style.display = 'none';
                        if (btnLoader) btnLoader.style.display = 'inline';
                        sendBtn.disabled = true;
                        
                        try {
                            // Prepare form data
                            const formData = new FormData();
                            formData.append('serverId', currentServerId);
                            formData.append('channelId', channelSelect.value);
                            
                            if (messageText.value.trim()) {
                                formData.append('message', messageText.value.trim());
                            }
                            
                            if (replyMessageId.value.trim()) {
                                formData.append('replyToMessageId', replyMessageId.value.trim());
                            }
                            
                            if (selectedStickerId) {
                                formData.append('stickerId', selectedStickerId);
                            }
                            
                            // Add attachments
                            if (messageAttachments && messageAttachments.files.length > 0) {
                                Array.from(messageAttachments.files).forEach(file => {
                                    formData.append('attachments', file);
                                });
                            }
                            
                            const response = await fetch('/api/plugins/message/send', {
                                method: 'POST',
                                body: formData
                            });
                            
                            const result = await response.json();
                            
                            if (response.ok) {
                                // Success
                                showResult('Message sent successfully!', 'success');
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification(\`Message sent to #\${result.channelName}\`, 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', \`Message sent to #\${result.channelName}\`);
                                    }
                                }
                                
                                clearForm();
                            } else {
                                // Error
                                throw new Error(result.error || 'Failed to send message');
                            }
                            
                        } catch (error) {
                            console.error('Error sending message:', error);
                            showResult(\`Error: \${error.message}\`, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            updateFormValidation();
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!messageResult) return;
                        
                        messageResult.textContent = message;
                        messageResult.className = \`result-message \${type}\`;
                        messageResult.style.display = 'block';
                        
                        // Hide after 5 seconds
                        setTimeout(() => {
                            messageResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Clear form
                    function clearForm() {
                        if (messageText) messageText.value = '';
                        if (messageAttachments) messageAttachments.value = '';
                        if (attachmentPreview) attachmentPreview.style.display = 'none';
                        if (replyMessageId) replyMessageId.value = '';
                        if (originalMessagePreview) originalMessagePreview.style.display = 'none';
                        if (messagePreview) messagePreview.style.display = 'none';
                        
                        selectedStickerId = null;
                        const stickerPreview = document.getElementById('selectedStickerPreview');
                        if (stickerPreview) stickerPreview.style.display = 'none';
                        
                        updateCharacterCount();
                        updateFormValidation();
                        closePickers();
                        
                        if (window.dashboardAPI && window.dashboardAPI.addLogEntry) {
                            window.dashboardAPI.addLogEntry('info', 'Message form cleared');
                        }
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
                            console.log('💬 Message plugin: Server changed to', serverId);
                            
                            if (serverId) {
                                loadChannelsForServer(serverId);
                                updateServerDisplay();
                                clearForm(); // Clear form when server changes
                                serverEmojisLoaded = false; // Reset emoji cache
                            }
                        };
                    }
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeMessagePlugin);
                    } else {
                        initializeMessagePlugin();
                    }
                    
                    console.log('✅ Enhanced Message Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = MessagePlugin;