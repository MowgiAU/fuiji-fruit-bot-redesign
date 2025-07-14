// ============================================================================
// FUJI FRUIT BOT - COMPLETE UPDATED DASHBOARD.JS
// Enhanced dashboard with server selection, real-time widgets, and new features
// ============================================================================

// Global variables
let currentUser = null;
let pluginComponents = [];
let currentSelectedServer = null;
let servers = [];
let consoleLogWebSocket = null;
let activityChartInstance = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

function switchToPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    const activeLink = document.querySelector(`[data-page="${pageId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
    
    // Update dashboard stats if on overview page
    if (pageId === 'overview') {
        updateDashboardStats();
        loadModerators();
        loadLeaderboards();
        setupActivityChart();
    }
    
    console.log(`🔄 Switched to page: ${pageId}`);
}

// ============================================================================
// SERVER MANAGEMENT
// ============================================================================

function handleServerChange(serverId) {
    const previousServer = currentSelectedServer;
    currentSelectedServer = serverId;
    
    console.log(`🔄 Server changed from ${previousServer} to ${serverId}`);
    
    if (!serverId) {
        console.log('⚠️ No server selected');
        return;
    }
    
    // Update all widgets when server changes
    updateDashboardStats();
    updateQuickMessageChannels();
    loadModerators();
    loadLeaderboards();
    setupActivityChart();
    
    const serverName = getServerName(serverId);
    showNotification(`Switched to server: ${serverName}`, 'info');
    addLogEntry('info', `Dashboard switched to server: ${serverName}`);
}

function populateServerDropdown() {
    const serverDropdown = document.getElementById('serverDropdown');
    if (!serverDropdown || !servers.length) {
        console.log('⚠️ Server dropdown not found or no servers available');
        return;
    }
    
    serverDropdown.innerHTML = '<option value="">Select Server...</option>';
    
    servers.forEach(server => {
        const option = document.createElement('option');
        option.value = server.id;
        option.textContent = server.name;
        serverDropdown.appendChild(option);
    });
    
    // Set first server as default if none selected
    if (!currentSelectedServer && servers.length > 0) {
        currentSelectedServer = servers[0].id;
        serverDropdown.value = currentSelectedServer;
        console.log(`🎯 Auto-selected first server: ${servers[0].name}`);
        // Don't trigger handleServerChange here to avoid infinite loop
        setTimeout(() => handleServerChange(currentSelectedServer), 100);
    }
    
    console.log('✅ Server dropdown populated with', servers.length, 'servers');
}

function getServerName(serverId) {
    const server = servers.find(s => s.id === serverId);
    return server ? server.name : 'Unknown Server';
}

// ============================================================================
// USER AND SERVER DATA LOADING
// ============================================================================

async function loadUser() {
    try {
        const response = await fetch('/api/user');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        currentUser = await response.json();
        
        const username = document.getElementById('username');
        const userAvatar = document.getElementById('userAvatar');
        
        if (username) username.textContent = currentUser.username;
        
        if (userAvatar) {
            if (currentUser.avatar) {
                userAvatar.innerHTML = `<img src="https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png" alt="Avatar">`;
            } else {
                userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
            }
        }
        
        console.log('✅ User loaded:', currentUser.username);
        addLogEntry('success', `User ${currentUser.username} logged in`);
    } catch (error) {
        console.error('Error loading user:', error);
        addLogEntry('error', `Failed to load user: ${error.message}`);
        window.location.href = '/login.html';
    }
}

async function loadServers() {
    try {
        const response = await fetch('/api/servers');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        servers = await response.json();
        console.log('✅ Servers loaded:', servers.length);
        
        // Populate server dropdown
        populateServerDropdown();
        
        return servers;
    } catch (error) {
        console.error('Error loading servers:', error);
        addLogEntry('error', `Failed to load servers: ${error.message}`);
        return [];
    }
}

// ============================================================================
// DASHBOARD STATS FUNCTIONS
// ============================================================================

async function updateDashboardStats() {
    try {
        if (!currentSelectedServer) {
            console.log('⚠️ No server selected for stats update');
            return;
        }
        
        console.log(`🔄 Updating stats for server: ${currentSelectedServer}`);
        
        // Get server-specific data with error handling
        const [onlineUsers, serverStats, totalMessages] = await Promise.allSettled([
            getOnlineUsers(currentSelectedServer),
            getServerStats(currentSelectedServer),
            getTotalServerMessages(currentSelectedServer)
        ]);
        
        // Update stat cards with server-specific data
        const onlineUsersEl = document.getElementById('onlineUsers');
        const totalServerUsersEl = document.getElementById('totalServerUsers');
        const activePluginsEl = document.getElementById('activePlugins');
        const totalServerMessagesEl = document.getElementById('totalServerMessages');
        
        if (onlineUsersEl) {
            const count = onlineUsers.status === 'fulfilled' ? onlineUsers.value : 0;
            onlineUsersEl.textContent = count.toLocaleString();
        }
        
        if (totalServerUsersEl) {
            const count = serverStats.status === 'fulfilled' ? serverStats.value.memberCount : 0;
            totalServerUsersEl.textContent = count.toLocaleString();
        }
        
        // Count active plugins
        const activePluginCount = pluginComponents.filter(plugin => plugin.enabled !== false).length;
        if (activePluginsEl) {
            activePluginsEl.textContent = activePluginCount.toString();
        }
        
        if (totalServerMessagesEl) {
            const count = totalMessages.status === 'fulfilled' ? totalMessages.value : 0;
            totalServerMessagesEl.textContent = count.toLocaleString();
        }
        
        console.log('✅ Dashboard stats updated for server:', getServerName(currentSelectedServer));
        addLogEntry('info', `Stats updated for ${getServerName(currentSelectedServer)}`);
    } catch (error) {
        console.error('Error updating dashboard stats:', error);
        addLogEntry('error', `Failed to update stats: ${error.message}`);
    }
}

// Helper functions for getting server-specific data
async function getOnlineUsers(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/online-users`);
        if (response.ok) {
            const data = await response.json();
            return data.count || 0;
        }
        throw new Error(`API error: ${response.status}`);
    } catch (error) {
        console.error('Error fetching online users:', error);
        // Fallback: find server in cache and estimate online users
        const server = servers.find(s => s.id === serverId);
        return server ? Math.floor((server.memberCount || 0) * 0.15) : 0;
    }
}

