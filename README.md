# 🍑 Fuji Fruit Bot

A powerful Discord bot with a web dashboard for server management, featuring a plugin-based architecture.

## Features

- 💬 **Message Sender**: Send messages with attachments, replies, emojis, and stickers
- 🚫 **Word Filter**: Automatically detect and filter inappropriate words
- 📈 **Leveling System**: XP and leveling with multiple sources and leaderboards
- 🔌 **Plugin System**: Easily extensible with custom plugins

## Quick Start

### Prerequisites
- Node.js 16+ 
- Discord Application with Bot Token

### Installation

1. Clone the repository:
```bash
git clone https://github.com/MowgiAU/fuji-fruit-bot.git
cd fuji-fruit-bot

2. Install dependencies:

bashnpm install

3. Configure environment:

bashcp .env.example .env
# Edit .env with your Discord bot credentials

4. Start the bot:

bashnpm start

5. Visit http://localhost:3000 and login with Discord

### Discord Setup

Go to Discord Developer Portal
Create a new application
Go to "Bot" section and create a bot
Copy the bot token to your .env file
Go to "OAuth2" section and add redirect URL: http://localhost:3000/auth/discord/callback
Invite bot to your server with Administrator permissions

### Plugin Development
Create new plugins by adding files to the /plugins/ directory:
javascriptclass MyPlugin {
    constructor(app, client, ensureAuthenticated, hasAdminPermissions) {
        this.name = 'My Plugin';
        this.description = 'Does amazing things';
        this.version = '1.0.0';
        this.enabled = true;
        
        this.app = app;
        this.client = client;
        this.ensureAuthenticated = ensureAuthenticated;
        this.hasAdminPermissions = hasAdminPermissions;
        
        this.setupRoutes();
    }
    
    setupRoutes() {
        this.app.get('/api/plugins/myplugin/test', this.ensureAuthenticated, (req, res) => {
            res.json({ message: 'Hello from my plugin!' });
        });
    }
    
    getFrontendComponent() {
        return {
            id: 'my-plugin',
            name: 'My Plugin',
            description: 'Amazing plugin functionality',
            icon: '⭐',
            html: `<div class="plugin-container">...</div>`,
            script: `console.log('My plugin loaded!');`
        };
    }
}

module.exports = MyPlugin;

### Architecture

Backend: Express.js + Discord.js v14
Frontend: Vanilla JavaScript with glassmorphism UI
Storage: JSON files (no database required)
Authentication: Discord OAuth
Deployment: PM2 ready

### Contributing

Fork the repository
Create a feature branch
Make your changes
Test thoroughly
Submit a pull request

### License
MIT License - see LICENSE file for details