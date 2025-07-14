const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LinkTrackingPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'Link Tracking';
        this.description = 'Generate trackable links and monitor detailed click analytics';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        // Storage paths
        this.dataDir = './data';
        this.linksFile = './data/trackingLinks.json';
        this.analyticsFile = './data/linkAnalytics.json';
        
        // In-memory storage for fast lookups
        this.trackingLinks = this.loadTrackingLinks();
        this.analytics = this.loadAnalytics();
        
        this.setupRoutes();
        
        console.log('Link Tracking Plugin loaded successfully.');
    }

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
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            fs.writeFileSync(this.linksFile, JSON.stringify(this.trackingLinks, null, 2));
        } catch (error) {
            console.error('Error saving tracking links:', error);
        }
    }

    saveAnalytics() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            fs.writeFileSync(this.analyticsFile, JSON.stringify(this.analytics, null, 2));
        } catch (error) {
            console.error('Error saving analytics:', error);
        }
    }

    generateShortCode() {
        return crypto.randomBytes(4).toString('hex');
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    getClientIP(req) {
        return req.headers['x-forwarded-for'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               'unknown';
    }

    getUserAgent(req) {
        return req.headers['user-agent'] || 'unknown';
    }

    getReferer(req) {
        return req.headers['referer'] || 'direct';
    }

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
                        clicks: this.analytics[shortCode] ? this.analytics[shortCode].length : 0
                    }));

                res.json(userLinks);
            } catch (error) {
                console.error('Error fetching links:', error);
                res.status(500).json({ error: 'Failed to fetch links' });
            }
        });

        // Create a new tracking link
        this.app.post('/api/plugins/linktracking/create', this.ensureAuthenticated, (req, res) => {
            try {
                console.log('🔗 Create link request received');
                console.log('🔗 Request body:', JSON.stringify(req.body, null, 2));
                
                // Extract data with fallbacks
                let originalUrl = req.body.originalUrl || '';
                let customName = req.body.customName || '';
                let description = req.body.description || '';
                
                const userId = req.user.id;
                
                console.log('🔗 Extracted values:', { originalUrl, customName, description, userId });

                // Validation with detailed logging
                if (!originalUrl || originalUrl.trim() === '') {
                    console.log('❌ Missing or empty originalUrl:', originalUrl);
                    return res.status(400).json({ error: 'Original URL is required' });
                }
                
                if (!customName || customName.trim() === '') {
                    console.log('❌ Missing or empty customName:', customName);
                    return res.status(400).json({ error: 'Custom name is required' });
                }

                // Trim whitespace
                originalUrl = originalUrl.trim();
                customName = customName.trim();
                description = description ? description.trim() : '';

                console.log('🔗 After trimming:', { originalUrl, customName, description });

                if (!this.isValidUrl(originalUrl)) {
                    console.log('❌ Invalid URL format:', originalUrl);
                    return res.status(400).json({ error: 'Invalid URL format. Please include http:// or https://' });
                }

                // Check for invalid characters in custom name
                const nameRegex = /^[a-zA-Z0-9_-]+$/;
                if (!nameRegex.test(customName)) {
                    console.log('❌ Invalid custom name format:', customName);
                    return res.status(400).json({ error: 'Custom name can only contain letters, numbers, underscores, and hyphens' });
                }

                // Check if custom name already exists for this user
                const existingLink = Object.entries(this.trackingLinks)
                    .find(([_, link]) => link.customName === customName && link.createdBy === userId);

                if (existingLink) {
                    console.log('❌ Custom name already exists:', customName);
                    return res.status(400).json({ error: 'Custom name already exists. Please choose a different name.' });
                }

                // Generate short code
                let shortCode;
                do {
                    shortCode = this.generateShortCode();
                } while (this.trackingLinks[shortCode]);

                // Create tracking link
                this.trackingLinks[shortCode] = {
                    originalUrl: originalUrl,
                    customName: customName,
                    description: description,
                    createdBy: userId,
                    createdAt: new Date().toISOString(),
                    active: true
                };

                this.saveTrackingLinks();

                // Generate tracking URL with custom domain
                const trackingUrl = `https://track.simmon.studio/t/${shortCode}/${customName}`;

                console.log('✅ Link created successfully:', { shortCode, customName, trackingUrl });

                res.json({
                    success: true,
                    shortCode,
                    trackingUrl,
                    customName,
                    originalUrl
                });

            } catch (error) {
                console.error('❌ Error creating tracking link:', error);
                res.status(500).json({ error: 'Failed to create tracking link: ' + error.message });
            }
        });

        // Update tracking link
        this.app.put('/api/plugins/linktracking/update/:shortCode', this.ensureAuthenticated, (req, res) => {
            try {
                const { shortCode } = req.params;
                const { originalUrl, customName, description, active } = req.body;
                const userId = req.user.id;

                const link = this.trackingLinks[shortCode];
                if (!link) {
                    return res.status(404).json({ error: 'Link not found' });
                }

                if (link.createdBy !== userId) {
                    return res.status(403).json({ error: 'Not authorized to modify this link' });
                }

                // Update fields
                if (originalUrl !== undefined) {
                    if (!this.isValidUrl(originalUrl)) {
                        return res.status(400).json({ error: 'Invalid URL format. Please include http:// or https://' });
                    }
                    link.originalUrl = originalUrl;
                }

                if (customName !== undefined) {
                    // Check if new custom name conflicts with existing ones
                    const existingLink = Object.entries(this.trackingLinks)
                        .find(([code, l]) => code !== shortCode && l.customName === customName && l.createdBy === userId);

                    if (existingLink) {
                        return res.status(400).json({ error: 'Custom name already exists' });
                    }
                    link.customName = customName;
                }

                if (description !== undefined) link.description = description;
                if (active !== undefined) link.active = active;

                link.updatedAt = new Date().toISOString();

                this.saveTrackingLinks();

                res.json({ success: true, message: 'Link updated successfully' });

            } catch (error) {
                console.error('Error updating tracking link:', error);
                res.status(500).json({ error: 'Failed to update tracking link' });
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

                console.log(`🔗 Analytics request for shortCode: ${shortCode} by user: ${userId}`);

                const link = this.trackingLinks[shortCode];
                if (!link) {
                    console.log(`❌ Link not found: ${shortCode}`);
                    return res.status(404).json({ error: 'Link not found' });
                }

                if (link.createdBy !== userId) {
                    console.log(`❌ Unauthorized access: ${userId} tried to access ${shortCode} owned by ${link.createdBy}`);
                    return res.status(403).json({ error: 'Not authorized to view analytics for this link' });
                }

                const analytics = this.analytics[shortCode] || [];
                console.log(`📊 Found ${analytics.length} analytics entries for ${shortCode}`);

                // Process analytics for better insights
                const processed = {
                    totalClicks: analytics.length,
                    uniqueIPs: [...new Set(analytics.map(a => a.ip))].length,
                    clicksToday: analytics.filter(a => {
                        const today = new Date().toDateString();
                        return new Date(a.timestamp).toDateString() === today;
                    }).length,
                    clicksThisWeek: analytics.filter(a => {
                        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                        return new Date(a.timestamp) > weekAgo;
                    }).length,
                    topReferers: this.getTopValues(analytics.map(a => a.referer)),
                    topUserAgents: this.getTopValues(analytics.map(a => a.userAgent)),
                    topCountries: this.getTopValues(analytics.map(a => a.country || 'Unknown')),
                    hourlyDistribution: this.getHourlyDistribution(analytics),
                    dailyDistribution: this.getDailyDistribution(analytics),
                    recentClicks: analytics.slice(-50).reverse() // Last 50 clicks
                };

                console.log(`✅ Analytics processed successfully: ${processed.totalClicks} clicks, ${processed.uniqueIPs} unique IPs`);

                res.json({
                    link,
                    analytics: processed,
                    rawData: analytics
                });

            } catch (error) {
                console.error('❌ Error fetching analytics:', error);
                res.status(500).json({ error: 'Failed to fetch analytics: ' + error.message });
            }
        });

        // Public tracking endpoint (no authentication required)
        this.app.get('/t/:shortCode/:customName', (req, res) => {
            try {
                const { shortCode, customName } = req.params;
                console.log(`🔗 Tracking request: ${shortCode}/${customName}`);
                
                const link = this.trackingLinks[shortCode];

                // Verify both shortCode and customName match
                if (!link || !link.active || link.customName !== customName) {
                    console.log(`❌ Link not found or mismatch: ${shortCode}/${customName}`);
                    return res.status(404).send('Link not found or inactive');
                }

                // Record analytics
                const analyticsEntry = {
                    timestamp: new Date().toISOString(),
                    ip: this.getClientIP(req),
                    userAgent: this.getUserAgent(req),
                    referer: this.getReferer(req),
                    country: null // Could be enhanced with IP geolocation
                };

                if (!this.analytics[shortCode]) {
                    this.analytics[shortCode] = [];
                }

                this.analytics[shortCode].push(analyticsEntry);
                this.saveAnalytics();

                console.log(`✅ Click tracked: ${shortCode}/${customName} -> ${link.originalUrl}`);

                // Redirect to original URL
                res.redirect(link.originalUrl);

            } catch (error) {
                console.error('Error processing tracking click:', error);
                res.status(500).send('Internal server error');
            }
        });

        // Bulk analytics endpoint
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
                        const analytics = this.analytics[code] || [];
                        const today = new Date().toDateString();
                        return sum + analytics.filter(a => new Date(a.timestamp).toDateString() === today).length;
                    }, 0),
                    topPerformingLinks: userLinks
                        .map(([code, link]) => ({
                            shortCode: code,
                            customName: link.customName,
                            clicks: this.analytics[code] ? this.analytics[code].length : 0
                        }))
                        .sort((a, b) => b.clicks - a.clicks)
                        .slice(0, 5)
                };

                res.json(overview);

            } catch (error) {
                console.error('Error fetching overview:', error);
                res.status(500).json({ error: 'Failed to fetch overview' });
            }
        });
    }

    getTopValues(array, limit = 5) {
        const counts = {};
        array.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });

        return Object.entries(counts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([value, count]) => ({ value, count }));
    }

    getHourlyDistribution(analytics) {
        const hours = new Array(24).fill(0);
        analytics.forEach(entry => {
            const hour = new Date(entry.timestamp).getHours();
            hours[hour]++;
        });
        return hours.map((count, hour) => ({ hour, count }));
    }

    getDailyDistribution(analytics) {
        const days = {};
        analytics.forEach(entry => {
            const day = new Date(entry.timestamp).toDateString();
            days[day] = (days[day] || 0) + 1;
        });

        return Object.entries(days)
            .sort(([a], [b]) => new Date(a) - new Date(b))
            .map(([date, count]) => ({ date, count }));
    }

    getFrontendComponent() {
        return {
            id: 'linktracking-plugin',
            name: 'Link Tracking',
            description: 'Generate trackable links and monitor detailed click analytics',
            icon: '🔗',
            version: '1.0.0',
            containerId: 'linkTrackingPluginContainer',
            pageId: 'link-tracking',
            navIcon: '🔗',

            html: `
                <div class="plugin-container">
                    <div class="plugin-header">
                        <h3><span class="plugin-icon">🔗</span> Link Tracking</h3>
                        <p>Generate trackable links and monitor detailed click analytics</p>
                    </div>

                    <!-- Overview Section -->
                    <div class="settings-section">
                        <h3>📊 Overview</h3>
                        <div id="trackingOverview" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                            <div class="stat-card" style="background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 12px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: bold; color: #4CAF50;" id="totalLinksCount">0</div>
                                <div style="opacity: 0.8;">Total Links</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 12px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: bold; color: #2196F3;" id="totalClicksCount">0</div>
                                <div style="opacity: 0.8;">Total Clicks</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 12px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: bold; color: #FF9800;" id="clicksTodayCount">0</div>
                                <div style="opacity: 0.8;">Clicks Today</div>
                            </div>
                            <div class="stat-card" style="background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 12px; text-align: center;">
                                <div style="font-size: 2rem; font-weight: bold; color: #9C27B0;" id="activeLinksCount">0</div>
                                <div style="opacity: 0.8;">Active Links</div>
                            </div>
                        </div>
                    </div>

                    <!-- Create Link Section -->
                    <div class="settings-section">
                        <h3>🆕 Create New Tracking Link</h3>
                        <form id="createLinkForm">
                            <div class="form-group">
                                <label for="originalUrl">Original URL</label>
                                <input type="url" id="originalUrl" name="originalUrl" required placeholder="https://www.tiktok.com/@noiseeng" 
                                       style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white;">
                            </div>
                            
                            <div class="form-group">
                                <label for="customName">Custom Name</label>
                                <input type="text" id="customName" name="customName" required placeholder="netiktok" 
                                       style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white;">
                                <small style="opacity: 0.7; display: block; margin-top: 4px;">
                                    This will create: https://track.simmon.studio/t/shortcode/customname
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="description">Description (Optional)</label>
                                <textarea id="description" name="description" placeholder="Brief description of this link..." 
                                          style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; min-height: 80px; resize: vertical;"></textarea>
                            </div>
                            
                            <button type="submit" class="btn-primary" id="createLinkBtn">
                                🔗 Create Tracking Link
                            </button>
                        </form>
                    </div>

                    <!-- Links Management Section -->
                    <div class="settings-section">
                        <h3>📋 Your Tracking Links</h3>
                        <div id="linksContainer">
                            <div id="linksLoading" style="text-align: center; padding: 2rem; opacity: 0.7;">
                                Loading your links...
                            </div>
                            <div id="noLinksMessage" style="display: none; text-align: center; padding: 2rem; opacity: 0.7;">
                                No tracking links created yet. Create your first one above!
                            </div>
                            <div id="linksList"></div>
                        </div>
                    </div>
                </div>
            `,

            script: `(function() {
                console.log("🔗 Link Tracking Plugin: Initializing frontend component...");
                
                let currentLinks = [];
                
                // Show analytics as a new page (not modal)
                async function showAnalyticsPage(shortCode) {
                    console.log('🔗 Loading analytics page for shortCode:', shortCode);
                    
                    // Try multiple selectors to find the plugin container
                    let pluginContainer = document.getElementById('linkTrackingPluginContainer');
                    if (!pluginContainer) {
                        pluginContainer = document.querySelector('.plugin-container');
                    }
                    if (!pluginContainer) {
                        pluginContainer = document.querySelector('#link-tracking-page .plugin-container');
                    }
                    
                    if (!pluginContainer) {
                        console.error('Plugin container not found');
                        console.log('Available containers:', document.querySelectorAll('[id*="Container"], .plugin-container'));
                        return;
                    }
                    
                    console.log('🔗 Found plugin container:', pluginContainer);
                    
                    // Show loading state
                    pluginContainer.innerHTML = \`
                        <div style="text-align: center; padding: 3rem;">
                            <div style="font-size: 2rem; margin-bottom: 1rem;">📊</div>
                            <h2>Loading Analytics...</h2>
                            <p>Please wait while we fetch your data.</p>
                        </div>
                    \`;
                    
                    try {
                        const response = await fetch(\`/api/plugins/linktracking/analytics/\${shortCode}\`);
                        
                        if (!response.ok) {
                            throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                        }
                        
                        const data = await response.json();
                        console.log('🔗 Analytics data received:', data);
                        
                        const { link, analytics } = data;
                        const safeAnalytics = analytics || {
                            totalClicks: 0,
                            uniqueIPs: 0,
                            clicksToday: 0,
                            clicksThisWeek: 0,
                            topReferers: [],
                            topUserAgents: [],
                            recentClicks: []
                        };
                        
                        // Replace entire plugin content with analytics
                        pluginContainer.innerHTML = \`
                            <div class="plugin-header">
                                <button onclick="goBackToLinks()" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; padding: 0.5rem 1rem; cursor: pointer; margin-bottom: 1rem;">
                                    ← Back to Links
                                </button>
                                <h3><span class="plugin-icon">📊</span> Analytics for "\${link.customName}"</h3>
                                <p>Detailed analytics for your tracking link</p>
                                <div style="background: rgba(255,255,255,0.1); padding: 0.75rem; border-radius: 8px; margin: 1rem 0; font-family: monospace; word-break: break-all;">
                                    https://track.simmon.studio/t/\${link.shortCode}/\${link.customName}
                                </div>
                                <p style="opacity: 0.8;">
                                    → <a href="\${link.originalUrl}" target="_blank" style="color: #64B5F6; text-decoration: none;">\${link.originalUrl}</a>
                                </p>
                            </div>

                            <!-- Key Metrics -->
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                                <div style="background: rgba(76, 175, 80, 0.2); padding: 1.5rem; border-radius: 12px; text-align: center;">
                                    <div style="font-size: 2.5rem; font-weight: bold; color: #4CAF50; margin-bottom: 0.5rem;">\${safeAnalytics.totalClicks}</div>
                                    <div style="opacity: 0.8; font-size: 1.1rem;">Total Clicks</div>
                                </div>
                                <div style="background: rgba(33, 150, 243, 0.2); padding: 1.5rem; border-radius: 12px; text-align: center;">
                                    <div style="font-size: 2.5rem; font-weight: bold; color: #2196F3; margin-bottom: 0.5rem;">\${safeAnalytics.uniqueIPs}</div>
                                    <div style="opacity: 0.8; font-size: 1.1rem;">Unique Visitors</div>
                                </div>
                                <div style="background: rgba(255, 152, 0, 0.2); padding: 1.5rem; border-radius: 12px; text-align: center;">
                                    <div style="font-size: 2.5rem; font-weight: bold; color: #FF9800; margin-bottom: 0.5rem;">\${safeAnalytics.clicksToday}</div>
                                    <div style="opacity: 0.8; font-size: 1.1rem;">Today</div>
                                </div>
                                <div style="background: rgba(156, 39, 176, 0.2); padding: 1.5rem; border-radius: 12px; text-align: center;">
                                    <div style="font-size: 2.5rem; font-weight: bold; color: #9C27B0; margin-bottom: 0.5rem;">\${safeAnalytics.clicksThisWeek}</div>
                                    <div style="opacity: 0.8; font-size: 1.1rem;">This Week</div>
                                </div>
                            </div>

                            \${safeAnalytics.totalClicks === 0 ? \`
                            <!-- No Data State -->
                            <div style="background: rgba(255,255,255,0.05); padding: 3rem; border-radius: 12px; text-align: center; margin: 2rem 0;">
                                <div style="font-size: 3rem; margin-bottom: 1rem;">🔗</div>
                                <h3>No clicks yet!</h3>
                                <p style="opacity: 0.7; margin-bottom: 2rem;">Share your tracking link to start collecting analytics data.</p>
                                <button onclick="copyToClipboard('https://track.simmon.studio/t/\${link.shortCode}/\${link.customName}')" style="padding: 0.75rem 1.5rem; background: rgba(100, 181, 246, 0.2); border: 1px solid rgba(100, 181, 246, 0.5); border-radius: 8px; color: #64B5F6; cursor: pointer; font-size: 1rem;">
                                    📋 Copy Tracking Link
                                </button>
                            </div>
                            \` : \`
                            <!-- Analytics Data -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
                                <!-- Top Referers -->
                                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px;">
                                    <h4 style="margin: 0 0 1rem 0; display: flex; align-items: center; gap: 0.5rem;">
                                        🔗 Traffic Sources
                                    </h4>
                                    \${safeAnalytics.topReferers && safeAnalytics.topReferers.length > 0 ? 
                                        safeAnalytics.topReferers.map(referer => \`
                                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                                <span style="flex: 1;">\${referer.value === 'direct' ? '🔗 Direct Access' : referer.value}</span>
                                                <span style="font-weight: bold; color: #4CAF50; background: rgba(76, 175, 80, 0.2); padding: 0.25rem 0.5rem; border-radius: 4px;">\${referer.count}</span>
                                            </div>
                                        \`).join('') : 
                                        '<p style="opacity: 0.6; text-align: center; padding: 1rem;">No traffic source data</p>'
                                    }
                                </div>
                                
                                <!-- Recent Clicks -->
                                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px;">
                                    <h4 style="margin: 0 0 1rem 0; display: flex; align-items: center; gap: 0.5rem;">
                                        🕒 Recent Activity
                                    </h4>
                                    \${safeAnalytics.recentClicks && safeAnalytics.recentClicks.length > 0 ? 
                                        safeAnalytics.recentClicks.slice(0, 10).map(click => \`
                                            <div style="padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.9rem;">
                                                <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                                                    <span style="opacity: 0.8;">\${new Date(click.timestamp).toLocaleString()}</span>
                                                    <span style="font-family: monospace; color: #FF9800;">\${click.ip}</span>
                                                </div>
                                                <div style="opacity: 0.6;">\${click.referer === 'direct' ? 'Direct access' : click.referer}</div>
                                            </div>
                                        \`).join('') : 
                                        '<p style="opacity: 0.6; text-align: center; padding: 1rem;">No click data</p>'
                                    }
                                </div>
                            </div>
                            \`}
                        \`;
                        
                        console.log('✅ Analytics page rendered successfully');
                        console.log('🔗 Container after update:', pluginContainer);
                        
                    } catch (error) {
                        console.error('Error loading analytics:', error);
                        pluginContainer.innerHTML = \`
                            <div style="text-align: center; padding: 3rem;">
                                <div style="font-size: 2rem; margin-bottom: 1rem; color: #f44336;">❌</div>
                                <h3>Error Loading Analytics</h3>
                                <p style="color: #f44336; margin-bottom: 2rem;">\${error.message}</p>
                                <button onclick="goBackToLinks()" style="padding: 0.75rem 1.5rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; cursor: pointer;">
                                    ← Back to Links
                                </button>
                            </div>
                        \`;
                    }
                }
                
                // Initialize the plugin
                async function initializeLinkTracking() {
                    await loadOverview();
                    await loadLinks();
                    setupEventListeners();
                }
                
                // Load overview statistics
                async function loadOverview() {
                    try {
                        const response = await fetch('/api/plugins/linktracking/overview');
                        const overview = await response.json();
                        
                        document.getElementById('totalLinksCount').textContent = overview.totalLinks;
                        document.getElementById('totalClicksCount').textContent = overview.totalClicks;
                        document.getElementById('clicksTodayCount').textContent = overview.clicksToday;
                        document.getElementById('activeLinksCount').textContent = overview.activeLinks;
                        
                    } catch (error) {
                        console.error('Error loading overview:', error);
                    }
                }
                
                // Load user's tracking links
                async function loadLinks() {
                    try {
                        const response = await fetch('/api/plugins/linktracking/links');
                        currentLinks = await response.json();
                        renderLinks();
                        
                    } catch (error) {
                        console.error('Error loading links:', error);
                        document.getElementById('linksLoading').style.display = 'none';
                        document.getElementById('linksList').innerHTML = '<div style="color: red; text-align: center; padding: 2rem;">Error loading links</div>';
                    }
                }
                
                // Render links list
                function renderLinks() {
                    const linksLoading = document.getElementById('linksLoading');
                    const noLinksMessage = document.getElementById('noLinksMessage');
                    const linksList = document.getElementById('linksList');
                    
                    linksLoading.style.display = 'none';
                    
                    if (currentLinks.length === 0) {
                        noLinksMessage.style.display = 'block';
                        linksList.innerHTML = '';
                        return;
                    }
                    
                    noLinksMessage.style.display = 'none';
                    
                    linksList.innerHTML = currentLinks.map(link => {
                        const trackingUrl = 'https://track.simmon.studio/t/' + link.shortCode + '/' + link.customName;
                        const statusColor = link.active ? '#4CAF50' : '#f44336';
                        const statusText = link.active ? 'Active' : 'Inactive';
                        
                        return \`
                            <div class="link-card" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; border-left: 4px solid \${statusColor};">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                                    <div style="flex: 1;">
                                        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem;">
                                            <h4 style="margin: 0; color: white;">\${link.customName}</h4>
                                            <span style="background: \${statusColor}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">\${statusText}</span>
                                            <span style="background: rgba(255,255,255,0.2); color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">\${link.clicks} clicks</span>
                                        </div>
                                        
                                        <div style="margin-bottom: 1rem; opacity: 0.8;">
                                            <div style="margin-bottom: 0.25rem;"><strong>Original:</strong> <a href="\${link.originalUrl}" target="_blank" style="color: #64B5F6; text-decoration: none;">\${link.originalUrl}</a></div>
                                            <div style="margin-bottom: 0.25rem;"><strong>Tracking:</strong> <span style="color: #81C784;">\${trackingUrl}</span></div>
                                            \${link.description ? \`<div><strong>Description:</strong> \${link.description}</div>\` : ''}
                                        </div>
                                        
                                        <div style="opacity: 0.6; font-size: 0.9rem;">
                                            Created: \${new Date(link.createdAt).toLocaleDateString()} • Code: \${link.shortCode}
                                        </div>
                                    </div>
                                    
                                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                        <button class="copy-btn" data-url="\${trackingUrl}" style="padding: 0.5rem 1rem; background: rgba(100, 181, 246, 0.2); border: 1px solid rgba(100, 181, 246, 0.5); border-radius: 6px; color: #64B5F6; cursor: pointer; font-size: 0.9rem;">
                                            📋 Copy Link
                                        </button>
                                        <button class="analytics-btn" data-shortcode="\${link.shortCode}" style="padding: 0.5rem 1rem; background: rgba(129, 199, 132, 0.2); border: 1px solid rgba(129, 199, 132, 0.5); border-radius: 6px; color: #81C784; cursor: pointer; font-size: 0.9rem;">
                                            📊 Analytics
                                        </button>
                                        <button class="toggle-btn" data-shortcode="\${link.shortCode}" data-active="\${link.active}" style="padding: 0.5rem 1rem; background: rgba(255, 152, 0, 0.2); border: 1px solid rgba(255, 152, 0, 0.5); border-radius: 6px; color: #FF9800; cursor: pointer; font-size: 0.9rem;">
                                            \${link.active ? '⏸️ Disable' : '▶️ Enable'}
                                        </button>
                                        <button class="delete-btn" data-shortcode="\${link.shortCode}" style="padding: 0.5rem 1rem; background: rgba(244, 67, 54, 0.2); border: 1px solid rgba(244, 67, 54, 0.5); border-radius: 6px; color: #f44336; cursor: pointer; font-size: 0.9rem;">
                                            🗑️ Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        \`;
                    }).join('');
                }
                
                // Setup event listeners
                function setupEventListeners() {
                    // Create link form
                    const createForm = document.getElementById('createLinkForm');
                    createForm.addEventListener('submit', handleCreateLink);
                    
                    // Dynamic event listeners for link actions
                    document.addEventListener('click', handleLinkActions);
                }
                
                // Handle create link form submission
                async function handleCreateLink(e) {
                    e.preventDefault();
                    
                    const form = e.target;
                    const originalUrlField = form.querySelector('#originalUrl');
                    const customNameField = form.querySelector('#customName');
                    const descriptionField = form.querySelector('#description');
                    
                    const originalUrl = originalUrlField ? originalUrlField.value : '';
                    const customName = customNameField ? customNameField.value : '';
                    const description = descriptionField ? descriptionField.value : '';
                    
                    const createBtn = document.getElementById('createLinkBtn');
                    createBtn.disabled = true;
                    createBtn.textContent = 'Creating...';
                    
                    try {
                        const requestBody = {
                            originalUrl: originalUrl.trim(),
                            customName: customName.trim(),
                            description: description ? description.trim() : ''
                        };
                        
                        const response = await fetch('/api/plugins/linktracking/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody)
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && result.success) {
                            if (typeof showNotification === 'function') {
                                showNotification(\`Link created: \${result.trackingUrl}\`, 'success');
                            }
                            
                            // Reset form
                            form.reset();
                            
                            // Reload data
                            await loadOverview();
                            await loadLinks();
                            
                        } else {
                            if (typeof showNotification === 'function') {
                                showNotification(result.error || 'Failed to create link', 'error');
                            }
                        }
                        
                    } catch (error) {
                        console.error('Error creating link:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to create link', 'error');
                        }
                    } finally {
                        createBtn.disabled = false;
                        createBtn.textContent = '🔗 Create Tracking Link';
                    }
                }
                
                // Handle link actions (copy, analytics, toggle, delete)
                async function handleLinkActions(e) {
                    const target = e.target;
                    
                    // Prevent multiple rapid clicks
                    if (target.disabled) return;
                    
                    // Copy link button
                    if (target.classList.contains('copy-btn')) {
                        const url = target.dataset.url;
                        try {
                            await navigator.clipboard.writeText(url);
                            const originalText = target.textContent;
                            target.textContent = '✅ Copied!';
                            target.style.background = 'rgba(76, 175, 80, 0.2)';
                            target.style.borderColor = 'rgba(76, 175, 80, 0.5)';
                            target.style.color = '#4CAF50';
                            
                            setTimeout(() => {
                                target.textContent = originalText;
                                target.style.background = 'rgba(100, 181, 246, 0.2)';
                                target.style.borderColor = 'rgba(100, 181, 246, 0.5)';
                                target.style.color = '#64B5F6';
                            }, 2000);
                        } catch (error) {
                            console.error('Error copying to clipboard:', error);
                            if (typeof showNotification === 'function') {
                                showNotification('Failed to copy link', 'error');
                            }
                        }
                    }
                    
                    // Analytics button
                    if (target.classList.contains('analytics-btn')) {
                        // Disable button temporarily to prevent multiple clicks
                        target.disabled = true;
                        target.style.opacity = '0.5';
                        
                        const shortCode = target.dataset.shortcode;
                        await showAnalyticsPage(shortCode);
                        
                        // Re-enable button after a delay
                        setTimeout(() => {
                            target.disabled = false;
                            target.style.opacity = '1';
                        }, 1000);
                    }
                    
                    // Toggle active/inactive button
                    if (target.classList.contains('toggle-btn')) {
                        const shortCode = target.dataset.shortcode;
                        const isActive = target.dataset.active === 'true';
                        await toggleLinkStatus(shortCode, !isActive);
                    }
                    
                    // Delete button
                    if (target.classList.contains('delete-btn')) {
                        const shortCode = target.dataset.shortcode;
                        const link = currentLinks.find(l => l.shortCode === shortCode);
                        
                        if (confirm(\`Are you sure you want to delete "\${link?.customName || shortCode}"? This action cannot be undone and all analytics data will be lost.\`)) {
                            await deleteLink(shortCode);
                        }
                    }
                }
                
                // Toggle link status (active/inactive)
                async function toggleLinkStatus(shortCode, newStatus) {
                    try {
                        const response = await fetch(\`/api/plugins/linktracking/update/\${shortCode}\`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ active: newStatus })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && result.success) {
                            if (typeof showNotification === 'function') {
                                showNotification(\`Link \${newStatus ? 'enabled' : 'disabled'} successfully\`, 'success');
                            }
                            
                            await loadOverview();
                            await loadLinks();
                        } else {
                            if (typeof showNotification === 'function') {
                                showNotification(result.error || 'Failed to update link', 'error');
                            }
                        }
                        
                    } catch (error) {
                        console.error('Error toggling link status:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update link', 'error');
                        }
                    }
                }
                
                // Delete link
                async function deleteLink(shortCode) {
                    try {
                        const response = await fetch(\`/api/plugins/linktracking/delete/\${shortCode}\`, {
                            method: 'DELETE'
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && result.success) {
                            if (typeof showNotification === 'function') {
                                showNotification('Link deleted successfully', 'success');
                            }
                            
                            await loadOverview();
                            await loadLinks();
                        } else {
                            if (typeof showNotification === 'function') {
                                showNotification(result.error || 'Failed to delete link', 'error');
                            }
                        }
                        
                    } catch (error) {
                        console.error('Error deleting link:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to delete link', 'error');
                        }
                    }
                }
                
                // Go back to main links view
                function goBackToLinks() {
                    location.reload(); // Simple refresh to go back to main view
                }
                
                // Copy to clipboard helper
                async function copyToClipboard(text) {
                    try {
                        await navigator.clipboard.writeText(text);
                        if (typeof showNotification === 'function') {
                            showNotification('Link copied to clipboard!', 'success');
                        }
                    } catch (error) {
                        console.error('Error copying to clipboard:', error);
                    }
                }
                
                // Make functions globally available
                window.goBackToLinks = goBackToLinks;
                window.copyToClipboard = copyToClipboard;
                window.showAnalyticsPage = showAnalyticsPage;
                
                // Initialize when DOM is ready
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', initializeLinkTracking);
                } else {
                    initializeLinkTracking();
                }
                
                console.log("🔗 Link Tracking Plugin: Frontend component initialized successfully!");
            })()`
        };
    }
}

module.exports = LinkTrackingPlugin;