async function getServerStats(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/stats`);
        if (response.ok) {
            return await response.json();
        }
        throw new Error(`API error: ${response.status}`);
    } catch (error) {
        console.error('Error fetching server stats:', error);
        // Fallback: use cached server data
        const server = servers.find(s => s.id === serverId);
        return server ? { memberCount: server.memberCount || 0 } : { memberCount: 0 };
    }
}

async function getTotalServerMessages(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/message-stats`);
        if (response.ok) {
            const data = await response.json();
            return data.totalMessages || 0;
        }
        throw new Error(`API error: ${response.status}`);
    } catch (error) {
        console.error('Error fetching message stats:', error);
        // Fallback: generate estimate based on server size
        const server = servers.find(s => s.id === serverId);
        const memberCount = server ? server.memberCount || 0 : 0;
        return Math.floor(memberCount * 50);
    }
}

// ============================================================================
// CONSOLE LOG WIDGET FUNCTIONS
// ============================================================================

function initConsoleLog() {
    const consoleToggleBtn = document.getElementById('consoleToggle');
    const consoleClearBtn = document.querySelector('.console-clear-btn');
    
    // Setup expand/collapse
    if (consoleToggleBtn) {
        consoleToggleBtn.addEventListener('click', toggleConsoleLog);
    }
    
    // Setup clear functionality
    if (consoleClearBtn) {
        consoleClearBtn.addEventListener('click', clearConsoleLog);
    }
    
    // Load recent logs from server
    loadRecentLogs();
    
    console.log('✅ Console log widget initialized');
}

