// Global variables
let currentUser = null;
let pluginComponents = [];
let currentSelectedServer = null;
let servers = [];
let consoleLogWebSocket = null;

// Utility Functions
function showNotification(message, type = 'info') {
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
    }
    
    console.log(`🔄 Switched to page: ${pageId}`);
}

// 1. Global Server Management
function handleServerChange(serverId) {
    currentSelectedServer = serverId;
    console.log(`🔄 Server changed to: ${serverId}`);
    
    // Update all widgets when server changes
    updateDashboardStats();
    updateQuickMessageChannels();
    loadModerators();
    loadLeaderboards();
    setupActivityChart();
    
    showNotification(`Switched to server: ${getServerName(serverId)}`, 'info');
}

function populateServerDropdown() {
    const serverDropdown = document.getElementById('serverDropdown');
    if (!serverDropdown || !servers.length) return;
    
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
        handleServerChange(currentSelectedServer);
    }
    
    console.log('✅ Server dropdown populated with', servers.length, 'servers');
}

function getServerName(serverId) {
    const server = servers.find(s => s.id === serverId);
    return server ? server.name : 'Unknown Server';
}

// Load user information
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
    } catch (error) {
        console.error('Error loading user:', error);
        window.location.href = '/login.html';
    }
}

// Load servers for stats
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
        return [];
    }
}

// 2. Updated Stats Functions
async function updateDashboardStats() {
    try {
        if (!currentSelectedServer) {
            console.log('⚠️ No server selected for stats update');
            return;
        }
        
        // Get server-specific data
        const serverStatsPromises = [
            getOnlineUsers(currentSelectedServer),
            getTotalServerUsers(currentSelectedServer),
            getTotalServerMessages(currentSelectedServer)
        ];
        
        const [onlineUsers, totalUsers, totalMessages] = await Promise.all(serverStatsPromises);
        
        // Update stat cards with server-specific data
        const onlineUsersEl = document.getElementById('onlineUsers');
        const totalServerUsersEl = document.getElementById('totalServerUsers');
        const activePluginsEl = document.getElementById('activePlugins');
        const totalServerMessagesEl = document.getElementById('totalServerMessages');
        
        if (onlineUsersEl) {
            onlineUsersEl.textContent = onlineUsers.toLocaleString();
        }
        
        if (totalServerUsersEl) {
            totalServerUsersEl.textContent = totalUsers.toLocaleString();
        }
        
        // Count active plugins
        const activePluginCount = pluginComponents.filter(plugin => plugin.enabled !== false).length;
        if (activePluginsEl) {
            activePluginsEl.textContent = activePluginCount.toString();
        }
        
        if (totalServerMessagesEl) {
            totalServerMessagesEl.textContent = totalMessages.toLocaleString();
        }
        
        console.log('✅ Dashboard stats updated for server:', currentSelectedServer);
    } catch (error) {
        console.error('Error updating dashboard stats:', error);
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
    } catch (error) {
        console.error('Error fetching online users:', error);
    }
    
    // Fallback: find server in cache and estimate online users
    const server = servers.find(s => s.id === serverId);
    return server ? Math.floor((server.memberCount || 0) * 0.1) : 0; // Estimate 10% online
}

async function getTotalServerUsers(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/stats`);
        if (response.ok) {
            const data = await response.json();
            return data.memberCount || 0;
        }
    } catch (error) {
        console.error('Error fetching server users:', error);
    }
    
    // Fallback: use cached server data
    const server = servers.find(s => s.id === serverId);
    return server ? server.memberCount || 0 : 0;
}

async function getTotalServerMessages(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/message-stats`);
        if (response.ok) {
            const data = await response.json();
            return data.totalMessages || 0;
        }
    } catch (error) {
        console.error('Error fetching message stats:', error);
    }
    
    // Fallback: generate mock data based on server size
    const server = servers.find(s => s.id === serverId);
    const memberCount = server ? server.memberCount || 0 : 0;
    return Math.floor(memberCount * 50); // Estimate 50 messages per member
}

// 3. Console Log Widget Functions
function initConsoleLog() {
    const consoleToggleBtn = document.getElementById('consoleToggle');
    const consoleClearBtn = document.querySelector('.console-clear-btn');
    const consoleContent = document.getElementById('consoleContent');
    
    // Setup expand/collapse
    if (consoleToggleBtn) {
        consoleToggleBtn.addEventListener('click', toggleConsoleLog);
    }
    
    // Setup clear functionality
    if (consoleClearBtn) {
        consoleClearBtn.addEventListener('click', clearConsoleLog);
    }
    
    // Initialize WebSocket for real-time logs (if available)
    // setupConsoleWebSocket();
    
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

function addLogEntry(level, message) {
    const consoleLog = document.getElementById('consoleLog');
    if (!consoleLog) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${level}`;
    
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    logEntry.innerHTML = `
        <span class="log-time">${timestamp}</span>
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

// 4. Moderator Profiles Widget Functions
async function loadModerators() {
    if (!currentSelectedServer) return;
    
    const moderatorsList = document.getElementById('moderatorsList');
    if (!moderatorsList) return;
    
    try {
        const response = await fetch(`/api/servers/${currentSelectedServer}/moderators`);
        if (response.ok) {
            const moderators = await response.json();
            displayModerators(moderators);
        } else {
            // Show placeholder data
            displayModerators([]);
        }
    } catch (error) {
        console.error('Error loading moderators:', error);
        displayModerators([]);
    }
}

function displayModerators(moderators) {
    const moderatorsList = document.getElementById('moderatorsList');
    if (!moderatorsList) return;
    
    if (moderators.length === 0) {
        // Keep existing placeholder data
        return;
    }
    
    moderatorsList.innerHTML = '';
    
    moderators.forEach(mod => {
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
    // This would be called by plugins to track moderator actions
    console.log(`📊 Tracking action: ${action} by ${userId} in ${plugin}`);
}

// 5. Quick Message Sender Functions
function initQuickMessageSender() {
    const quickSendBtn = document.getElementById('quickSendBtn');
    
    if (quickSendBtn) {
        quickSendBtn.addEventListener('click', handleQuickMessageSend);
    }
    
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
        }
    } catch (error) {
        console.error('Error loading channels:', error);
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
            addLogEntry('success', `Quick message sent to #${channelSelect.selectedOptions[0]?.textContent}`);
        } else {
            const error = await response.json();
            showNotification(error.error || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showNotification('Failed to send message', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span class="btn-icon">📤</span> Send Message';
    }
}

// 6. Leaderboards Widget Functions
function initLeaderboards() {
    const tabButtons = document.querySelectorAll('.leaderboards-widget .tab-btn');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchLeaderboardTab(tabName);
        });
    });
    
    // Load initial data
    loadLeaderboards();
    
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
    if (tabName === 'reputation') {
        loadReputationLeaderboard(currentSelectedServer);
    } else if (tabName === 'levels') {
        loadLevelsLeaderboard(currentSelectedServer);
    }
}

