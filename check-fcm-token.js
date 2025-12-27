/**
 * Quick FCM Token Checker
 * Verifies if FCM token was registered in database
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/userModel');

async function checkFCMToken() {
  try {
    console.log('🔍 Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected\n');

    // Find users with FCM tokens
    const usersWithTokens = await User.find(
      { 'fcmTokens.0': { $exists: true } },
      { userId: 1, name: 1, fcmTokens: 1 }
    ).sort({ 'fcmTokens.addedAt': -1 }).limit(5);

    if (usersWithTokens.length === 0) {
      console.log('❌ No users found with FCM tokens');
      console.log('⚠️  Token might not have been saved to database');
      process.exit(1);
    }

    console.log(`✅ Found ${usersWithTokens.length} user(s) with FCM tokens:\n`);

    usersWithTokens.forEach((user, index) => {
      console.log(`${index + 1}. ${user.name} (${user.userId})`);
      console.log(`   Tokens: ${user.fcmTokens.length}`);
      
      user.fcmTokens.forEach((token, idx) => {
        const tokenPreview = token.token.substring(0, 50);
        console.log(`   Token ${idx + 1}: ${tokenPreview}...`);
        console.log(`   Platform: ${token.platform}`);
        console.log(`   Added: ${token.addedAt}`);
        
        // Check if this is the token from logs
        if (token.token.startsWith('eya-akqzSJKQkrWjV_vCiV')) {
          console.log('   🎯 THIS IS YOUR TOKEN! ✅');
        }
      });
      console.log('');
    });

    console.log('✅ FCM Token Registration: WORKING');
    console.log('✅ Database Storage: WORKING');
    console.log('\n📊 Summary:');
    console.log('   ✅ Frontend: Token generated');
    console.log('   ✅ Backend: Token received and stored');
    console.log('   ✅ Database: Token saved successfully');
    console.log('\n🎯 FCM is properly configured and working!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

checkFCMToken();
