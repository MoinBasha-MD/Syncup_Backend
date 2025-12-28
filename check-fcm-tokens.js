/**
 * Quick script to check FCM tokens for a user
 * Usage: node check-fcm-tokens.js <userId>
 */

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/userModel');

async function checkTokens(userId) {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    if (!userId) {
      console.log('📋 Listing all users with FCM tokens:\n');
      const users = await User.find(
        { 'fcmTokens.0': { $exists: true } },
        { userId: 1, name: 1, fcmTokens: 1 }
      ).limit(10);

      if (users.length === 0) {
        console.log('⚠️  No users found with FCM tokens');
        process.exit(0);
      }

      users.forEach((user, idx) => {
        console.log(`${idx + 1}. ${user.name} (${user.userId})`);
        console.log(`   Tokens: ${user.fcmTokens.length}`);
        user.fcmTokens.forEach((token, tidx) => {
          console.log(`   - Token ${tidx + 1}: ${token.token.substring(0, 40)}...`);
          console.log(`     Platform: ${token.platform}`);
          console.log(`     Added: ${token.addedAt}`);
        });
        console.log('');
      });

      console.log(`\n💡 To check specific user: node check-fcm-tokens.js ${users[0].userId}`);
      process.exit(0);
    }

    // Check specific user
    const user = await User.findOne({ userId }).select('userId name fcmTokens');

    if (!user) {
      console.log(`❌ User not found: ${userId}`);
      process.exit(1);
    }

    console.log(`👤 User: ${user.name}`);
    console.log(`🆔 UserID: ${user.userId}`);
    console.log(`📱 FCM Tokens: ${user.fcmTokens?.length || 0}\n`);

    if (!user.fcmTokens || user.fcmTokens.length === 0) {
      console.log('⚠️  No FCM tokens registered for this user');
      console.log('\n💡 User needs to:');
      console.log('   1. Open the app');
      console.log('   2. Login');
      console.log('   3. Grant notification permissions');
      console.log('   4. Wait for FCM token to register\n');
      process.exit(0);
    }

    user.fcmTokens.forEach((token, idx) => {
      console.log(`Token ${idx + 1}:`);
      console.log(`  Full Token: ${token.token}`);
      console.log(`  Platform: ${token.platform}`);
      console.log(`  Added: ${token.addedAt}`);
      console.log('');
    });

    console.log('✅ User has valid FCM tokens');
    console.log(`\n💡 Test notification: node test-fcm-connection.js ${userId}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

const userId = process.argv[2];
checkTokens(userId);