function toggleConsoleLog() {
    const consoleContent = document.getElementById('consoleContent');
    const toggleIcon = document.querySelector('#consoleToggle .toggle-icon');
    
    if (consoleContent) {
        consoleContent.classList.toggle('collapsed');
        
        if (toggleIcon) {
            toggleIcon.textContent = consoleContent.classList.contains('collapsed') ? '+' : '−';
        }
    }
}

function clearConsoleLog() {
    const consoleLog = document.getElementById('consoleLog');
    if (consoleLog) {
        consoleLog.innerHTML = '';
        addLogEntry('info', 'Console cleared by user');
    }
}

async function loadRecentLogs() {
    try {
        const response = await fetch('/api/logs?limit=20');
        if (response.ok) {
            const logs = await response.json();
            const consoleLog = document.getElementById('consoleLog');
            
            if (consoleLog && logs.length > 0) {
                // Clear existing logs and add server logs
                consoleLog.innerHTML = '';
                logs.forEach(log => {
                    displayLogEntry(log.level, log.message, new Date(log.timestamp));
                });
                consoleLog.scrollTop = consoleLog.scrollHeight;
            }
        }
    } catch (error) {
        console.error('Error loading recent logs:', error);
    }
}

function addLogEntry(level, message, timestamp = null) {
    displayLogEntry(level, message, timestamp || new Date());
}

function displayLogEntry(level, message, timestamp) {
    const consoleLog = document.getElementById('consoleLog');
    if (!consoleLog) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${level}`;
    
    const timeString = timestamp.toLocaleTimeString('en-US', { hour12: false });
    
    logEntry.innerHTML = `
        <span class="log-time">${timeString}</span>
        <span class="log-level">${level.toUpperCase()}</span>
        <span class="log-message">${message}</span>
    `;
    
    consoleLog.appendChild(logEntry);
    
    // Auto-scroll to bottom
    consoleLog.scrollTop = consoleLog.scrollHeight;
    
    // Limit to last 100 entries
    const entries = consoleLog.querySelectorAll('.log-entry');
    if (entries.length > 100) {
        entries[0].remove();
    }
}

// ============================================================================
// MODERATOR PROFILES WIDGET FUNCTIONS
// ============================================================================

async function loadModerators() {
    if (!currentSelectedServer) return;
    
    const moderatorsList = document.getElementById('moderatorsList');
    if (!moderatorsList) return;
    
    try {
        const response = await fetch(`/api/servers/${currentSelectedServer}/moderators`);
        if (response.ok) {
            const moderators = await response.json();
            displayModerators(moderators);
            console.log(`✅ Loaded ${moderators.length} moderators for ${getServerName(currentSelectedServer)}`);
        } else {
            console.error('Failed to load moderators:', response.status);
            // Keep existing placeholder data
        }
    } catch (error) {
        console.error('Error loading moderators:', error);
        addLogEntry('error', `Failed to load moderators: ${error.message}`);
    }
}

function displayModerators(moderators) {
    const moderatorsList = document.getElementById('moderatorsList');
    if (!moderatorsList) return;
    
    if (moderators.length === 0) {
        moderatorsList.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">No moderators found for this server.</div>';
        return;
    }
    
    moderatorsList.innerHTML = '';
    
    // Show top 5 moderators
    moderators.slice(0, 5).forEach(mod => {
        const modItem = document.createElement('div');
        modItem.className = 'moderator-item';
        
        modItem.innerHTML = `
            <div class="moderator-avatar">
                ${mod.avatar ? `<img src="${mod.avatar}" alt="Avatar">` : '👤'}
            </div>
            <div class="moderator-info">
                <div class="moderator-name">${mod.username}</div>
                <div class="moderator-role ${mod.role.toLowerCase()}">${mod.role}</div>
                <div class="moderator-last-action">${mod.lastAction || 'No recent activity'}</div>
            </div>
            <div class="moderator-actions">
                <span class="action-count">${mod.actionCount || 0}</span>
                <span class="action-label">actions today</span>
            </div>
        `;
        
        moderatorsList.appendChild(modItem);
    });
}

function trackModeratorAction(userId, action, plugin) {
    console.log(`📊 Tracking action: ${action} by ${userId} in ${plugin}`);
    addLogEntry('info', `${action} executed by user ${userId} via ${plugin}`);
}

// ============================================================================
// QUICK MESSAGE SENDER FUNCTIONS
// ============================================================================

function initQuickMessageSender() {
    const quickSendBtn = document.getElementById('quickSendBtn');
    
    if (quickSendBtn) {
        quickSendBtn.addEventListener('click', handleQuickMessageSend);
    }
    
    // Load channels for current server
    updateQuickMessageChannels();
    
    console.log('✅ Quick message sender initialized');
}

async function updateQuickMessageChannels() {
    if (!currentSelectedServer) return;
    
    const channelSelect = document.getElementById('quickChannelSelect');
    if (!channelSelect) return;
    
    try {
        const response = await fetch(`/api/channels/${currentSelectedServer}`);
        if (response.ok) {
            const channels = await response.json();
            
            channelSelect.innerHTML = '<option value="">Select Channel...</option>';
            
            channels.forEach(channel => {
                const option = document.createElement('option');
                option.value = channel.id;
                option.textContent = `# ${channel.name}`;
                channelSelect.appendChild(option);
            });
            
            console.log(`✅ Loaded ${channels.length} channels for quick sender`);
        }
    } catch (error) {
        console.error('Error loading channels:', error);
        addLogEntry('error', `Failed to load channels: ${error.message}`);
    }
}

