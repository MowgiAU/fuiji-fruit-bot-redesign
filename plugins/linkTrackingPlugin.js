const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LinkTrackingPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Link Tracking';
        this.description = 'Generate trackable links and monitor detailed click analytics';
        this.version = '2.1.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // Storage paths
        this.dataDir = './data';
        this.linksFile = './data/trackingLinks.json';
        this.analyticsFile = './data/linkAnalytics.json';
        
        // Ensure data directory exists
        this.ensureDataDirectory();
        
        // In-memory storage for fast lookups
        this.trackingLinks = this.loadTrackingLinks();
        this.analytics = this.loadAnalytics();
        
        this.setupRoutes();
        
        console.log('✅ Link Tracking Plugin v2.1 loaded and fixed for dashboard');
    }

    ensureDataDirectory() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
        } catch (error) {
            console.error('Error creating data directory:', error);
        }
    }

    // ============================================================================
    // DATA MANAGEMENT
    // ============================================================================

    loadTrackingLinks() {
        try {
            if (fs.existsSync(this.linksFile)) {
                return JSON.parse(fs.readFileSync(this.linksFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading tracking links:', error);
        }
        return {};
    }

    loadAnalytics() {
        try {
            if (fs.existsSync(this.analyticsFile)) {
                return JSON.parse(fs.readFileSync(this.analyticsFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
        return {};
    }

    saveTrackingLinks() {
        try {
            this.ensureDataDirectory();
            fs.writeFileSync(this.linksFile, JSON.stringify(this.trackingLinks, null, 2));
        } catch (error) {
            console.error('Error saving tracking links:', error);
        }
    }

    saveAnalytics() {
        try {
            this.ensureDataDirectory();
            fs.writeFileSync(this.analyticsFile, JSON.stringify(this.analytics, null, 2));
        } catch (error) {
            console.error('Error saving analytics:', error);
        }
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    generateShortCode() {
        let shortCode;
        do {
            shortCode = crypto.randomBytes(4).toString('hex');
        } while (this.trackingLinks[shortCode]); // Ensure uniqueness
        return shortCode;
    }

    isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    getClientIP(req) {
        return req.headers['x-forwarded-for']?.split(',')[0] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               'unknown';
    }

    getUserAgent(req) {
        return req.headers['user-agent'] || 'unknown';
    }

    getReferer(req) {
        return req.headers['referer'] || 'direct';
    }

    getClicksToday(shortCode) {
        const analytics = this.analytics[shortCode] || [];
        const today = new Date().toDateString();
        return analytics.filter(a => new Date(a.timestamp).toDateString() === today).length;
    }

    getLastClick(shortCode) {
        const analytics = this.analytics[shortCode] || [];
        if (analytics.length === 0) return null;
        return analytics[analytics.length - 1].timestamp;
    }

    // ============================================================================
    // API ROUTES
    // ============================================================================

    setupRoutes() {
        // Get all tracking links for a user
        this.app.get('/api/plugins/linktracking/links', this.ensureAuthenticated, (req, res) => {
            try {
                const userId = req.user.id;
                const userLinks = Object.entries(this.trackingLinks)
                    .filter(([_, link]) => link.createdBy === userId)
                    .map(([shortCode, link]) => ({
                        shortCode,
                        ...link,
                        clicks: this.analytics[shortCode] ? this.analytics[shortCode].length : 0,
                        clicksToday: this.getClicksToday(shortCode),
                        lastClick: this.getLastClick(shortCode)
                    }))
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                res.json(userLinks);
            } catch (error) {
                console.error('Error fetching links:', error);
                res.status(500).json({ error: 'Failed to fetch links' });
            }
        });

        // Create a new tracking link
        this.app.post('/api/plugins/linktracking/create', this.ensureAuthenticated, (req, res) => {
            try {
                const { originalUrl, customName, description } = req.body;
                const userId = req.user.id;

                // Validation
                if (!originalUrl || !originalUrl.trim()) {
                    return res.status(400).json({ error: 'Original URL is required' });
                }
                
                if (!customName || !customName.trim()) {
                    return res.status(400).json({ error: 'Custom name is required' });
                }

                const trimmedUrl = originalUrl.trim();
                const trimmedName = customName.trim();

                if (!this.isValidUrl(trimmedUrl)) {
                    return res.status(400).json({ error: 'Invalid URL format. Please include http:// or https://' });
                }

                // Check for duplicate custom names
                const existingLink = Object.entries(this.trackingLinks)
                    .find(([_, link]) => link.customName === trimmedName && link.createdBy === userId);

                if (existingLink) {
                    return res.status(400).json({ error: 'Custom name already exists' });
                }

                // Generate unique short code
                const shortCode = this.generateShortCode();

                // Create link object
                const linkData = {
                    shortCode,
                    originalUrl: trimmedUrl,
                    customName: trimmedName,
                    description: description ? description.trim() : '',
                    createdBy: userId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    active: true
                };

                this.trackingLinks[shortCode] = linkData;
                this.saveTrackingLinks();

                console.log(`✅ Created tracking link: ${shortCode} -> ${trimmedUrl}`);

                res.json({ 
                    success: true, 
                    shortCode,
                    trackingUrl: `${req.protocol}://${req.get('host')}/track/${shortCode}/${encodeURIComponent(trimmedName)}`,
                    message: 'Tracking link created successfully' 
                });

            } catch (error) {
                console.error('Error creating tracking link:', error);
                res.status(500).json({ error: 'Failed to create tracking link' });
            }
        });

        // Delete tracking link
        this.app.delete('/api/plugins/linktracking/delete/:shortCode', this.ensureAuthenticated, (req, res) => {
            try {
                const { shortCode } = req.params;
                const userId = req.user.id;

                const link = this.trackingLinks[shortCode];
                if (!link) {
                    return res.status(404).json({ error: 'Link not found' });
                }

                if (link.createdBy !== userId) {
                    return res.status(403).json({ error: 'Not authorized to delete this link' });
                }

                delete this.trackingLinks[shortCode];
                delete this.analytics[shortCode];

                this.saveTrackingLinks();
                this.saveAnalytics();

                console.log(`🗑️ Deleted tracking link: ${shortCode}`);

                res.json({ success: true, message: 'Link deleted successfully' });

            } catch (error) {
                console.error('Error deleting tracking link:', error);
                res.status(500).json({ error: 'Failed to delete tracking link' });
            }
        });

        // Get analytics for a specific link
        this.app.get('/api/plugins/linktracking/analytics/:shortCode', this.ensureAuthenticated, (req, res) => {
            try {
                const { shortCode } = req.params;
                const userId = req.user.id;

                const link = this.trackingLinks[shortCode];
                if (!link) {
                    return res.status(404).json({ error: 'Link not found' });
                }

                if (link.createdBy !== userId) {
                    return res.status(403).json({ error: 'Not authorized to view analytics for this link' });
                }

                const analytics = this.analytics[shortCode] || [];
                
                const analyticsData = {
                    link: {
                        shortCode,
                        customName: link.customName,
                        originalUrl: link.originalUrl,
                        description: link.description,
                        createdAt: link.createdAt,
                        active: link.active
                    },
                    stats: {
                        totalClicks: analytics.length,
                        clicksToday: this.getClicksToday(shortCode),
                        lastClick: this.getLastClick(shortCode)
                    },
                    recentClicks: analytics.slice(-10).reverse()
                };

                res.json(analyticsData);

            } catch (error) {
                console.error('Error fetching analytics:', error);
                res.status(500).json({ error: 'Failed to fetch analytics' });
            }
        });

        // Get overview stats
        this.app.get('/api/plugins/linktracking/overview', this.ensureAuthenticated, (req, res) => {
            try {
                const userId = req.user.id;
                const userLinks = Object.entries(this.trackingLinks)
                    .filter(([_, link]) => link.createdBy === userId);

                const overview = {
                    totalLinks: userLinks.length,
                    activeLinks: userLinks.filter(([_, link]) => link.active).length,
                    totalClicks: userLinks.reduce((sum, [code, _]) => {
                        return sum + (this.analytics[code] ? this.analytics[code].length : 0);
                    }, 0),
                    clicksToday: userLinks.reduce((sum, [code, _]) => {
                        return sum + this.getClicksToday(code);
                    }, 0)
                };

                res.json(overview);

            } catch (error) {
                console.error('Error fetching overview:', error);
                res.status(500).json({ error: 'Failed to fetch overview' });
            }
        });

        // Public tracking route
        this.app.get('/track/:shortCode/:customName?', (req, res) => {
            try {
                const { shortCode, customName } = req.params;

                const link = this.trackingLinks[shortCode];
                if (!link || !link.active) {
                    console.log(`❌ Link not found or inactive: ${shortCode}`);
                    return res.status(404).send('Link not found or inactive');
                }

                // Verify custom name if provided
                if (customName && link.customName !== decodeURIComponent(customName)) {
                    console.log(`❌ Custom name mismatch: ${shortCode}/${customName}`);
                    return res.status(404).send('Link not found or inactive');
                }

                // Record analytics
                const analyticsEntry = {
                    timestamp: new Date().toISOString(),
                    ip: this.getClientIP(req),
                    userAgent: this.getUserAgent(req),
                    referer: this.getReferer(req)
                };

                if (!this.analytics[shortCode]) {
                    this.analytics[shortCode] = [];
                }

                this.analytics[shortCode].push(analyticsEntry);
                this.saveAnalytics();

                console.log(`✅ Click tracked: ${shortCode} -> ${link.originalUrl}`);

                // Redirect to original URL
                res.redirect(link.originalUrl);

            } catch (error) {
                console.error('Error processing tracking click:', error);
                res.status(500).send('Internal server error');
            }
        });
    }

    // ============================================================================
    // FRONTEND COMPONENT
    // ============================================================================

    getFrontendComponent() {
        return {
            id: 'link-tracking',
            name: 'Link Tracking',
            description: 'Generate trackable links and monitor detailed click analytics',
            icon: '🔗',
            version: '2.1.0',
            containerId: 'linkTrackingPluginContainer',

            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🔗</span> Link Tracking v2.1</h3>
                        <p>Generate trackable links and monitor detailed click analytics</p>
                    </div>

                    <!-- Dashboard Integration Notice -->
                    <div class="server-sync-notice" style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">💡</span>
                            <div>
                                <strong>Personal Link Tracker</strong>
                                <div style="font-size: 14px; opacity: 0.8;">Track your links across all servers and external usage</div>
                            </div>
                        </div>
                    </div>

                    <!-- Overview Stats -->
                    <div class="stats-section" style="margin-bottom: 24px;">
                        <h4>📊 Overview</h4>
                        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div class="stat-card">
                                <div class="stat-value" id="totalLinksCount">0</div>
                                <div class="stat-label">Total Links</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="activeLinksCount">0</div>
                                <div class="stat-label">Active Links</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="totalClicksCount">0</div>
                                <div class="stat-label">Total Clicks</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value" id="clicksTodayCount">0</div>
                                <div class="stat-label">Clicks Today</div>
                            </div>
                        </div>
                    </div>

                    <!-- Create New Link Form -->
                    <form id="createLinkForm" class="settings-form">
                        <div class="settings-section">
                            <h4>🆕 Create New Link</h4>
                            
                            <div class="form-group">
                                <label for="originalUrl">Original URL *</label>
                                <input type="url" id="originalUrl" class="form-control" placeholder="https://example.com" required>
                                <small class="form-text">The URL you want to track</small>
                            </div>

                            <div class="form-group">
                                <label for="customName">Custom Name *</label>
                                <input type="text" id="customName" class="form-control" placeholder="my-awesome-link" required>
                                <small class="form-text">Used in the tracking URL (must be unique)</small>
                            </div>

                            <div class="form-group">
                                <label for="description">Description</label>
                                <input type="text" id="description" class="form-control" placeholder="Optional description">
                                <small class="form-text">Help you remember what this link is for</small>
                            </div>
                        </div>

                        <button type="submit" id="createLinkBtn" class="btn btn-primary">
                            <span class="btn-text">🔗 Create Link</span>
                            <span class="btn-loader" style="display: none;">⏳ Creating...</span>
                        </button>
                    </form>

                    <!-- Links List -->
                    <div class="links-section" style="margin-top: 32px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4>📋 Your Links</h4>
                            <button type="button" id="refreshLinksBtn" class="btn btn-secondary btn-sm">🔄 Refresh</button>
                        </div>
                        
                        <div id="linksContainer">
                            <div id="linksLoading" style="text-align: center; padding: 20px; opacity: 0.7;">
                                Loading your links...
                            </div>
                            <div id="linksList" style="display: none;"></div>
                            <div id="noLinksMessage" style="display: none; text-align: center; opacity: 0.7; padding: 40px;">
                                <div style="font-size: 24px; margin-bottom: 8px;">🔗</div>
                                <div>No links created yet</div>
                                <div style="font-size: 14px; margin-top: 4px;">Create your first tracking link above!</div>
                            </div>
                        </div>
                    </div>

                    <!-- Result Messages -->
                    <div id="linkTrackingResult" class="result-message" style="display: none;"></div>
                </div>
            `,
            
            script: `
                // Fixed Link Tracking Plugin Frontend Logic
                (function() {
                    console.log('🔗 Fixed Link Tracking Plugin: Initializing...');
                    
                    // Get DOM elements
                    const createLinkForm = document.getElementById('createLinkForm');
                    const originalUrl = document.getElementById('originalUrl');
                    const customName = document.getElementById('customName');
                    const description = document.getElementById('description');
                    const createLinkBtn = document.getElementById('createLinkBtn');
                    
                    // Stats elements
                    const totalLinksCount = document.getElementById('totalLinksCount');
                    const activeLinksCount = document.getElementById('activeLinksCount');
                    const totalClicksCount = document.getElementById('totalClicksCount');
                    const clicksTodayCount = document.getElementById('clicksTodayCount');
                    
                    // Links list elements
                    const refreshLinksBtn = document.getElementById('refreshLinksBtn');
                    const linksContainer = document.getElementById('linksContainer');
                    const linksLoading = document.getElementById('linksLoading');
                    const linksList = document.getElementById('linksList');
                    const noLinksMessage = document.getElementById('noLinksMessage');
                    
                    // Result message
                    const linkTrackingResult = document.getElementById('linkTrackingResult');
                    
                    // State variables
                    let currentLinks = [];
                    let currentOverview = {};
                    
                    // Initialize plugin
                    function initializeLinkTrackingPlugin() {
                        console.log('🔗 Initializing Link Tracking Plugin...');
                        setupEventListeners();
                        loadData();
                    }
                    
                    // Setup event listeners
                    function setupEventListeners() {
                        // Create link form
                        if (createLinkForm) {
                            createLinkForm.addEventListener('submit', handleCreateLink);
                        }
                        
                        // Refresh button
                        if (refreshLinksBtn) {
                            refreshLinksBtn.addEventListener('click', loadData);
                        }
                        
                        // Form validation
                        if (customName) {
                            customName.addEventListener('input', validateCustomName);
                        }
                    }
                    
                    // Load all data
                    async function loadData() {
                        try {
                            await Promise.all([
                                loadOverview(),
                                loadLinks()
                            ]);
                        } catch (error) {
                            console.error('Error loading data:', error);
                            showResult('Error loading data: ' + error.message, 'error');
                        }
                    }
                    
                    // Load overview stats
                    async function loadOverview() {
                        try {
                            const response = await fetch('/api/plugins/linktracking/overview');
                            if (!response.ok) throw new Error('Failed to load overview');
                            
                            currentOverview = await response.json();
                            displayOverview();
                        } catch (error) {
                            console.error('Error loading overview:', error);
                        }
                    }
                    
                    // Display overview stats
                    function displayOverview() {
                        if (totalLinksCount) totalLinksCount.textContent = currentOverview.totalLinks?.toLocaleString() || '0';
                        if (activeLinksCount) activeLinksCount.textContent = currentOverview.activeLinks?.toLocaleString() || '0';
                        if (totalClicksCount) totalClicksCount.textContent = currentOverview.totalClicks?.toLocaleString() || '0';
                        if (clicksTodayCount) clicksTodayCount.textContent = currentOverview.clicksToday?.toLocaleString() || '0';
                    }
                    
                    // Load links
                    async function loadLinks() {
                        try {
                            showLinksLoading(true);
                            
                            const response = await fetch('/api/plugins/linktracking/links');
                            if (!response.ok) throw new Error('Failed to load links');
                            
                            currentLinks = await response.json();
                            displayLinks();
                        } catch (error) {
                            console.error('Error loading links:', error);
                            showNoLinks();
                        } finally {
                            showLinksLoading(false);
                        }
                    }
                    
                    // Show/hide links loading
                    function showLinksLoading(show) {
                        if (linksLoading) linksLoading.style.display = show ? 'block' : 'none';
                        if (linksList) linksList.style.display = show ? 'none' : 'block';
                        if (noLinksMessage) noLinksMessage.style.display = 'none';
                    }
                    
                    // Display links
                    function displayLinks() {
                        if (!linksList || !currentLinks || currentLinks.length === 0) {
                            showNoLinks();
                            return;
                        }
                        
                        linksList.innerHTML = '';
                        linksList.style.display = 'block';
                        if (noLinksMessage) noLinksMessage.style.display = 'none';
                        
                        currentLinks.forEach(link => {
                            const linkElement = createLinkElement(link);
                            linksList.appendChild(linkElement);
                        });
                    }
                    
                    // Create link element
                    function createLinkElement(link) {
                        const linkElement = document.createElement('div');
                        linkElement.className = 'link-item';
                        linkElement.style.cssText = \`
                            background: rgba(255, 255, 255, 0.05);
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            border-radius: 8px;
                            padding: 20px;
                            margin-bottom: 16px;
                            transition: all 0.2s ease;
                        \`;
                        
                        const trackingUrl = \`\${window.location.origin}/track/\${link.shortCode}/\${encodeURIComponent(link.customName)}\`;
                        const lastClick = link.lastClick ? new Date(link.lastClick).toLocaleDateString() : 'Never';
                        
                        linkElement.innerHTML = \`
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                        <h5 style="margin: 0; color: #fff; font-size: 16px;">\${link.customName}</h5>
                                        <div style="background: rgba(34, 197, 94, 0.2); color: #10B981; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
                                            Active
                                        </div>
                                    </div>
                                    \${link.description ? \`<p style="margin: 0 0 8px 0; opacity: 0.8; font-size: 14px;">\${link.description}</p>\` : ''}
                                    <div style="font-size: 13px; opacity: 0.6; word-break: break-all;">
                                        → \${link.originalUrl}
                                    </div>
                                </div>
                                <div style="display: flex; gap: 8px; margin-left: 16px;">
                                    <button type="button" class="btn btn-secondary btn-sm" onclick="copyTrackingUrl('\${trackingUrl}')" title="Copy tracking URL">
                                        📋
                                    </button>
                                    <button type="button" class="btn btn-secondary btn-sm" onclick="viewAnalytics('\${link.shortCode}')" title="View analytics">
                                        📊
                                    </button>
                                    <button type="button" class="btn btn-danger btn-sm" onclick="deleteLink('\${link.shortCode}')" title="Delete link">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="background: rgba(255, 255, 255, 0.05); padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; flex: 1; margin-right: 12px;">
                                    \${trackingUrl}
                                </div>
                            </div>
                            
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">
                                <div style="text-align: center;">
                                    <div style="font-size: 18px; font-weight: bold; color: #3B82F6;">\${link.clicks}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">Total Clicks</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 18px; font-weight: bold; color: #10B981;">\${link.clicksToday}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">Today</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 12px; font-weight: bold; color: #F59E0B;">\${lastClick}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">Last Click</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 12px; font-weight: bold; color: #8B5CF6;">\${new Date(link.createdAt).toLocaleDateString()}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">Created</div>
                                </div>
                            </div>
                        \`;
                        
                        return linkElement;
                    }
                    
                    // Show no links message
                    function showNoLinks() {
                        if (linksList) linksList.style.display = 'none';
                        if (noLinksMessage) noLinksMessage.style.display = 'block';
                    }
                    
                    // Handle create link
                    async function handleCreateLink(e) {
                        e.preventDefault();
                        
                        const btnText = createLinkBtn?.querySelector('.btn-text');
                        const btnLoader = createLinkBtn?.querySelector('.btn-loader');
                        
                        try {
                            // Show loading state
                            if (btnText) btnText.style.display = 'none';
                            if (btnLoader) btnLoader.style.display = 'inline';
                            if (createLinkBtn) createLinkBtn.disabled = true;
                            
                            const formData = {
                                originalUrl: originalUrl?.value?.trim(),
                                customName: customName?.value?.trim(),
                                description: description?.value?.trim()
                            };
                            
                            if (!formData.originalUrl || !formData.customName) {
                                throw new Error('Original URL and Custom Name are required');
                            }
                            
                            const response = await fetch('/api/plugins/linktracking/create', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(formData)
                            });
                            
                            if (!response.ok) {
                                const error = await response.json();
                                throw new Error(error.error || 'Failed to create link');
                            }
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                showResult('Link created successfully! 🎉', 'success');
                                
                                // Clear form
                                if (createLinkForm) createLinkForm.reset();
                                
                                // Copy tracking URL to clipboard
                                try {
                                    await navigator.clipboard.writeText(result.trackingUrl);
                                    showResult('Link created and copied to clipboard! 📋', 'success');
                                } catch (clipboardError) {
                                    console.warn('Could not copy to clipboard:', clipboardError);
                                }
                                
                                // Refresh data
                                await loadData();
                                
                                if (window.dashboardAPI) {
                                    if (window.dashboardAPI.showNotification) {
                                        window.dashboardAPI.showNotification('Tracking link created successfully', 'success');
                                    }
                                    if (window.dashboardAPI.addLogEntry) {
                                        window.dashboardAPI.addLogEntry('success', \`Created tracking link: \${formData.customName}\`);
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to create link');
                            }
                            
                        } catch (error) {
                            console.error('Error creating link:', error);
                            showResult('Error: ' + error.message, 'error');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification(error.message, 'error');
                            }
                        } finally {
                            // Reset button state
                            if (btnText) btnText.style.display = 'inline';
                            if (btnLoader) btnLoader.style.display = 'none';
                            if (createLinkBtn) createLinkBtn.disabled = false;
                        }
                    }
                    
                    // Validate custom name
                    function validateCustomName() {
                        if (!customName) return;
                        
                        const value = customName.value.trim();
                        const isValid = /^[a-zA-Z0-9-_]+$/.test(value);
                        
                        if (value && !isValid) {
                            customName.setCustomValidity('Only letters, numbers, hyphens, and underscores allowed');
                        } else {
                            customName.setCustomValidity('');
                        }
                    }
                    
                    // Copy tracking URL to clipboard
                    async function copyTrackingUrl(url) {
                        try {
                            await navigator.clipboard.writeText(url);
                            showResult('Tracking URL copied to clipboard! 📋', 'success');
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('URL copied to clipboard', 'success');
                            }
                        } catch (error) {
                            console.error('Error copying to clipboard:', error);
                            showResult('Failed to copy URL to clipboard', 'error');
                        }
                    }
                    
                    // View analytics for a link
                    async function viewAnalytics(shortCode) {
                        try {
                            showResult('Loading analytics...', 'info');
                            
                            const response = await fetch(\`/api/plugins/linktracking/analytics/\${shortCode}\`);
                            if (!response.ok) throw new Error('Failed to load analytics');
                            
                            const analytics = await response.json();
                            
                            // Create a simple analytics display
                            const analyticsHtml = \`
                                <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 20px; margin-top: 16px;">
                                    <h5>📊 Analytics: \${analytics.link.customName}</h5>
                                    <p style="opacity: 0.8; margin-bottom: 16px;">Target: \${analytics.link.originalUrl}</p>
                                    
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px;">
                                        <div style="text-align: center; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                                            <div style="font-size: 18px; font-weight: bold; color: #3B82F6;">\${analytics.stats.totalClicks}</div>
                                            <div style="font-size: 12px; opacity: 0.7;">Total Clicks</div>
                                        </div>
                                        <div style="text-align: center; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                                            <div style="font-size: 18px; font-weight: bold; color: #10B981;">\${analytics.stats.clicksToday}</div>
                                            <div style="font-size: 12px; opacity: 0.7;">Today</div>
                                        </div>
                                    </div>
                                    
                                    \${analytics.recentClicks.length > 0 ? \`
                                        <h6>Recent Clicks</h6>
                                        <div style="background: rgba(255,255,255,0.02); border-radius: 6px; padding: 12px; max-height: 150px; overflow-y: auto;">
                                            \${analytics.recentClicks.slice(0, 5).map(click => \`
                                                <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                                    <span>\${new Date(click.timestamp).toLocaleString()}</span>
                                                    <span style="opacity: 0.7;">\${click.referer === 'direct' ? 'Direct' : 'Referrer'}</span>
                                                </div>
                                            \`).join('')}
                                        </div>
                                    \` : '<p style="opacity: 0.6; text-align: center;">No clicks yet</p>'}
                                    
                                    <button onclick="closeAnalytics()" class="btn btn-secondary btn-sm" style="margin-top: 12px;">
                                        ✕ Close Analytics
                                    </button>
                                </div>
                            \`;
                            
                            // Add analytics to the page
                            if (linksList) {
                                const analyticsDiv = document.createElement('div');
                                analyticsDiv.id = 'analyticsDisplay';
                                analyticsDiv.innerHTML = analyticsHtml;
                                linksList.parentNode.insertBefore(analyticsDiv, linksList.nextSibling);
                            }
                            
                            showResult('Analytics loaded successfully!', 'success');
                            
                        } catch (error) {
                            console.error('Error loading analytics:', error);
                            showResult('Error loading analytics: ' + error.message, 'error');
                        }
                    }
                    
                    // Close analytics view
                    function closeAnalytics() {
                        const analyticsDisplay = document.getElementById('analyticsDisplay');
                        if (analyticsDisplay) {
                            analyticsDisplay.remove();
                        }
                    }
                    
                    // Delete link
                    async function deleteLink(shortCode) {
                        const link = currentLinks.find(l => l.shortCode === shortCode);
                        if (!link) return;
                        
                        if (!confirm(\`Are you sure you want to delete "\${link.customName}"?\\n\\nThis action cannot be undone and will also delete all analytics data.\`)) {
                            return;
                        }
                        
                        try {
                            const response = await fetch(\`/api/plugins/linktracking/delete/\${shortCode}\`, {
                                method: 'DELETE'
                            });
                            
                            if (!response.ok) throw new Error('Failed to delete link');
                            
                            showResult('Link deleted successfully!', 'success');
                            await loadData();
                            
                            if (window.dashboardAPI && window.dashboardAPI.showNotification) {
                                window.dashboardAPI.showNotification('Link deleted successfully', 'success');
                            }
                            
                        } catch (error) {
                            console.error('Error deleting link:', error);
                            showResult('Error deleting link: ' + error.message, 'error');
                        }
                    }
                    
                    // Show result message
                    function showResult(message, type) {
                        if (!linkTrackingResult) return;
                        
                        linkTrackingResult.textContent = message;
                        linkTrackingResult.className = \`result-message \${type}\`;
                        linkTrackingResult.style.display = 'block';
                        
                        // Auto-hide after 5 seconds
                        setTimeout(() => {
                            linkTrackingResult.style.display = 'none';
                        }, 5000);
                    }
                    
                    // Make functions globally available for onclick handlers
                    window.copyTrackingUrl = copyTrackingUrl;
                    window.viewAnalytics = viewAnalytics;
                    window.closeAnalytics = closeAnalytics;
                    window.deleteLink = deleteLink;
                    
                    // Initialize when page loads
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeLinkTrackingPlugin);
                    } else {
                        initializeLinkTrackingPlugin();
                    }
                    
                    console.log('✅ Fixed Link Tracking Plugin loaded successfully');
                    
                })();
            `
        };
    }
}

module.exports = LinkTrackingPlugin;