const fs = require('fs');
const path = require('path');

class PluginLoader {
    constructor() {
        this.plugins = [];
        this.pluginDir = path.join(__dirname);
    }

    loadPlugins(app, client, ensureAuthenticated, hasAdminPermissions) {
        try {
            const pluginFiles = fs.readdirSync(this.pluginDir)
                .filter(file => file.endsWith('.js') && file !== 'pluginLoader.js');

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(this.pluginDir, file);
                    const Plugin = require(pluginPath);
                    
                    if (typeof Plugin === 'function') {
                        const plugin = new Plugin(app, client, ensureAuthenticated, hasAdminPermissions);
                        this.plugins.push(plugin);
                        console.log(`✓ Loaded plugin: ${file}`);
                    } else {
                        console.warn(`⚠ Plugin ${file} does not export a constructor function`);
                    }
                } catch (error) {
                    console.error(`✗ Failed to load plugin ${file}:`, error.message);
                }
            }

            console.log(`📦 Loaded ${this.plugins.length} plugins`);
            return this.plugins;
        } catch (error) {
            console.error('Error loading plugins:', error);
            return [];
        }
    }

    getPluginInfo() {
        return this.plugins.map(plugin => ({
            name: plugin.name || 'Unknown',
            description: plugin.description || 'No description',
            version: plugin.version || '1.0.0',
            enabled: plugin.enabled !== false
        }));
    }

    getPluginComponents() {
        const components = [];
        
        for (const plugin of this.plugins) {
            if (plugin.getFrontendComponent) {
                try {
                    const component = plugin.getFrontendComponent();
                    if (component) {
                        components.push(component);
                    }
                } catch (error) {
                    console.error(`Error getting frontend component from plugin ${plugin.name}:`, error);
                }
            }
        }
        
        return components;
    }

    // --- NEW METHOD: Gathers all slash commands from all plugins ---
    getAllSlashCommands() {
        let allCommands = [];
        for (const plugin of this.plugins) {
            if (typeof plugin.getSlashCommands === 'function') {
                try {
                    const pluginCommands = plugin.getSlashCommands();
                    if (Array.isArray(pluginCommands)) {
                        allCommands = allCommands.concat(pluginCommands);
                    }
                } catch (error) {
                    console.error(`Error getting slash commands from ${plugin.name}:`, error);
                }
            }
        }
        return allCommands;
    }
}

module.exports = new PluginLoader();