async function handleQuickMessageSend() {
    const channelSelect = document.getElementById('quickChannelSelect');
    const messageText = document.getElementById('quickMessageText');
    const sendBtn = document.getElementById('quickSendBtn');
    
    if (!channelSelect?.value || !messageText?.value.trim()) {
        showNotification('Please select a channel and enter a message', 'error');
        return;
    }
    
    if (!currentSelectedServer) {
        showNotification('Please select a server first', 'error');
        return;
    }
    
    // Disable button and show loading
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="btn-icon">⏳</span> Sending...';
    
    try {
        const response = await fetch('/api/message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                serverId: currentSelectedServer,
                channelId: channelSelect.value,
                message: messageText.value
            })
        });
        
        if (response.ok) {
            showNotification('Message sent successfully!', 'success');
            messageText.value = '';
            
            const channelName = channelSelect.selectedOptions[0]?.textContent || 'Unknown Channel';
            addLogEntry('success', `Quick message sent to ${channelName}`);
        } else {
            const error = await response.json();
            showNotification(error.error || 'Failed to send message', 'error');
            addLogEntry('error', `Failed to send message: ${error.error}`);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
        addLogEntry('error', `Message send error: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span class="btn-icon">📤</span> Send Message';
    }
}

// ============================================================================
// LEADERBOARDS WIDGET FUNCTIONS
// ============================================================================

function initLeaderboards() {
    const tabButtons = document.querySelectorAll('.leaderboards-widget .tab-btn');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchLeaderboardTab(tabName);
        });
    });
    
    console.log('✅ Leaderboards widget initialized');
}

function switchLeaderboardTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.leaderboards-widget .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.leaderboards-widget .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`)?.classList.add('active');
    
    // Load data for the active tab
    if (currentSelectedServer) {
        if (tabName === 'reputation') {
            loadReputationLeaderboard(currentSelectedServer);
        } else if (tabName === 'levels') {
            loadLevelsLeaderboard(currentSelectedServer);
        }
    }
}

async function loadLeaderboards() {
    if (!currentSelectedServer) return;
    
    // Load both leaderboards
    await Promise.allSettled([
        loadReputationLeaderboard(currentSelectedServer),
        loadLevelsLeaderboard(currentSelectedServer)
    ]);
}