async function loadLeaderboards() {
    if (!currentSelectedServer) return;
    
    // Load both leaderboards
    await Promise.all([
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
        } else {
            console.log('Reputation plugin not available or no data');
        }
    } catch (error) {
        console.error('Error loading reputation leaderboard:', error);
    }
}

async function loadLevelsLeaderboard(serverId) {
    if (!serverId) return;
    
    try {
        const response = await fetch(`/api/plugins/leveling/leaderboard/${serverId}?limit=10`);
        if (response.ok) {
            const leaderboard = await response.json();
            displayLevelsLeaderboard(leaderboard);
        } else {
            console.log('Leveling plugin not available or no data');
        }
    } catch (error) {
        console.error('Error loading levels leaderboard:', error);
    }
}

function displayReputationLeaderboard(leaderboard) {
    const container = document.getElementById('reputationLeaderboard');
    if (!container || !leaderboard.length) return;
    
    container.innerHTML = '';
    
    leaderboard.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        
        const reputation = member.reputation || member.total || 0;
        const progress = Math.min((reputation / (leaderboard[0]?.reputation || leaderboard[0]?.total || 1)) * 100, 100);
        
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
    if (!container || !leaderboard.length) return;
    
    container.innerHTML = '';
    
    leaderboard.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        
        const level = member.level || 0;
        const xp = member.xp || member.totalXP || 0;
        const progress = Math.min((level / (leaderboard[0]?.level || 1)) * 100, 100);
        
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

// 7. Real-time Activity Chart
function setupActivityChart() {
    const canvas = document.getElementById('activityChart');
    if (!canvas) return;
    
    // For now, show a placeholder. In the future, integrate Chart.js
    const ctx = canvas.getContext('2d');
    canvas.width = 400;
    canvas.height = 200;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw placeholder
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Activity Chart - Chart.js Integration Required', canvas.width / 2, canvas.height / 2);
    
    console.log('📊 Activity chart placeholder updated');
}

// Load plugins dynamically
async function loadPlugins() {
    try {
        console.log('🔄 Loading plugins dynamically...');
        
        const response = await fetch('/api/plugins/components');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        pluginComponents = await response.json();
        console.log('📦 Loaded plugin components:', pluginComponents);
        
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
        
        console.log('🎉 All plugins loaded successfully!');
    } catch (error) {
        console.error('Error loading plugins:', error);
        showNotification('Error loading plugins', 'error');
    }
}

// Load individual plugin HTML
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

// Execute plugin script
function executePluginScript(plugin) {
    if (plugin.script) {
        try {
            eval(plugin.script);
            console.log(`✓ Executed script for plugin: ${plugin.name}`);
        } catch (error) {
            console.error(`✗ Error executing script for plugin ${plugin.name}:`, error);
        }
    }
}

// Generate navigation dynamically
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

// Generate feature cards for overview page
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

// Setup navigation and event handlers
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
    
    // Handle search functionality
    const searchInput = document.querySelector('#membersSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase();
            filterLeaderboardMembers(query);
        });
    }
}

function filterLeaderboardMembers(query) {
    const activeTab = document.querySelector('.leaderboards-widget .tab-content.active');
    if (!activeTab) return;
    
    const items = activeTab.querySelectorAll('.leaderboard-item');
    items.forEach(item => {
        const memberName = item.querySelector('.member-name')?.textContent.toLowerCase() || '';
        if (memberName.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Initialize dashboard
async function initializeDashboard() {
    console.log('🚀 Dashboard initializing...');
    
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
        }
        
        // Set initial page
        switchToPage('overview');
        
        // Add some sample console logs
        addLogEntry('info', 'Dashboard initialized successfully');
        addLogEntry('success', `Loaded ${pluginComponents.length} plugins`);
        
        console.log('✅ Dashboard initialization complete');
    } catch (error) {
        console.error('❌ Dashboard initialization failed:', error);
        showNotification('Failed to initialize dashboard', 'error');
        addLogEntry('error', `Dashboard initialization failed: ${error.message}`);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDashboard);

// Export functions for plugin use
window.dashboardAPI = {
    showNotification,
    switchToPage,
    currentUser: () => currentUser,
    servers: () => servers,
    currentServer: () => currentSelectedServer,
    addLogEntry,
    trackModeratorAction,
    updateDashboardStats,
    handleServerChange
};