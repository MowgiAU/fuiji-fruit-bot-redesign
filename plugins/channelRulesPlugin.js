const fs = require('fs');
const path = require('path');

class ChannelRulesPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Channel Rules';
        this.description = 'Set up automated rules for channels with custom conditions and actions';
        this.version = '1.2.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // Storage for channel rules per server
        this.channelRules = this.loadChannelRules();
        
        this.setupRoutes();
        this.setupMessageListener();
    }

    loadChannelRules() {
        try {
            const rulesPath = './data/channelRules.json';
            if (fs.existsSync(rulesPath)) {
                return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading channel rules:', error);
        }
        return {};
    }

    saveChannelRules() {
        try {
            const dataDir = './data';
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir);
            }
            fs.writeFileSync('./data/channelRules.json', JSON.stringify(this.channelRules, null, 2));
        } catch (error) {
            console.error('Error saving channel rules:', error);
        }
    }

    setupRoutes() {
        // Get all channel rules for a server
        this.app.get('/api/plugins/channelrules/rules/:serverId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const serverRules = this.channelRules[serverId] || {};
                res.json(serverRules);
            } catch (error) {
                console.error('Error getting channel rules:', error);
                res.status(500).json({ error: 'Failed to get channel rules' });
            }
        });

        // Get rules for a specific channel
        this.app.get('/api/plugins/channelrules/rules/:serverId/:channelId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId, channelId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                const channelRules = this.channelRules[serverId]?.[channelId] || {
                    enabled: false,
                    rules: [],
                    logChannelId: null
                };
                
                res.json(channelRules);
            } catch (error) {
                console.error('Error getting channel rules:', error);
                res.status(500).json({ error: 'Failed to get channel rules' });
            }
        });

        // Update rules for a specific channel
        this.app.post('/api/plugins/channelrules/rules/:serverId/:channelId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId, channelId } = req.params;
                const { enabled, rules, logChannelId } = req.body;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                if (!this.channelRules[serverId]) {
                    this.channelRules[serverId] = {};
                }
                
                this.channelRules[serverId][channelId] = {
                    enabled: enabled || false,
                    rules: rules || [],
                    logChannelId: logChannelId || null
                };
                
                this.saveChannelRules();
                res.json({ success: true, message: 'Channel rules updated successfully' });
            } catch (error) {
                console.error('Error updating channel rules:', error);
                res.status(500).json({ error: 'Failed to update channel rules' });
            }
        });

        // Delete rules for a specific channel
        this.app.delete('/api/plugins/channelrules/rules/:serverId/:channelId', this.ensureAuthenticated, async (req, res) => {
            try {
                const { serverId, channelId } = req.params;
                
                const hasAdmin = await this.hasAdminPermissions(req.user.id, serverId);
                if (!hasAdmin) {
                    return res.status(403).json({ error: 'No admin permissions' });
                }
                
                if (this.channelRules[serverId] && this.channelRules[serverId][channelId]) {
                    delete this.channelRules[serverId][channelId];
                    this.saveChannelRules();
                }
                
                res.json({ success: true, message: 'Channel rules deleted successfully' });
            } catch (error) {
                console.error('Error deleting channel rules:', error);
                res.status(500).json({ error: 'Failed to delete channel rules' });
            }
        });

        // Get roles for a server (NEW ENDPOINT)
        this.app.get('/api/plugins/channelrules/roles/:serverId', this.ensureAuthenticated, async (req, res) => {
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
                
                const roles = guild.roles.cache
                    .filter(role => role.name !== '@everyone' && !role.managed)
                    .map(role => ({
                        id: role.id,
                        name: role.name,
                        color: role.color
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                
                res.json(roles);
            } catch (error) {
                console.error('Error getting roles:', error);
                res.status(500).json({ error: 'Failed to get roles' });
            }
        });
    }

    setupMessageListener() {
        this.client.on('messageCreate', async (message) => {
            // Ignore bot messages and DMs
            if (message.author.bot || !message.guild) return;
            
            const serverId = message.guild.id;
            const channelId = message.channel.id;
            
            // Check if there are rules for this channel
            const channelRules = this.channelRules[serverId]?.[channelId];
            if (!channelRules || !channelRules.enabled || !channelRules.rules.length) return;
            
            // Get member object for role checking
            const member = message.member;
            if (!member) return;
            
            // Check each rule
            for (const rule of channelRules.rules) {
                // NEW: Check role conditions first
                if (!this.checkRoleConditions(member, rule)) {
                    continue; // Skip this rule if role conditions don't match
                }
                
                const violation = await this.checkRule(message, rule);
                if (violation) {
                    await this.handleRuleViolation(message, rule, violation, channelRules.logChannelId);
                    break; // Only handle first violation
                }
            }
        });
    }

    // NEW: Check if user meets role conditions
    checkRoleConditions(member, rule) {
        // If no role conditions set, rule applies to everyone
        if (!rule.roleConditions || 
            (!rule.roleConditions.requiredRoles?.length && !rule.roleConditions.exemptRoles?.length)) {
            return true;
        }
        
        const userRoles = member.roles.cache.map(role => role.id);
        
        // Check exempt roles first (these users bypass the rule entirely)
        if (rule.roleConditions.exemptRoles?.length > 0) {
            const hasExemptRole = rule.roleConditions.exemptRoles.some(roleId => 
                userRoles.includes(roleId)
            );
            if (hasExemptRole) {
                return false; // User has exempt role, rule doesn't apply to them
            }
        }
        
        // Check required roles (user MUST have at least one of these for rule to apply)
        if (rule.roleConditions.requiredRoles?.length > 0) {
            const hasRequiredRole = rule.roleConditions.requiredRoles.some(roleId => 
                userRoles.includes(roleId)
            );
            if (!hasRequiredRole) {
                return false; // User doesn't have any required roles, rule doesn't apply
            }
        }
        
        return true; // All role conditions met, rule applies
    }

    async checkRule(message, rule) {
        switch (rule.type) {
            // Requirement rules
            case 'must_contain_audio':
                return this.checkMustContainAudio(message, rule);
            
            case 'must_contain_image':
                return this.checkMustContainImage(message, rule);
            
            case 'must_contain_video':
                return this.checkMustContainVideo(message, rule);
            
            case 'must_contain_file':
                return this.checkMustContainFile(message, rule);
            
            // Blocking rules
            case 'block_audio':
                return this.checkBlockAudio(message, rule);
            
            case 'block_images':
                return this.checkBlockImages(message, rule);
            
            case 'block_videos':
                return this.checkBlockVideos(message, rule);
            
            case 'block_all_files':
                return this.checkBlockAllFiles(message, rule);
            
            case 'block_file_extensions':
                return this.checkBlockFileExtensions(message, rule);
            
            case 'block_large_files':
                return this.checkBlockLargeFiles(message, rule);
            
            // Existing rules
            case 'blocked_domains':
                return this.checkBlockedDomains(message, rule);
            
            case 'required_text':
                return this.checkRequiredText(message, rule);
            
            case 'blocked_text':
                return this.checkBlockedText(message, rule);
            
            case 'min_length':
                return this.checkMinLength(message, rule);
            
            case 'max_length':
                return this.checkMaxLength(message, rule);
            
            default:
                return null;
        }
    }

    // Existing requirement methods...
    checkMustContainAudio(message, rule) {
        const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'];
        const hasAudio = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return audioExtensions.includes(ext);
        });
        
        if (!hasAudio) {
            return {
                type: 'missing_audio',
                message: rule.customMessage || 'Your message must contain an audio file.'
            };
        }
        return null;
    }

    checkMustContainImage(message, rule) {
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
        const hasImage = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return imageExtensions.includes(ext);
        });
        
        if (!hasImage) {
            return {
                type: 'missing_image',
                message: rule.customMessage || 'Your message must contain an image.'
            };
        }
        return null;
    }

    checkMustContainVideo(message, rule) {
        const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
        const hasVideo = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return videoExtensions.includes(ext);
        });
        
        if (!hasVideo) {
            return {
                type: 'missing_video',
                message: rule.customMessage || 'Your message must contain a video file.'
            };
        }
        return null;
    }

    checkMustContainFile(message, rule) {
        if (message.attachments.size === 0) {
            return {
                type: 'missing_file',
                message: rule.customMessage || 'Your message must contain a file attachment.'
            };
        }
        return null;
    }

    // BLOCKING METHODS
    checkBlockAudio(message, rule) {
        const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'];
        const hasAudio = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return audioExtensions.includes(ext);
        });
        
        if (hasAudio) {
            const audioFile = Array.from(message.attachments.values()).find(attachment => {
                const ext = attachment.name.split('.').pop().toLowerCase();
                return audioExtensions.includes(ext);
            });
            
            return {
                type: 'blocked_audio',
                message: rule.customMessage || 'Audio files are not allowed in this channel.',
                fileName: audioFile.name
            };
        }
        return null;
    }

    checkBlockImages(message, rule) {
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
        const hasImage = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return imageExtensions.includes(ext);
        });
        
        if (hasImage) {
            const imageFile = Array.from(message.attachments.values()).find(attachment => {
                const ext = attachment.name.split('.').pop().toLowerCase();
                return imageExtensions.includes(ext);
            });
            
            return {
                type: 'blocked_image',
                message: rule.customMessage || 'Images are not allowed in this channel.',
                fileName: imageFile.name
            };
        }
        return null;
    }

    checkBlockVideos(message, rule) {
        const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
        const hasVideo = message.attachments.some(attachment => {
            const ext = attachment.name.split('.').pop().toLowerCase();
            return videoExtensions.includes(ext);
        });
        
        if (hasVideo) {
            const videoFile = Array.from(message.attachments.values()).find(attachment => {
                const ext = attachment.name.split('.').pop().toLowerCase();
                return videoExtensions.includes(ext);
            });
            
            return {
                type: 'blocked_video',
                message: rule.customMessage || 'Videos are not allowed in this channel.',
                fileName: videoFile.name
            };
        }
        return null;
    }

    checkBlockAllFiles(message, rule) {
        if (message.attachments.size > 0) {
            const firstFile = Array.from(message.attachments.values())[0];
            return {
                type: 'blocked_all_files',
                message: rule.customMessage || 'File attachments are not allowed in this channel.',
                fileName: firstFile.name
            };
        }
        return null;
    }

    checkBlockFileExtensions(message, rule) {
        const blockedExtensions = (rule.extensions || []).map(ext => ext.toLowerCase());
        
        for (const attachment of message.attachments.values()) {
            const ext = attachment.name.split('.').pop().toLowerCase();
            if (blockedExtensions.includes(ext)) {
                return {
                    type: 'blocked_extension',
                    message: rule.customMessage || `Files with .${ext} extension are not allowed in this channel.`,
                    fileName: attachment.name,
                    extension: ext
                };
            }
        }
        return null;
    }

    checkBlockLargeFiles(message, rule) {
        const maxSize = rule.maxSize || 10 * 1024 * 1024; // Default 10MB
        
        for (const attachment of message.attachments.values()) {
            if (attachment.size > maxSize) {
                return {
                    type: 'file_too_large',
                    message: rule.customMessage || `Files larger than ${this.formatFileSize(maxSize)} are not allowed in this channel.`,
                    fileName: attachment.name,
                    fileSize: attachment.size,
                    maxSize: maxSize
                };
            }
        }
        return null;
    }

    // Existing text/domain/length checking methods...
    checkBlockedDomains(message, rule) {
        const blockedDomains = rule.domains || [];
        const content = message.content.toLowerCase();
        
        for (const domain of blockedDomains) {
            if (content.includes(domain.toLowerCase())) {
                return {
                    type: 'blocked_domain',
                    message: rule.customMessage || `Links to ${domain} are not allowed in this channel.`,
                    domain: domain
                };
            }
        }
        return null;
    }

    checkRequiredText(message, rule) {
        const requiredTexts = rule.texts || [];
        const content = message.content.toLowerCase();
        
        for (const requiredText of requiredTexts) {
            if (!content.includes(requiredText.toLowerCase())) {
                return {
                    type: 'missing_required_text',
                    message: rule.customMessage || `Your message must contain: "${requiredText}"`,
                    requiredText: requiredText
                };
            }
        }
        return null;
    }

    checkBlockedText(message, rule) {
        const blockedTexts = rule.texts || [];
        const content = message.content.toLowerCase();
        
        for (const blockedText of blockedTexts) {
            if (content.includes(blockedText.toLowerCase())) {
                return {
                    type: 'blocked_text',
                    message: rule.customMessage || `Your message contains blocked content: "${blockedText}"`,
                    blockedText: blockedText
                };
            }
        }
        return null;
    }

    checkMinLength(message, rule) {
        const minLength = rule.length || 0;
        if (message.content.length < minLength) {
            return {
                type: 'too_short',
                message: rule.customMessage || `Your message must be at least ${minLength} characters long.`,
                currentLength: message.content.length,
                requiredLength: minLength
            };
        }
        return null;
    }

    checkMaxLength(message, rule) {
        const maxLength = rule.length || 2000;
        if (message.content.length > maxLength) {
            return {
                type: 'too_long',
                message: rule.customMessage || `Your message must be no more than ${maxLength} characters long.`,
                currentLength: message.content.length,
                maxLength: maxLength
            };
        }
        return null;
    }

    async handleRuleViolation(message, rule, violation, logChannelId) {
        try {
            // Delete the original message
            await message.delete();
            
            // Send DM to user if action is set to DM
            if (rule.action === 'dm' || rule.action === 'delete_and_dm') {
                try {
                    const dmEmbed = {
                        color: 0xff6b6b,
                        title: '🚫 Message Removed',
                        description: violation.message,
                        fields: [
                            {
                                name: 'Channel',
                                value: `#${message.channel.name}`,
                                inline: true
                            },
                            {
                                name: 'Server',
                                value: message.guild.name,
                                inline: true
                            },
                            {
                                name: 'Rule Type',
                                value: this.getRuleTypeDisplay(rule.type),
                                inline: true
                            },
                            {
                                name: 'Your Message',
                                value: message.content.length > 1000 ? 
                                    message.content.substring(0, 1000) + '...' : 
                                    message.content || '*No text content*',
                                inline: false
                            }
                        ],
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: 'Please review the channel rules and try again.'
                        }
                    };
                    
                    // Add file info if relevant
                    if (violation.fileName) {
                        dmEmbed.fields.push({
                            name: 'Blocked File',
                            value: violation.fileName,
                            inline: true
                        });
                    }
                    
                    await message.author.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`Could not send DM to ${message.author.tag}: ${dmError.message}`);
                }
            }
            
            // Log to designated channel if configured
            if (logChannelId) {
                const logChannel = this.client.channels.cache.get(logChannelId);
                if (logChannel) {
                    const logEmbed = {
                        color: 0xff6b6b,
                        title: '🚫 Rule Violation',
                        fields: [
                            {
                                name: 'User',
                                value: `${message.author} (${message.author.tag})`,
                                inline: true
                            },
                            {
                                name: 'Channel',
                                value: `${message.channel}`,
                                inline: true
                            },
                            {
                                name: 'Rule Type',
                                value: this.getRuleTypeDisplay(rule.type),
                                inline: true
                            },
                            {
                                name: 'Violation',
                                value: violation.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                inline: true
                            },
                            {
                                name: 'Action Taken',
                                value: this.getActionDisplay(rule.action),
                                inline: true
                            }
                        ],
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: `Message ID: ${message.id} • User ID: ${message.author.id}`
                        }
                    };
                    
                    // NEW: Add role condition info to log
                    if (rule.roleConditions) {
                        const roleInfo = [];
                        if (rule.roleConditions.requiredRoles?.length > 0) {
                            const roleNames = rule.roleConditions.requiredRoles.map(roleId => {
                                const role = message.guild.roles.cache.get(roleId);
                                return role ? role.name : 'Unknown Role';
                            });
                            roleInfo.push(`Required: ${roleNames.join(', ')}`);
                        }
                        if (rule.roleConditions.exemptRoles?.length > 0) {
                            const roleNames = rule.roleConditions.exemptRoles.map(roleId => {
                                const role = message.guild.roles.cache.get(roleId);
                                return role ? role.name : 'Unknown Role';
                            });
                            roleInfo.push(`Exempt: ${roleNames.join(', ')}`);
                        }
                        
                        if (roleInfo.length > 0) {
                            logEmbed.fields.push({
                                name: 'Role Conditions',
                                value: roleInfo.join('\n'),
                                inline: false
                            });
                        }
                    }
                    
                    // Add user roles to log
                    if (message.member) {
                        const userRoles = message.member.roles.cache
                            .filter(role => role.name !== '@everyone')
                            .map(role => role.name)
                            .slice(0, 10) // Limit to prevent embed overflow
                            .join(', ');
                        
                        if (userRoles) {
                            logEmbed.fields.push({
                                name: 'User Roles',
                                value: userRoles + (message.member.roles.cache.size > 11 ? '...' : ''),
                                inline: false
                            });
                        }
                    }
                    
                    logEmbed.fields.push({
                        name: 'Message Content',
                        value: message.content.length > 1000 ? 
                            message.content.substring(0, 1000) + '...' : 
                            message.content || '*No text content*',
                        inline: false
                    });
                    
                    // Add attachment info if any
                    if (message.attachments.size > 0) {
                        const attachmentInfo = Array.from(message.attachments.values())
                            .map(att => `${att.name} (${this.formatFileSize(att.size)})`)
                            .join('\n');
                        
                        logEmbed.fields.push({
                            name: 'Attachments',
                            value: attachmentInfo,
                            inline: false
                        });
                    }
                    
                    // Add specific violation details
                    if (violation.domain) {
                        logEmbed.fields.push({
                            name: 'Blocked Domain',
                            value: violation.domain,
                            inline: true
                        });
                    }
                    
                    if (violation.blockedText) {
                        logEmbed.fields.push({
                            name: 'Blocked Text',
                            value: `"${violation.blockedText}"`,
                            inline: true
                        });
                    }
                    
                    if (violation.requiredText) {
                        logEmbed.fields.push({
                            name: 'Missing Required Text',
                            value: `"${violation.requiredText}"`,
                            inline: true
                        });
                    }
                    
                    if (violation.fileName) {
                        logEmbed.fields.push({
                            name: 'Blocked File',
                            value: violation.fileName,
                            inline: true
                        });
                    }
                    
                    if (violation.extension) {
                        logEmbed.fields.push({
                            name: 'Blocked Extension',
                            value: `.${violation.extension}`,
                            inline: true
                        });
                    }
                    
                    if (violation.fileSize && violation.maxSize) {
                        logEmbed.fields.push({
                            name: 'File Size',
                            value: `${this.formatFileSize(violation.fileSize)} (limit: ${this.formatFileSize(violation.maxSize)})`,
                            inline: true
                        });
                    }
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }
            
            console.log(`Rule violation in ${message.guild.name}#${message.channel.name} by ${message.author.tag}: ${violation.type}`);
            
        } catch (error) {
            console.error('Error handling rule violation:', error);
        }
    }

    getRuleTypeDisplay(type) {
        const displayMap = {
            // Requirement rules
            'must_contain_audio': 'Must Contain Audio',
            'must_contain_image': 'Must Contain Image',
            'must_contain_video': 'Must Contain Video',
            'must_contain_file': 'Must Contain File',
            
            // Blocking rules
            'block_audio': 'Block Audio Files',
            'block_images': 'Block Images',
            'block_videos': 'Block Videos',
            'block_all_files': 'Block All Files',
            'block_file_extensions': 'Block File Extensions',
            'block_large_files': 'Block Large Files',
            
            // Text/content rules
            'blocked_domains': 'Blocked Domains',
            'required_text': 'Required Text',
            'blocked_text': 'Blocked Text',
            'min_length': 'Minimum Length',
            'max_length': 'Maximum Length'
        };
        return displayMap[type] || type;
    }

    getActionDisplay(action) {
        const displayMap = {
            'delete': 'Delete Message',
            'dm': 'Send DM',
            'delete_and_dm': 'Delete Message & Send DM'
        };
        return displayMap[action] || action;
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
        id: 'channel-rules',
        name: 'Channel Rules',
        description: 'Set up automated rules for channels with custom conditions and actions',
        icon: '⚖️',
        version: '1.2.0',
        
        // Plugin defines its own targets
        containerId: 'channelRulesPluginContainer',
        pageId: 'channel-rules',
        navIcon: '⚖️',
        
        // Complete HTML and script
        html: `
            <div class="plugin-container">
                <div class="plugin-header">
                    <h3><span class="plugin-icon">⚖️</span> Channel Rules</h3>
                    <p>Set up automated rules for channels with custom conditions and actions</p>
                </div>
                
                <form id="channelRulesForm">
                    <div class="form-group">
                        <label for="rulesServerSelect">Server</label>
                        <select id="rulesServerSelect" required>
                            <option value="">Select a server...</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="rulesChannelSelect">Channel</label>
                        <select id="rulesChannelSelect" required disabled>
                            <option value="">Select a channel...</option>
                        </select>
                    </div>
                    
                    <div id="channelRulesSettings" style="display: none;">
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="rulesEnabled" style="margin-right: 8px;">
                                Enable Rules for This Channel
                            </label>
                        </div>
                        
                        <div class="form-group">
                            <label for="rulesLogChannelSelect">Log Channel (Optional)</label>
                            <select id="rulesLogChannelSelect">
                                <option value="">Select a channel for violation logs...</option>
                            </select>
                            <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                Choose where rule violation logs will be sent
                            </small>
                        </div>
                        
                        <div class="form-group">
                            <label>Channel Rules</label>
                            <div id="rulesList" style="min-height: 100px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; margin-bottom: 10px;">
                                <div id="noRulesMessage" style="opacity: 0.6; text-align: center; padding: 20px;">
                                    No rules configured for this channel
                                </div>
                            </div>
                            
                            <button type="button" id="addRuleBtn" class="glass-btn" style="width: 100%;">
                                + Add New Rule
                            </button>
                        </div>
                        
                        <div class="form-group">
                            <button type="button" id="saveChannelRules" class="btn-primary">
                                <span class="btn-text">Save Rules</span>
                                <span class="btn-loader" style="display: none;">Saving...</span>
                            </button>
                            
                            <button type="button" id="deleteChannelRules" class="glass-btn" style="margin-left: 10px;">
                                Delete All Rules
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <!-- Rule Creation Modal -->
            <div id="ruleModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; justify-content: center; align-items: center;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); border-radius: 15px; padding: 2rem; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.2);">
                    <h3 style="margin-bottom: 1rem; color: white;">Create New Rule</h3>
                    
                    <div class="form-group">
                        <label for="ruleType">Rule Type</label>
                        <select id="ruleType" class="form-control">
                            <option value="">Select rule type...</option>
                            <optgroup label="File Requirements">
                                <option value="must_contain_audio">Must Contain Audio File</option>
                                <option value="must_contain_image">Must Contain Image</option>
                                <option value="must_contain_video">Must Contain Video</option>
                                <option value="must_contain_file">Must Contain Any File</option>
                            </optgroup>
                            <optgroup label="File Blocking">
                                <option value="block_audio">Block Audio Files</option>
                                <option value="block_images">Block Images</option>
                                <option value="block_videos">Block Videos</option>
                                <option value="block_all_files">Block All File Attachments</option>
                                <option value="block_file_extensions">Block Specific File Extensions</option>
                                <option value="block_large_files">Block Large Files</option>
                            </optgroup>
                            <optgroup label="Content Rules">
                                <option value="blocked_domains">Block Specific Domains</option>
                                <option value="required_text">Require Specific Text</option>
                                <option value="blocked_text">Block Specific Text</option>
                                <option value="min_length">Minimum Message Length</option>
                                <option value="max_length">Maximum Message Length</option>
                            </optgroup>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="ruleAction">Action When Rule is Violated</label>
                        <select id="ruleAction" class="form-control">
                            <option value="delete">Delete Message Only</option>
                            <option value="dm">Send DM to User Only</option>
                            <option value="delete_and_dm">Delete Message & Send DM</option>
                        </select>
                    </div>
                    
                    <!-- NEW: Role Conditions Section -->
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="enableRoleConditions" style="margin-right: 8px;">
                            Enable Role Conditions
                        </label>
                        <small style="opacity: 0.7; display: block; margin-top: 4px;">
                            Only apply this rule to users with specific roles
                        </small>
                    </div>
                    
                    <div id="roleConditionsConfig" style="display: none;">
                        <div class="form-group">
                            <label for="requiredRolesSelect">Apply Rule Only To These Roles</label>
                            <select id="requiredRolesSelect" class="form-control" multiple style="height: 100px;">
                                <option value="">Loading roles...</option>
                            </select>
                            <div id="selectedRequiredRoles" style="margin-top: 8px;"></div>
                            <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                Hold Ctrl/Cmd to select multiple roles. Rule only applies to users with these roles. Leave empty to apply to all users.
                            </small>
                        </div>
                        
                        <div class="form-group">
                            <label for="exemptRolesSelect">Exempt Roles (Bypass This Rule)</label>
                            <select id="exemptRolesSelect" class="form-control" multiple style="height: 100px;">
                                <option value="">Loading roles...</option>
                            </select>
                            <div id="selectedExemptRoles" style="margin-top: 8px;"></div>
                            <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                Hold Ctrl/Cmd to select multiple roles. Users with these roles will bypass this rule completely.
                            </small>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="customMessage">Custom Message (Optional)</label>
                        <textarea id="customMessage" class="form-control" rows="3" placeholder="Custom message to send to user when rule is violated..."></textarea>
                    </div>
                    
                    <!-- Dynamic rule configuration areas -->
                    <div id="domainsConfig" style="display: none;" class="form-group">
                        <label>Blocked Domains</label>
                        <input type="text" id="domainInput" class="form-control" placeholder="Enter domain (e.g., youtube.com)" style="margin-bottom: 0.5rem;">
                        <button type="button" id="addDomainBtn" class="glass-btn">Add Domain</button>
                        <div id="domainsList" style="margin-top: 0.5rem;"></div>
                    </div>
                    
                    <div id="textsConfig" style="display: none;" class="form-group">
                        <label id="textsLabel">Text Phrases</label>
                        <input type="text" id="textInput" class="form-control" placeholder="Enter text phrase..." style="margin-bottom: 0.5rem;">
                        <button type="button" id="addTextBtn" class="glass-btn">Add Text</button>
                        <div id="textsList" style="margin-top: 0.5rem;"></div>
                    </div>
                    
                    <div id="extensionsConfig" style="display: none;" class="form-group">
                        <label>Blocked File Extensions</label>
                        <input type="text" id="extensionInput" class="form-control" placeholder="Enter extension (e.g., exe, zip, rar)" style="margin-bottom: 0.5rem;">
                        <button type="button" id="addExtensionBtn" class="glass-btn">Add Extension</button>
                        <div id="extensionsList" style="margin-top: 0.5rem;"></div>
                        <small style="opacity: 0.7; display: block; margin-top: 4px;">
                            Enter file extensions without the dot (e.g., "exe" not ".exe")
                        </small>
                    </div>
                    
                    <div id="fileSizeConfig" style="display: none;" class="form-group">
                        <label for="maxFileSize">Maximum File Size</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <input type="number" id="maxFileSize" class="form-control" min="1" max="25" placeholder="Size" style="flex: 1;">
                            <select id="fileSizeUnit" class="form-control" style="flex: 0 0 auto; width: auto;">
                                <option value="KB">KB</option>
                                <option value="MB" selected>MB</option>
                            </select>
                        </div>
                        <small style="opacity: 0.7; display: block; margin-top: 4px;">
                            Files larger than this size will be blocked
                        </small>
                    </div>
                    
                    <div id="lengthConfig" style="display: none;" class="form-group">
                        <label for="lengthValue" id="lengthLabel">Length</label>
                        <input type="number" id="lengthValue" class="form-control" min="1" max="2000" placeholder="Enter length...">
                    </div>
                    
                    <div style="display: flex; gap: 10px; margin-top: 1.5rem;">
                        <button type="button" id="saveRule" class="btn-primary">Save Rule</button>
                        <button type="button" id="cancelRule" class="glass-btn">Cancel</button>
                    </div>
                </div>
            </div>
        `,
        script: `
            console.log('Loading enhanced channel rules plugin...');
            
            // Wrap in IIFE to avoid variable conflicts
            (function() {
                const rulesServerSelect = document.getElementById('rulesServerSelect');
                const rulesChannelSelect = document.getElementById('rulesChannelSelect');
                const rulesLogChannelSelect = document.getElementById('rulesLogChannelSelect');
                const channelRulesSettings = document.getElementById('channelRulesSettings');
                const rulesEnabled = document.getElementById('rulesEnabled');
                const rulesList = document.getElementById('rulesList');
                const noRulesMessage = document.getElementById('noRulesMessage');
                const addRuleBtn = document.getElementById('addRuleBtn');
                const saveChannelRules = document.getElementById('saveChannelRules');
                const deleteChannelRules = document.getElementById('deleteChannelRules');
                const btnText = saveChannelRules ? saveChannelRules.querySelector('.btn-text') : null;
                const btnLoader = saveChannelRules ? saveChannelRules.querySelector('.btn-loader') : null;
                
                // Modal elements
                const ruleModal = document.getElementById('ruleModal');
                const ruleType = document.getElementById('ruleType');
                const ruleAction = document.getElementById('ruleAction');
                const customMessage = document.getElementById('customMessage');
                const saveRule = document.getElementById('saveRule');
                const cancelRule = document.getElementById('cancelRule');
                
                // NEW: Role condition elements
                const enableRoleConditions = document.getElementById('enableRoleConditions');
                const roleConditionsConfig = document.getElementById('roleConditionsConfig');
                const requiredRolesSelect = document.getElementById('requiredRolesSelect');
                const exemptRolesSelect = document.getElementById('exemptRolesSelect');
                const selectedRequiredRoles = document.getElementById('selectedRequiredRoles');
                const selectedExemptRoles = document.getElementById('selectedExemptRoles');
                
                // Dynamic config elements
                const domainsConfig = document.getElementById('domainsConfig');
                const textsConfig = document.getElementById('textsConfig');
                const extensionsConfig = document.getElementById('extensionsConfig');
                const fileSizeConfig = document.getElementById('fileSizeConfig');
                const lengthConfig = document.getElementById('lengthConfig');
                
                const domainInput = document.getElementById('domainInput');
                const addDomainBtn = document.getElementById('addDomainBtn');
                const domainsList = document.getElementById('domainsList');
                
                const textInput = document.getElementById('textInput');
                const addTextBtn = document.getElementById('addTextBtn');
                const textsList = document.getElementById('textsList');
                const textsLabel = document.getElementById('textsLabel');
                
                const extensionInput = document.getElementById('extensionInput');
                const addExtensionBtn = document.getElementById('addExtensionBtn');
                const extensionsList = document.getElementById('extensionsList');
                
                const maxFileSize = document.getElementById('maxFileSize');
                const fileSizeUnit = document.getElementById('fileSizeUnit');
                
                const lengthValue = document.getElementById('lengthValue');
                const lengthLabel = document.getElementById('lengthLabel');
                
                let currentServerId = null;
                let currentChannelId = null;
                let currentRules = [];
                let tempDomains = [];
                let tempTexts = [];
                let tempExtensions = [];
                let editingRuleIndex = -1;
                let serverRoles = []; // NEW: Store server roles
                let selectedRequiredRoleIds = []; // NEW: Track selected required roles
                let selectedExemptRoleIds = []; // NEW: Track selected exempt roles
                
                if (rulesServerSelect) {
                    loadRulesServers();
                    
                    rulesServerSelect.addEventListener('change', function() {
                        const serverId = this.value;
                        currentServerId = serverId;
                        if (serverId) {
                            loadRulesChannels(serverId);
                            loadServerRoles(serverId); // NEW: Load roles when server changes
                            if (rulesChannelSelect) rulesChannelSelect.disabled = false;
                        } else {
                            if (rulesChannelSelect) {
                                rulesChannelSelect.disabled = true;
                                rulesChannelSelect.innerHTML = '<option value="">Select a channel...</option>';
                            }
                            if (channelRulesSettings) channelRulesSettings.style.display = 'none';
                            serverRoles = [];
                        }
                    });
                }
                
                if (rulesChannelSelect) {
                    rulesChannelSelect.addEventListener('change', function() {
                        const channelId = this.value;
                        currentChannelId = channelId;
                        if (channelId && currentServerId) {
                            loadChannelRules(currentServerId, channelId);
                            loadRulesLogChannels(currentServerId);
                            if (channelRulesSettings) channelRulesSettings.style.display = 'block';
                        } else {
                            if (channelRulesSettings) channelRulesSettings.style.display = 'none';
                        }
                    });
                }
                
                if (addRuleBtn) {
                    addRuleBtn.addEventListener('click', function() {
                        openRuleModal();
                    });
                }
                
                if (saveChannelRules) {
                    saveChannelRules.addEventListener('click', saveRules);
                }
                
                if (deleteChannelRules) {
                    deleteChannelRules.addEventListener('click', function() {
                        if (confirm('Are you sure you want to delete all rules for this channel?')) {
                            deleteAllRules();
                        }
                    });
                }
                
                // Modal event listeners
                if (ruleType) {
                    ruleType.addEventListener('change', function() {
                        updateRuleConfig(this.value);
                    });
                }
                
                if (saveRule) {
                    saveRule.addEventListener('click', function() {
                        saveCurrentRule();
                    });
                }
                
                if (cancelRule) {
                    cancelRule.addEventListener('click', function() {
                        closeRuleModal();
                    });
                }
                
                // NEW: Role conditions toggle
                if (enableRoleConditions) {
                    enableRoleConditions.addEventListener('change', function() {
                        if (roleConditionsConfig) {
                            roleConditionsConfig.style.display = this.checked ? 'block' : 'none';
                        }
                        if (this.checked && serverRoles.length === 0 && currentServerId) {
                            loadServerRoles(currentServerId);
                        }
                    });
                }
                
                // NEW: Role selection handlers
                if (requiredRolesSelect) {
                    requiredRolesSelect.addEventListener('change', function() {
                        selectedRequiredRoleIds = Array.from(this.selectedOptions).map(option => option.value);
                        displaySelectedRoles(selectedRequiredRoles, selectedRequiredRoleIds, 'required');
                    });
                }
                
                if (exemptRolesSelect) {
                    exemptRolesSelect.addEventListener('change', function() {
                        selectedExemptRoleIds = Array.from(this.selectedOptions).map(option => option.value);
                        displaySelectedRoles(selectedExemptRoles, selectedExemptRoleIds, 'exempt');
                    });
                }
                
                // Domain management
                if (addDomainBtn) {
                    addDomainBtn.addEventListener('click', addDomain);
                }
                
                if (domainInput) {
                    domainInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            addDomain();
                        }
                    });
                }
                
                // Text management
                if (addTextBtn) {
                    addTextBtn.addEventListener('click', addText);
                }
                
                if (textInput) {
                    textInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            addText();
                        }
                    });
                }
                
                // Extension management
                if (addExtensionBtn) {
                    addExtensionBtn.addEventListener('click', addExtension);
                }
                
                if (extensionInput) {
                    extensionInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            addExtension();
                        }
                    });
                }
                
                // Close modal when clicking outside
                if (ruleModal) {
                    ruleModal.addEventListener('click', function(e) {
                        if (e.target === ruleModal) {
                            closeRuleModal();
                        }
                    });
                }
                
                async function loadRulesServers() {
                    try {
                        const response = await fetch('/api/servers');
                        const servers = await response.json();
                        
                        rulesServerSelect.innerHTML = '<option value="">Select a server...</option>';
                        servers.forEach(server => {
                            const option = document.createElement('option');
                            option.value = server.id;
                            option.textContent = server.name;
                            rulesServerSelect.appendChild(option);
                        });
                    } catch (error) {
                        console.error('Error loading servers:', error);
                        if (window.showNotification) {
                            window.showNotification('Error loading servers', 'error');
                        }
                    }
                }
                
                async function loadRulesChannels(serverId) {
                    try {
                        rulesChannelSelect.innerHTML = '<option value="">Loading...</option>';
                        const response = await fetch(\`/api/channels/\${serverId}\`);
                        const channels = await response.json();
                        
                        rulesChannelSelect.innerHTML = '<option value="">Select a channel...</option>';
                        channels.forEach(channel => {
                            const option = document.createElement('option');
                            option.value = channel.id;
                            option.textContent = \`# \${channel.name}\`;
                            rulesChannelSelect.appendChild(option);
                        });
                    } catch (error) {
                        console.error('Error loading channels:', error);
                        rulesChannelSelect.innerHTML = '<option value="">Error loading channels</option>';
                    }
                }
                
                async function loadRulesLogChannels(serverId) {
                    try {
                        const response = await fetch(\`/api/channels/\${serverId}\`);
                        const channels = await response.json();
                        
                        rulesLogChannelSelect.innerHTML = '<option value="">Select a channel for violation logs...</option>';
                        channels.forEach(channel => {
                            const option = document.createElement('option');
                            option.value = channel.id;
                            option.textContent = \`# \${channel.name}\`;
                            rulesLogChannelSelect.appendChild(option);
                        });
                    } catch (error) {
                        console.error('Error loading log channels:', error);
                    }
                }
                
                // NEW: Load server roles
                async function loadServerRoles(serverId) {
                    try {
                        const response = await fetch(\`/api/plugins/channelrules/roles/\${serverId}\`);
                        const roles = await response.json();
                        
                        serverRoles = roles;
                        populateRoleSelects();
                    } catch (error) {
                        console.error('Error loading server roles:', error);
                        if (window.showNotification) {
                            window.showNotification('Error loading server roles', 'error');
                        }
                    }
                }
                
                // NEW: Populate role select elements
                function populateRoleSelects() {
                    if (requiredRolesSelect) {
                        requiredRolesSelect.innerHTML = '';
                        serverRoles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role.id;
                            option.textContent = role.name;
                            option.style.color = role.color ? \`#\${role.color.toString(16).padStart(6, '0')}\` : '#ffffff';
                            requiredRolesSelect.appendChild(option);
                        });
                    }
                    
                    if (exemptRolesSelect) {
                        exemptRolesSelect.innerHTML = '';
                        serverRoles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role.id;
                            option.textContent = role.name;
                            option.style.color = role.color ? \`#\${role.color.toString(16).padStart(6, '0')}\` : '#ffffff';
                            exemptRolesSelect.appendChild(option);
                        });
                    }
                }
                
                // NEW: Display selected roles as badges
                function displaySelectedRoles(container, roleIds, type) {
                    if (!container) return;
                    
                    container.innerHTML = '';
                    
                    roleIds.forEach(roleId => {
                        const role = serverRoles.find(r => r.id === roleId);
                        if (role) {
                            const badge = document.createElement('span');
                            badge.style.cssText = \`
                                display: inline-block;
                                background: rgba(255,255,255,0.1);
                                color: \${role.color ? \`#\${role.color.toString(16).padStart(6, '0')}\` : '#ffffff'};
                                padding: 4px 8px;
                                margin: 2px;
                                border-radius: 12px;
                                font-size: 0.8rem;
                                border: 1px solid \${role.color ? \`#\${role.color.toString(16).padStart(6, '0')}\` : 'rgba(255,255,255,0.3)'};
                            \`;
                            badge.textContent = role.name;
                            container.appendChild(badge);
                        }
                    });
                }
                
                async function loadChannelRules(serverId, channelId) {
                    try {
                        const response = await fetch(\`/api/plugins/channelrules/rules/\${serverId}/\${channelId}\`);
                        const rules = await response.json();
                        
                        if (rulesEnabled) rulesEnabled.checked = rules.enabled || false;
                        if (rulesLogChannelSelect) rulesLogChannelSelect.value = rules.logChannelId || '';
                        
                        currentRules = rules.rules || [];
                        displayRules();
                    } catch (error) {
                        console.error('Error loading channel rules:', error);
                        if (window.showNotification) {
                            window.showNotification('Error loading channel rules', 'error');
                        }
                    }
                }
                
                function displayRules() {
                    if (!rulesList) return;
                    
                    if (currentRules.length === 0) {
                        rulesList.innerHTML = '<div style="opacity: 0.6; text-align: center; padding: 20px;">No rules configured for this channel</div>';
                        return;
                    }
                    
                    rulesList.innerHTML = '';
                    
                    currentRules.forEach((rule, index) => {
                        const ruleElement = document.createElement('div');
                        ruleElement.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; border-left: 4px solid #7289da;';
                        
                        const ruleInfo = getRuleDisplayInfo(rule);
                        
                        // NEW: Add role condition display
                        let roleConditionText = '';
                        if (rule.roleConditions) {
                            const conditions = [];
                            if (rule.roleConditions.requiredRoles?.length > 0) {
                                const roleNames = rule.roleConditions.requiredRoles.map(roleId => {
                                    const role = serverRoles.find(r => r.id === roleId);
                                    return role ? role.name : 'Unknown Role';
                                });
                                conditions.push(\`Applies to: \${roleNames.join(', ')}\`);
                            }
                            if (rule.roleConditions.exemptRoles?.length > 0) {
                                const roleNames = rule.roleConditions.exemptRoles.map(roleId => {
                                    const role = serverRoles.find(r => r.id === roleId);
                                    return role ? role.name : 'Unknown Role';
                                });
                                conditions.push(\`Exempt: \${roleNames.join(', ')}\`);
                            }
                            if (conditions.length > 0) {
                                roleConditionText = \`<div style="font-size: 0.8rem; opacity: 0.7; margin-top: 2px; color: #ffa500;">\${conditions.join(' | ')}</div>\`;
                            }
                        }
                        
                        ruleElement.innerHTML = \`
                            <div>
                                <div style="font-weight: 600; margin-bottom: 4px;">\${ruleInfo.title}</div>
                                <div style="font-size: 0.9rem; opacity: 0.8;">\${ruleInfo.description}</div>
                                <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 2px;">Action: \${getActionDisplay(rule.action)}</div>
                                \${roleConditionText}
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <button type="button" onclick="window.editChannelRule(\${index})" class="glass-btn-small">Edit</button>
                                <button type="button" onclick="window.removeChannelRule(\${index})" class="glass-btn-small">Remove</button>
                            </div>
                        \`;
                        rulesList.appendChild(ruleElement);
                    });
                }
                
                function getRuleDisplayInfo(rule) {
                    const typeDisplays = {
                        // File requirement rules
                        'must_contain_audio': { title: 'Must Contain Audio', description: 'Messages must include audio files' },
                        'must_contain_image': { title: 'Must Contain Image', description: 'Messages must include image files' },
                        'must_contain_video': { title: 'Must Contain Video', description: 'Messages must include video files' },
                        'must_contain_file': { title: 'Must Contain File', description: 'Messages must include any file attachment' },
                        
                        // File blocking rules
                        'block_audio': { title: 'Block Audio', description: 'Audio files are blocked' },
                        'block_images': { title: 'Block Images', description: 'Image files are blocked' },
                        'block_videos': { title: 'Block Videos', description: 'Video files are blocked' },
                        'block_all_files': { title: 'Block All Files', description: 'All file attachments are blocked' },
                        'block_file_extensions': { title: 'Block Extensions', description: \`Blocked: .\${(rule.extensions || []).join(', .')}\` },
                        'block_large_files': { title: 'Block Large Files', description: \`Files over \${formatFileSize(rule.maxSize || 10485760)} are blocked\` },
                        
                        // Content rules
                        'blocked_domains': { title: 'Blocked Domains', description: \`Blocked: \${(rule.domains || []).join(', ')}\` },
                        'required_text': { title: 'Required Text', description: \`Must contain: \${(rule.texts || []).join(', ')}\` },
                        'blocked_text': { title: 'Blocked Text', description: \`Cannot contain: \${(rule.texts || []).join(', ')}\` },
                        'min_length': { title: 'Minimum Length', description: \`Messages must be at least \${rule.length || 0} characters\` },
                        'max_length': { title: 'Maximum Length', description: \`Messages must be no more than \${rule.length || 2000} characters\` }
                    };
                    
                    return typeDisplays[rule.type] || { title: rule.type, description: 'Custom rule' };
                }
                
                function getActionDisplay(action) {
                    const displayMap = {
                        'delete': 'Delete Message',
                        'dm': 'Send DM',
                        'delete_and_dm': 'Delete & DM'
                    };
                    return displayMap[action] || action;
                }
                
                function formatFileSize(bytes) {
                    if (bytes === 0) return '0 Bytes';
                    const k = 1024;
                    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                }
                
                window.editChannelRule = function(index) {
                    editingRuleIndex = index;
                    const rule = currentRules[index];
                    
                    if (ruleType) ruleType.value = rule.type;
                    if (ruleAction) ruleAction.value = rule.action;
                    if (customMessage) customMessage.value = rule.customMessage || '';
                    
                    // NEW: Load role conditions
                    if (rule.roleConditions) {
                        if (enableRoleConditions) enableRoleConditions.checked = true;
                        if (roleConditionsConfig) roleConditionsConfig.style.display = 'block';
                        
                        selectedRequiredRoleIds = rule.roleConditions.requiredRoles || [];
                        selectedExemptRoleIds = rule.roleConditions.exemptRoles || [];
                        
                        // Set selected options in multi-selects
                        if (requiredRolesSelect) {
                            Array.from(requiredRolesSelect.options).forEach(option => {
                                option.selected = selectedRequiredRoleIds.includes(option.value);
                            });
                        }
                        
                        if (exemptRolesSelect) {
                            Array.from(exemptRolesSelect.options).forEach(option => {
                                option.selected = selectedExemptRoleIds.includes(option.value);
                            });
                        }
                        
                        displaySelectedRoles(selectedRequiredRoles, selectedRequiredRoleIds, 'required');
                        displaySelectedRoles(selectedExemptRoles, selectedExemptRoleIds, 'exempt');
                    } else {
                        if (enableRoleConditions) enableRoleConditions.checked = false;
                        if (roleConditionsConfig) roleConditionsConfig.style.display = 'none';
                        selectedRequiredRoleIds = [];
                        selectedExemptRoleIds = [];
                    }
                    
                    updateRuleConfig(rule.type);
                    
                    // Populate specific rule data
                    if (rule.type === 'blocked_domains' && rule.domains) {
                        tempDomains = [...rule.domains];
                        displayDomains();
                    }
                    
                    if ((rule.type === 'required_text' || rule.type === 'blocked_text') && rule.texts) {
                        tempTexts = [...rule.texts];
                        displayTexts();
                    }
                    
                    if (rule.type === 'block_file_extensions' && rule.extensions) {
                        tempExtensions = [...rule.extensions];
                        displayExtensions();
                    }
                    
                    if (rule.type === 'block_large_files' && rule.maxSize) {
                        const sizeInMB = rule.maxSize / (1024 * 1024);
                        if (maxFileSize) maxFileSize.value = sizeInMB;
                        if (fileSizeUnit) fileSizeUnit.value = 'MB';
                    }
                    
                    if ((rule.type === 'min_length' || rule.type === 'max_length') && lengthValue) {
                        lengthValue.value = rule.length || '';
                    }
                    
                    openRuleModal();
                };
                
                window.removeChannelRule = function(index) {
                    if (confirm('Are you sure you want to remove this rule?')) {
                        currentRules.splice(index, 1);
                        displayRules();
                    }
                };
                
                function openRuleModal() {
                    if (ruleModal) {
                        ruleModal.style.display = 'flex';
                        
                        if (editingRuleIndex === -1) {
                            // Reset form for new rule
                            if (ruleType) ruleType.value = '';
                            if (ruleAction) ruleAction.value = 'delete_and_dm';
                            if (customMessage) customMessage.value = '';
                            if (enableRoleConditions) enableRoleConditions.checked = false;
                            if (roleConditionsConfig) roleConditionsConfig.style.display = 'none';
                            
                            tempDomains = [];
                            tempTexts = [];
                            tempExtensions = [];
                            selectedRequiredRoleIds = [];
                            selectedExemptRoleIds = [];
                            
                            if (maxFileSize) maxFileSize.value = '';
                            if (fileSizeUnit) fileSizeUnit.value = 'MB';
                            updateRuleConfig('');
                            
                            // Clear role selections
                            if (requiredRolesSelect) {
                                Array.from(requiredRolesSelect.options).forEach(option => option.selected = false);
                            }
                            if (exemptRolesSelect) {
                                Array.from(exemptRolesSelect.options).forEach(option => option.selected = false);
                            }
                            if (selectedRequiredRoles) selectedRequiredRoles.innerHTML = '';
                            if (selectedExemptRoles) selectedExemptRoles.innerHTML = '';
                        }
                        
                        // Load roles if not already loaded
                        if (serverRoles.length === 0 && currentServerId) {
                            loadServerRoles(currentServerId);
                        }
                    }
                }
                
                function closeRuleModal() {
                    if (ruleModal) {
                        ruleModal.style.display = 'none';
                        editingRuleIndex = -1;
                    }
                }
                
                function updateRuleConfig(type) {
                    // Hide all config sections
                    if (domainsConfig) domainsConfig.style.display = 'none';
                    if (textsConfig) textsConfig.style.display = 'none';
                    if (extensionsConfig) extensionsConfig.style.display = 'none';
                    if (fileSizeConfig) fileSizeConfig.style.display = 'none';
                    if (lengthConfig) lengthConfig.style.display = 'none';
                    
                    // Show relevant config section
                    switch (type) {
                        case 'blocked_domains':
                            if (domainsConfig) domainsConfig.style.display = 'block';
                            displayDomains();
                            break;
                        case 'required_text':
                            if (textsConfig) {
                                textsConfig.style.display = 'block';
                                if (textsLabel) textsLabel.textContent = 'Required Text Phrases';
                            }
                            displayTexts();
                            break;
                        case 'blocked_text':
                            if (textsConfig) {
                                textsConfig.style.display = 'block';
                                if (textsLabel) textsLabel.textContent = 'Blocked Text Phrases';
                            }
                            displayTexts();
                            break;
                        case 'block_file_extensions':
                            if (extensionsConfig) extensionsConfig.style.display = 'block';
                            displayExtensions();
                            break;
                        case 'block_large_files':
                            if (fileSizeConfig) fileSizeConfig.style.display = 'block';
                            break;
                        case 'min_length':
                            if (lengthConfig) {
                                lengthConfig.style.display = 'block';
                                if (lengthLabel) lengthLabel.textContent = 'Minimum Length (characters)';
                            }
                            break;
                        case 'max_length':
                            if (lengthConfig) {
                                lengthConfig.style.display = 'block';
                                if (lengthLabel) lengthLabel.textContent = 'Maximum Length (characters)';
                            }
                            break;
                    }
                }
                
                function addDomain() {
                    const domain = domainInput ? domainInput.value.trim() : '';
                    if (domain && !tempDomains.includes(domain)) {
                        tempDomains.push(domain);
                        if (domainInput) domainInput.value = '';
                        displayDomains();
                    }
                }
                
                function displayDomains() {
                    if (!domainsList) return;
                    domainsList.innerHTML = '';
                    tempDomains.forEach((domain, index) => {
                        const domainElement = document.createElement('div');
                        domainElement.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.1); border-radius: 4px;';
                        domainElement.innerHTML = \`
                            <span>\${domain}</span>
                            <button type="button" onclick="window.removeTempDomain(\${index})" class="glass-btn-small">Remove</button>
                        \`;
                        domainsList.appendChild(domainElement);
                    });
                }
                
                function addText() {
                    const text = textInput ? textInput.value.trim() : '';
                    if (text && !tempTexts.includes(text)) {
                        tempTexts.push(text);
                        if (textInput) textInput.value = '';
                        displayTexts();
                    }
                }
                
                function displayTexts() {
                    if (!textsList) return;
                    textsList.innerHTML = '';
                    tempTexts.forEach((text, index) => {
                        const textElement = document.createElement('div');
                        textElement.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.1); border-radius: 4px;';
                        textElement.innerHTML = \`
                            <span>\${text}</span>
                            <button type="button" onclick="window.removeTempText(\${index})" class="glass-btn-small">Remove</button>
                        \`;
                        textsList.appendChild(textElement);
                    });
                }
                
                function addExtension() {
                    const extension = extensionInput ? extensionInput.value.trim().toLowerCase().replace('.', '') : '';
                    if (extension && !tempExtensions.includes(extension)) {
                        tempExtensions.push(extension);
                        if (extensionInput) extensionInput.value = '';
                        displayExtensions();
                    }
                }
                
                function displayExtensions() {
                    if (!extensionsList) return;
                    extensionsList.innerHTML = '';
                    tempExtensions.forEach((extension, index) => {
                        const extensionElement = document.createElement('div');
                        extensionElement.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.1); border-radius: 4px;';
                        extensionElement.innerHTML = \`
                            <span>.\${extension}</span>
                            <button type="button" onclick="window.removeTempExtension(\${index})" class="glass-btn-small">Remove</button>
                        \`;
                        extensionsList.appendChild(extensionElement);
                    });
                }
                
                window.removeTempDomain = function(index) {
                    tempDomains.splice(index, 1);
                    displayDomains();
                };
                
                window.removeTempText = function(index) {
                    tempTexts.splice(index, 1);
                    displayTexts();
                };
                
                window.removeTempExtension = function(index) {
                    tempExtensions.splice(index, 1);
                    displayExtensions();
                };
                
                function saveCurrentRule() {
                    const type = ruleType ? ruleType.value : '';
                    const action = ruleAction ? ruleAction.value : 'delete_and_dm';
                    const message = customMessage ? customMessage.value.trim() : '';
                    
                    if (!type) {
                        if (window.showNotification) {
                            window.showNotification('Please select a rule type', 'error');
                        }
                        return;
                    }
                    
                    const rule = {
                        type: type,
                        action: action,
                        customMessage: message || null
                    };
                    
                    // NEW: Add role conditions if enabled
                    if (enableRoleConditions && enableRoleConditions.checked) {
                        rule.roleConditions = {};
                        
                        if (selectedRequiredRoleIds.length > 0) {
                            rule.roleConditions.requiredRoles = [...selectedRequiredRoleIds];
                        }
                        
                        if (selectedExemptRoleIds.length > 0) {
                            rule.roleConditions.exemptRoles = [...selectedExemptRoleIds];
                        }
                        
                        // Only add roleConditions if at least one condition is set
                        if (!rule.roleConditions.requiredRoles && !rule.roleConditions.exemptRoles) {
                            delete rule.roleConditions;
                        }
                    }
                    
                    // Add type-specific data
                    switch (type) {
                        case 'blocked_domains':
                            if (tempDomains.length === 0) {
                                if (window.showNotification) {
                                    window.showNotification('Please add at least one domain', 'error');
                                }
                                return;
                            }
                            rule.domains = [...tempDomains];
                            break;
                        case 'required_text':
                        case 'blocked_text':
                            if (tempTexts.length === 0) {
                                if (window.showNotification) {
                                    window.showNotification('Please add at least one text phrase', 'error');
                                }
                                return;
                            }
                            rule.texts = [...tempTexts];
                            break;
                        case 'block_file_extensions':
                            if (tempExtensions.length === 0) {
                                if (window.showNotification) {
                                    window.showNotification('Please add at least one file extension', 'error');
                                }
                                return;
                            }
                            rule.extensions = [...tempExtensions];
                            break;
                        case 'block_large_files':
                            const size = maxFileSize ? parseFloat(maxFileSize.value) : 0;
                            const unit = fileSizeUnit ? fileSizeUnit.value : 'MB';
                            
                            if (!size || size <= 0) {
                                if (window.showNotification) {
                                    window.showNotification('Please enter a valid file size', 'error');
                                }
                                return;
                            }
                            
                            // Convert to bytes
                            const sizeInBytes = unit === 'KB' ? size * 1024 : size * 1024 * 1024;
                            rule.maxSize = sizeInBytes;
                            break;
                        case 'min_length':
                        case 'max_length':
                            const length = lengthValue ? parseInt(lengthValue.value) : 0;
                            if (!length || length < 1) {
                                if (window.showNotification) {
                                    window.showNotification('Please enter a valid length', 'error');
                                }
                                return;
                            }
                            rule.length = length;
                            break;
                    }
                    
                    if (editingRuleIndex >= 0) {
                        currentRules[editingRuleIndex] = rule;
                    } else {
                        currentRules.push(rule);
                    }
                    
                    displayRules();
                    closeRuleModal();
                    if (window.showNotification) {
                        window.showNotification('Rule saved successfully', 'success');
                    }
                }
                
                async function saveRules() {
                    if (!currentServerId || !currentChannelId) {
                        if (window.showNotification) {
                            window.showNotification('Please select a server and channel', 'error');
                        }
                        return;
                    }
                    
                    try {
                        if (btnText) btnText.style.display = 'none';
                        if (btnLoader) btnLoader.style.display = 'inline';
                        if (saveChannelRules) saveChannelRules.disabled = true;
                        
                        const settings = {
                            enabled: rulesEnabled ? rulesEnabled.checked : false,
                            rules: currentRules,
                            logChannelId: rulesLogChannelSelect ? rulesLogChannelSelect.value || null : null
                        };
                        
                        const response = await fetch(\`/api/plugins/channelrules/rules/\${currentServerId}/\${currentChannelId}\`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(settings)
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok) {
                            if (window.showNotification) {
                                window.showNotification('Channel rules saved successfully!', 'success');
                            }
                        } else {
                            throw new Error(result.error || 'Failed to save rules');
                        }
                    } catch (error) {
                        console.error('Error saving rules:', error);
                        if (window.showNotification) {
                            window.showNotification(error.message, 'error');
                        }
                    } finally {
                        if (btnText) btnText.style.display = 'inline';
                        if (btnLoader) btnLoader.style.display = 'none';
                        if (saveChannelRules) saveChannelRules.disabled = false;
                    }
                }
                
                async function deleteAllRules() {
                    if (!currentServerId || !currentChannelId) {
                        if (window.showNotification) {
                            window.showNotification('Please select a server and channel', 'error');
                        }
                        return;
                    }
                    
                    try {
                        const response = await fetch(\`/api/plugins/channelrules/rules/\${currentServerId}/\${currentChannelId}\`, {
                            method: 'DELETE'
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok) {
                            currentRules = [];
                            if (rulesEnabled) rulesEnabled.checked = false;
                            if (rulesLogChannelSelect) rulesLogChannelSelect.value = '';
                            displayRules();
                            if (window.showNotification) {
                                window.showNotification('All rules deleted successfully!', 'success');
                            }
                        } else {
                            throw new Error(result.error || 'Failed to delete rules');
                        }
                    } catch (error) {
                        console.error('Error deleting rules:', error);
                        if (window.showNotification) {
                            window.showNotification(error.message, 'error');
                        }
                    }
                }
            })();
            `
        };
    }
}

module.exports = ChannelRulesPlugin;