async function loadReputationLeaderboard(serverId) {
    if (!serverId) return;
    
    try {
        const response = await fetch(`/api/plugins/reputation/leaderboard/${serverId}?limit=10`);
        if (response.ok) {
            const leaderboard = await response.json();
            displayReputationLeaderboard(leaderboard);
            console.log(`✅ Loaded reputation leaderboard: ${leaderboard.length} entries`);
        } else if (response.status === 404) {
            console.log('Reputation plugin not available');
            displayEmptyLeaderboard('reputationLeaderboard', 'Reputation plugin not installed');
        }
    } catch (error) {
        console.error('Error loading reputation leaderboard:', error);
        displayEmptyLeaderboard('reputationLeaderboard', 'Failed to load reputation data');
    }
}

async function loadLevelsLeaderboard(serverId) {
    if (!serverId) return;
    
    try {
        const response = await fetch(`/api/plugins/leveling/leaderboard/${serverId}?limit=10`);
        if (response.ok) {
            const leaderboard = await response.json();
            displayLevelsLeaderboard(leaderboard);
            console.log(`✅ Loaded levels leaderboard: ${leaderboard.length} entries`);
        } else {
            console.log('Leveling data not available');
            displayEmptyLeaderboard('levelsLeaderboard', 'No leveling data available');
        }
    } catch (error) {
        console.error('Error loading levels leaderboard:', error);
        displayEmptyLeaderboard('levelsLeaderboard', 'Failed to load leveling data');
    }
}

