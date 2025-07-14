const fs = require('fs');
const path = require('path');

// Simple script to reset all users to Level 5 (2,500 XP)
async function resetToLevel5() {
    const dataFile = path.join(__dirname, 'data', 'levelingData.json');
    const backupDir = path.join(__dirname, 'backups');
    const backupFile = path.join(backupDir, `levelingData_backup_${Date.now()}.json`);
    
    try {
        console.log('🔄 Starting level reset to Level 5...');
        
        // Ensure backup directory exists
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Read current data
        if (!fs.existsSync(dataFile)) {
            console.log('❌ levelingData.json not found in data folder!');
            console.log('Expected path:', dataFile);
            return;
        }
        
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        
        // Create backup
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
        console.log(`✅ Backup created: ${path.basename(backupFile)}`);
        
        let usersReset = 0;
        let totalUsers = 0;
        
        // Count total users first
        for (const userId in data.users) {
            for (const guildId in data.users[userId]) {
                if (data.users[userId][guildId]) {
                    totalUsers++;
                }
            }
        }
        
        console.log(`📊 Found ${totalUsers} user records to process`);
        
        // Reset all users to Level 5 (2,500 XP)
        for (const userId in data.users) {
            for (const guildId in data.users[userId]) {
                if (data.users[userId][guildId]) {
                    const oldLevel = data.users[userId][guildId].level || 0;
                    const oldXP = data.users[userId][guildId].xp || 0;
                    
                    data.users[userId][guildId].level = 5;
                    data.users[userId][guildId].xp = 2500;
                    
                    if (oldLevel !== 5 || oldXP !== 2500) {
                        usersReset++;
                        
                        // Show first 5 changes
                        if (usersReset <= 5) {
                            console.log(`   👤 User ${userId} in guild ${guildId}: Level ${oldLevel} (${oldXP} XP) → Level 5 (2500 XP)`);
                        }
                    }
                }
            }
        }
        
        // Save modified data
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        
        console.log(`\n✅ Reset complete!`);
        console.log(`   🔄 Users modified: ${usersReset}/${totalUsers}`);
        console.log(`   🎯 All users are now Level 5 with 2,500 XP`);
        console.log(`   📁 Backup saved in backups/ folder`);
        
        if (usersReset === 0) {
            console.log(`   ℹ️  All users were already at Level 5 with 2,500 XP`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Full error:', error);
    }
}

// Run the reset
resetToLevel5();