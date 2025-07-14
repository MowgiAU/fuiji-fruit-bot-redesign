const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

/**
 * Simple script to sync level roles for reset users only
 */

async function syncLevelRoles() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    try {
        console.log('🎭 Starting Level Role Sync...\n');

        // Load environment
        require('dotenv').config();
        if (!process.env.DISCORD_BOT_TOKEN) {
            throw new Error('DISCORD_BOT_TOKEN not found in .env file');
        }

        // Login to Discord
        await client.login(process.env.DISCORD_BOT_TOKEN);
        console.log(`✅ Logged in as ${client.user.tag}`);

        // Wait for ready
        if (!client.isReady()) {
            await new Promise(resolve => client.once('ready', resolve));
        }
        console.log('🤖 Bot is ready!\n');

        // Load backup file to get user list
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            throw new Error('Backup directory not found');
        }

        const backupFiles = fs.readdirSync(backupDir)
            .filter(file => file.includes('backup') && file.endsWith('.json'))
            .sort()
            .reverse();

        if (backupFiles.length === 0) {
            throw new Error('No backup files found');
        }

        console.log(`📁 Using backup: ${backupFiles[0]}`);
        const backupPath = path.join(backupDir, backupFiles[0]);
        const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        const targetUserIds = Object.keys(backupData.users || {});
        console.log(`👥 Found ${targetUserIds.length} users in backup\n`);

        // Load level roles configuration
        const levelRolesFile = path.join(__dirname, 'data', 'levelRoles.json');
        if (!fs.existsSync(levelRolesFile)) {
            throw new Error('Level roles configuration not found');
        }

        const levelRolesData = JSON.parse(fs.readFileSync(levelRolesFile, 'utf8'));
        const guildsWithLevelRoles = Object.keys(levelRolesData).filter(guildId => 
            levelRolesData[guildId].enabled && levelRolesData[guildId].roles.length > 0
        );

        if (guildsWithLevelRoles.length === 0) {
            throw new Error('No guilds have level roles enabled');
        }

        console.log(`🏠 Found ${guildsWithLevelRoles.length} guild(s) with level roles enabled\n`);

        // Load leveling data
        const levelingDataFile = path.join(__dirname, 'data', 'levelingData.json');
        const levelingData = JSON.parse(fs.readFileSync(levelingDataFile, 'utf8'));

        let totalUsersProcessed = 0;
        let totalRolesAdded = 0;
        let totalRolesRemoved = 0;

        // Process each guild
        for (const guildId of guildsWithLevelRoles) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                console.log(`⚠️ Guild ${guildId} not found, skipping...`);
                continue;
            }

            const levelRoleConfig = levelRolesData[guildId];
            const sortedLevelRoles = levelRoleConfig.roles.sort((a, b) => a.level - b.level);

            console.log(`🏠 Processing guild: ${guild.name}`);
            console.log(`📋 Level roles configured: ${sortedLevelRoles.length}`);

            // Show configured roles
            sortedLevelRoles.forEach(levelRole => {
                const role = guild.roles.cache.get(levelRole.roleId);
                console.log(`   Level ${levelRole.level}: ${role ? role.name : 'MISSING'} ${levelRole.removeOldRoles ? '(removes lower)' : '(keeps lower)'}`);
            });

            let guildUsersProcessed = 0;
            let guildRolesAdded = 0;
            let guildRolesRemoved = 0;

            // Process each target user in this guild
            for (const userId of targetUserIds) {
                if (!levelingData.users[userId] || !levelingData.users[userId][guildId]) {
                    continue; // User not in this guild
                }

                const userLevel = levelingData.users[userId][guildId].level || 0;
                
                // Get member
                let member;
                try {
                    member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
                } catch (error) {
                    continue; // Member not found or left guild
                }

                // Calculate correct roles for this user's level
                const shouldHaveRoles = [];
                for (const levelRole of sortedLevelRoles) {
                    if (userLevel >= levelRole.level) {
                        if (levelRole.removeOldRoles) {
                            // Remove any previous level roles if this role removes old ones
                            const rolesToRemove = shouldHaveRoles.filter(roleId => {
                                const prevRole = sortedLevelRoles.find(lr => lr.roleId === roleId);
                                return prevRole && prevRole.level < levelRole.level;
                            });
                            rolesToRemove.forEach(roleId => {
                                const index = shouldHaveRoles.indexOf(roleId);
                                if (index > -1) shouldHaveRoles.splice(index, 1);
                            });
                        }
                        shouldHaveRoles.push(levelRole.roleId);
                    }
                }

                // Check what roles need to be added/removed
                const rolesToAdd = [];
                const rolesToRemove = [];

                for (const levelRole of sortedLevelRoles) {
                    const shouldHave = shouldHaveRoles.includes(levelRole.roleId);
                    const currentlyHas = member.roles.cache.has(levelRole.roleId);

                    if (shouldHave && !currentlyHas) {
                        rolesToAdd.push(levelRole.roleId);
                    } else if (!shouldHave && currentlyHas) {
                        rolesToRemove.push(levelRole.roleId);
                    }
                }

                // Apply role changes
                if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
                    try {
                        if (rolesToAdd.length > 0) {
                            await member.roles.add(rolesToAdd, 'Level role sync after reset');
                            guildRolesAdded += rolesToAdd.length;
                            console.log(`   ✅ Added ${rolesToAdd.length} role(s) to ${member.user.username}`);
                        }

                        if (rolesToRemove.length > 0) {
                            await member.roles.remove(rolesToRemove, 'Level role sync - remove old');
                            guildRolesRemoved += rolesToRemove.length;
                            console.log(`   🗑️ Removed ${rolesToRemove.length} role(s) from ${member.user.username}`);
                        }

                        guildUsersProcessed++;

                        // Small delay to avoid rate limits
                        if (guildUsersProcessed % 5 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                    } catch (error) {
                        console.log(`   ❌ Error syncing ${member.user.username}: ${error.message}`);
                    }
                }
            }

            console.log(`📊 Guild Summary: ${guildUsersProcessed} users processed, ${guildRolesAdded} roles added, ${guildRolesRemoved} roles removed\n`);
            
            totalUsersProcessed += guildUsersProcessed;
            totalRolesAdded += guildRolesAdded;
            totalRolesRemoved += guildRolesRemoved;

            // Delay between guilds
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('✅ Level role sync completed!');
        console.log(`📊 Total Summary:`);
        console.log(`   👥 Users processed: ${totalUsersProcessed}`);
        console.log(`   ➕ Roles added: ${totalRolesAdded}`);
        console.log(`   ➖ Roles removed: ${totalRolesRemoved}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        if (client) {
            await client.destroy();
            console.log('🔌 Disconnected from Discord');
        }
    }
}

// Check if this is a dry run
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--analyze');

if (isDryRun) {
    console.log('🔍 DRY RUN MODE - This will only show what would change, no actual modifications will be made.\n');
    console.log('To perform actual sync, run: node simpleSyncRoles.js\n');
    
    // For dry run, we'll just show the configuration
    async function dryRun() {
        try {
            // Load level roles
            const levelRolesFile = path.join(__dirname, 'data', 'levelRoles.json');
            if (!fs.existsSync(levelRolesFile)) {
                throw new Error('Level roles configuration not found');
            }

            const levelRolesData = JSON.parse(fs.readFileSync(levelRolesFile, 'utf8'));
            const guildsWithLevelRoles = Object.keys(levelRolesData).filter(guildId => 
                levelRolesData[guildId].enabled && levelRolesData[guildId].roles.length > 0
            );

            console.log(`📋 Found ${guildsWithLevelRoles.length} guild(s) with level roles configured:`);
            
            guildsWithLevelRoles.forEach(guildId => {
                const config = levelRolesData[guildId];
                console.log(`\n🏠 Guild ${guildId}:`);
                config.roles.sort((a, b) => a.level - b.level).forEach(levelRole => {
                    console.log(`   Level ${levelRole.level}: Role ${levelRole.roleId} ${levelRole.removeOldRoles ? '(removes lower)' : '(keeps lower)'}`);
                });
            });

            // Load backup info
            const backupDir = path.join(__dirname, 'backups');
            if (fs.existsSync(backupDir)) {
                const backupFiles = fs.readdirSync(backupDir)
                    .filter(file => file.includes('backup') && file.endsWith('.json'))
                    .sort()
                    .reverse();

                if (backupFiles.length > 0) {
                    console.log(`\n📁 Most recent backup: ${backupFiles[0]}`);
                    const backupPath = path.join(backupDir, backupFiles[0]);
                    const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
                    const userCount = Object.keys(backupData.users || {}).length;
                    console.log(`👥 Users in backup: ${userCount}`);
                }
            }

            console.log('\n✅ Dry run completed. Run without --dry-run to perform actual sync.');

        } catch (error) {
            console.error('❌ Error in dry run:', error.message);
        }
    }

    dryRun();
} else {
    // Run actual sync
    syncLevelRoles();
}