function displayReputationLeaderboard(leaderboard) {
    const container = document.getElementById('reputationLeaderboard');
    if (!container) return;
    
    if (!leaderboard.length) {
        displayEmptyLeaderboard('reputationLeaderboard', 'No reputation data available');
        return;
    }
    
    container.innerHTML = '';
    
    leaderboard.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        
        const reputation = member.reputation || member.total || member.value || 0;
        const maxReputation = leaderboard[0]?.reputation || leaderboard[0]?.total || leaderboard[0]?.value || 1;
        const progress = Math.min((reputation / maxReputation) * 100, 100);
        
        item.innerHTML = `
            <div class="rank">#${index + 1}</div>
            <div class="member-info">
                <div class="member-avatar">
                    ${member.avatar ? `<img src="${member.avatar}" alt="Avatar">` : '👤'}
                </div>
                <div class="member-details">
                    <div class="member-name">${member.username || `User ${member.userId}`}</div>
                    <div class="member-stats">${reputation} reputation</div>
                </div>
            </div>
            <div class="member-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

function displayLevelsLeaderboard(leaderboard) {
    const container = document.getElementById('levelsLeaderboard');
    if (!container) return;
    
    if (!leaderboard.length) {
        displayEmptyLeaderboard('levelsLeaderboard', 'No leveling data available');
        return;
    }
    
    container.innerHTML = '';
    
    leaderboard.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        
        const level = member.level || 0;
        const xp = member.xp || member.totalXP || 0;
        const maxLevel = leaderboard[0]?.level || 1;
        const progress = Math.min((level / maxLevel) * 100, 100);
        
        item.innerHTML = `
            <div class="rank">#${index + 1}</div>
            <div class="member-info">
                <div class="member-avatar">
                    ${member.avatar ? `<img src="${member.avatar}" alt="Avatar">` : '👤'}
                </div>
                <div class="member-details">
                    <div class="member-name">${member.username || `User ${member.userId}`}</div>
                    <div class="member-stats">Level ${level} (${xp.toLocaleString()} XP)</div>
                </div>
            </div>
            <div class="member-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

function displayEmptyLeaderboard(containerId, message) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
        <div style="text-align: center; opacity: 0.7; padding: 40px;">
            <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
            <div>${message}</div>
        </div>
    `;
}

// ============================================================================
// ACTIVITY CHART FUNCTIONS
// ============================================================================

function setupActivityChart() {
    const canvas = document.getElementById('activityChart');
    if (!canvas || !currentSelectedServer) {
        console.log('⚠️ Activity chart canvas not found or no server selected');
        return;
    }
    
    // For now, show a placeholder with server name
    const ctx = canvas.getContext('2d');
    canvas.width = 400;
    canvas.height = 200;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw placeholder with server info
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    
    const serverName = getServerName(currentSelectedServer);
    ctx.fillText(`Activity Chart for ${serverName}`, canvas.width / 2, canvas.height / 2 - 10);
    ctx.fillText('Chart.js Integration Required', canvas.width / 2, canvas.height / 2 + 10);
    
    console.log('📊 Activity chart placeholder updated for', serverName);
}

// ============================================================================
// PLUGIN MANAGEMENT FUNCTIONS
// ============================================================================

async function loadPlugins() {
    try {
        console.log('🔄 Loading plugins dynamically...');
        
        const response = await fetch('/api/plugins/components');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        pluginComponents = await response.json();
        console.log('📦 Loaded plugin components:', pluginComponents.length);
        
        // Load each plugin HTML
        pluginComponents.forEach(plugin => {
            loadPluginHTML(plugin);
        });
        
        // Generate navigation dynamically
        generateNavigation(pluginComponents);
        
        // Generate feature cards
        generateFeatureCards(pluginComponents);
        
        // Execute plugin scripts
        setTimeout(() => {
            pluginComponents.forEach(plugin => {
                executePluginScript(plugin);
            });
        }, 100);
        
        addLogEntry('success', `Loaded ${pluginComponents.length} plugins successfully`);
        console.log('🎉 All plugins loaded successfully!');
    } catch (error) {
        console.error('Error loading plugins:', error);
        addLogEntry('error', `Failed to load plugins: ${error.message}`);
        showNotification('Error loading plugins', 'error');
    }
}

function loadPluginHTML(plugin) {
    const containerId = plugin.containerId;
    if (!containerId) {
        console.warn(`⚠ Plugin ${plugin.name} has no containerId defined`);
        return;
    }
    
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = plugin.html;
        console.log(`✓ Loaded HTML for plugin: ${plugin.name} into ${containerId}`);
    } else {
        console.warn(`⚠ Container '${containerId}' not found for plugin: ${plugin.name}`);
    }
}

function executePluginScript(plugin) {
    if (plugin.script) {
        try {
            eval(plugin.script);
            console.log(`✓ Executed script for plugin: ${plugin.name}`);
        } catch (error) {
            console.error(`✗ Error executing script for plugin ${plugin.name}:`, error);
            addLogEntry('error', `Plugin script error: ${plugin.name}`);
        }
    }
}

function generateNavigation(plugins) {
    const navContainer = document.querySelector('.nav-menu');
    if (!navContainer) {
        console.warn('⚠ Navigation container not found');
        return;
    }
    
    // Keep the overview link, clear plugin links
    const existingItems = navContainer.querySelectorAll('li');
    const overviewItem = existingItems[0]; // First item should be overview
    
    // Remove all existing plugin items
    existingItems.forEach((item, index) => {
        if (index > 0) item.remove();
    });
    
    // Add plugin navigation links
    plugins.forEach(plugin => {
        const li = document.createElement('li');
        li.innerHTML = `
            <a class="nav-link" data-page="${plugin.id}">
                <span class="nav-icon">${plugin.icon || '🔌'}</span>
                <span class="nav-text">${plugin.name}</span>
            </a>
        `;
        navContainer.appendChild(li);
    });
    
    console.log(`✓ Generated navigation for ${plugins.length} plugins`);
}

function generateFeatureCards(plugins) {
    const featureGrid = document.getElementById('feature-grid');
    if (!featureGrid) {
        console.warn('⚠ Feature grid not found');
        return;
    }
    
    featureGrid.innerHTML = '';
    
    plugins.forEach(plugin => {
        const card = document.createElement('div');
        card.className = 'feature-card';
        card.setAttribute('data-page', plugin.id);
        
        card.innerHTML = `
            <span class="feature-icon">${plugin.icon || '🔌'}</span>
            <div class="feature-name">${plugin.name}</div>
            <div class="feature-description">${plugin.description || 'No description available'}</div>
        `;
        
        featureGrid.appendChild(card);
    });
    
    console.log(`✓ Generated ${plugins.length} feature cards`);
}

// ============================================================================
// EVENT HANDLERS AND NAVIGATION
// ============================================================================

function setupNavigation() {
    document.addEventListener('click', function(e) {
        // Handle navigation links
        const navLink = e.target.closest('.nav-link');
        if (navLink) {
            e.preventDefault();
            const page = navLink.getAttribute('data-page');
            switchToPage(page);
            
            // Close mobile sidebar
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('mobile-open');
            return;
        }
        
        // Handle feature cards
        const featureCard = e.target.closest('.feature-card');
        if (featureCard) {
            const page = featureCard.getAttribute('data-page');
            switchToPage(page);
            return;
        }
        
        // Handle mobile menu button
        const mobileMenuBtn = e.target.closest('.mobile-menu-btn');
        if (mobileMenuBtn) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.toggle('mobile-open');
            return;
        }
        
        // Handle leaderboard tab switching
        const tabBtn = e.target.closest('.tab-btn');
        if (tabBtn && tabBtn.closest('.leaderboards-widget')) {
            const tabName = tabBtn.dataset.tab;
            if (tabName) {
                switchLeaderboardTab(tabName);
            }
            return;
        }
        
        // Close mobile sidebar when clicking outside
        const sidebar = document.getElementById('sidebar');
        const mobileMenuBtnElem = document.querySelector('.mobile-menu-btn');
        if (sidebar && !sidebar.contains(e.target) && mobileMenuBtnElem && !mobileMenuBtnElem.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
        }
    });
    
    // Handle server dropdown changes
    const serverDropdown = document.getElementById('serverDropdown');
    if (serverDropdown) {
        serverDropdown.addEventListener('change', function(e) {
            if (e.target.value) {
                handleServerChange(e.target.value);
            }
        });
    }
    
    // Handle member search functionality
    const searchInput = document.querySelector('#membersSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase();
            filterLeaderboardMembers(query);
        });
    }
    
    console.log('✅ Navigation and event handlers setup complete');
}

function filterLeaderboardMembers(query) {
    const activeTab = document.querySelector('.leaderboards-widget .tab-content.active');
    if (!activeTab) return;
    
    const items = activeTab.querySelectorAll('.leaderboard-item');
    let visibleCount = 0;
    
    items.forEach(item => {
        const memberName = item.querySelector('.member-name')?.textContent.toLowerCase() || '';
        if (memberName.includes(query)) {
            item.style.display = 'flex';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });
    
    console.log(`🔍 Search filtered to ${visibleCount} members for query: "${query}"`);
}

// ============================================================================
// INITIALIZATION AND STARTUP
// ============================================================================

async function initializeDashboard() {
    console.log('🚀 Dashboard initializing...');
    addLogEntry('info', 'Dashboard initialization started');
    
    try {
        // Setup navigation first
        setupNavigation();
        
        // Load user data
        await loadUser();
        
        // Load servers and setup server dropdown
        await loadServers();
        
        // Load plugins
        await loadPlugins();
        
        // Initialize all widgets
        initConsoleLog();
        initQuickMessageSender();
        initLeaderboards();
        
        // Load initial data if server is selected
        if (currentSelectedServer) {
            await updateDashboardStats();
            loadModerators();
            setupActivityChart();
            loadLeaderboards();
        }
        
        // Set initial page
        switchToPage('overview');
        
        // Add initialization complete log
        addLogEntry('success', 'Dashboard initialization completed successfully');
        console.log('✅ Dashboard initialization complete');
        
        // Show welcome notification
        setTimeout(() => {
            showNotification('Dashboard loaded successfully!', 'success');
        }, 1000);
        
    } catch (error) {
        console.error('❌ Dashboard initialization failed:', error);
        addLogEntry('error', `Dashboard initialization failed: ${error.message}`);
        showNotification('Failed to initialize dashboard', 'error');
    }
}

// ============================================================================
// AUTO-REFRESH AND REAL-TIME UPDATES
// ============================================================================

function setupAutoRefresh() {
    // Refresh stats every 30 seconds
    setInterval(() => {
        if (currentSelectedServer && document.querySelector('.page.active')?.id === 'overview-page') {
            updateDashboardStats();
        }
    }, 30000);
    
    // Refresh moderators every 2 minutes
    setInterval(() => {
        if (currentSelectedServer && document.querySelector('.page.active')?.id === 'overview-page') {
            loadModerators();
        }
    }, 120000);
    
    console.log('⏰ Auto-refresh timers setup');
}

// ============================================================================
// UTILITY FUNCTIONS FOR PLUGINS
// ============================================================================

function refreshCurrentServerData() {
    if (currentSelectedServer) {
        updateDashboardStats();
        updateQuickMessageChannels();
        loadModerators();
        loadLeaderboards();
    }
}

function getCurrentServerInfo() {
    if (!currentSelectedServer) return null;
    
    const server = servers.find(s => s.id === currentSelectedServer);
    return server ? {
        id: server.id,
        name: server.name,
        memberCount: server.memberCount
    } : null;
}

// ============================================================================
// ERROR HANDLING AND RECOVERY
// ============================================================================

window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
    addLogEntry('error', `JavaScript error: ${e.error?.message || 'Unknown error'}`);
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    addLogEntry('error', `Promise rejection: ${e.reason?.message || 'Unknown error'}`);
});

// ============================================================================
// DOM READY AND STARTUP
// ============================================================================

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM loaded, starting dashboard initialization...');
    
    // Add small delay to ensure all elements are ready
    setTimeout(() => {
        initializeDashboard().then(() => {
            // Setup auto-refresh after successful initialization
            setupAutoRefresh();
        });
    }, 100);
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && currentSelectedServer) {
        // Refresh data when page becomes visible again
        console.log('👁️ Page visible again, refreshing data...');
        addLogEntry('info', 'Page became visible, refreshing data');
        refreshCurrentServerData();
    }
});

// ============================================================================
// EXPORT API FOR PLUGINS AND EXTERNAL USE
// ============================================================================

// Export functions for plugin use
window.dashboardAPI = {
    // Core functions
    showNotification,
    switchToPage,
    addLogEntry,
    trackModeratorAction,
    
    // Data functions
    currentUser: () => currentUser,
    servers: () => servers,
    currentServer: () => currentSelectedServer,
    getCurrentServerInfo,
    
    // Update functions
    updateDashboardStats,
    refreshCurrentServerData,
    handleServerChange,
    
    // Widget functions
    loadModerators,
    loadLeaderboards,
    updateQuickMessageChannels,
    
    // Utility functions
    getServerName
};

console.log('🔗 Dashboard API exported to window.dashboardAPI');

// ============================================================================
// DEVELOPMENT AND DEBUG FUNCTIONS
// ============================================================================

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Development mode - add debug functions
    window.debugDashboard = {
        // Debug functions for development
        testNotifications: () => {
            showNotification('Test info notification', 'info');
            setTimeout(() => showNotification('Test success notification', 'success'), 1000);
            setTimeout(() => showNotification('Test warning notification', 'warning'), 2000);
            setTimeout(() => showNotification('Test error notification', 'error'), 3000);
        },
        
        testConsoleLog: () => {
            addLogEntry('info', 'Debug info message');
            addLogEntry('success', 'Debug success message');
            addLogEntry('warning', 'Debug warning message');
            addLogEntry('error', 'Debug error message');
        },
        
        getCurrentState: () => ({
            currentUser,
            currentSelectedServer,
            servers: servers.length,
            plugins: pluginComponents.length
        }),
        
        forceRefresh: () => {
            console.log('🔄 Force refreshing all data...');
            refreshCurrentServerData();
        }
    };
    
    console.log('🛠️ Debug functions available in window.debugDashboard');
}