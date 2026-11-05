/**
 * Check User FCM Tokens in Database
 * Direct database query to see token storage
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function checkTokens() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = mongoose.connection.collection('users');
    
    // Find user by userId
    const userId = '38283786-efcf-45bf-9f8b-42c3122857b5';
    const user = await User.findOne({ userId });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }
    
    console.log('✅ User found:', user.name);
    console.log('   User ID:', user.userId);
    console.log('   Email:', user.email);
    console.log('\n📱 FCM Tokens:');
    
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      console.log(`   Total: ${user.fcmTokens.length}\n`);
      
      user.fcmTokens.forEach((token, idx) => {
        console.log(`   Token ${idx + 1}:`);
        console.log(`   - Token: ${token.token.substring(0, 60)}...`);
        console.log(`   - Platform: ${token.platform}`);
        console.log(`   - Added: ${token.addedAt}`);
        console.log('');
      });
      
      console.log('✅ FCM tokens found in database!');
    } else {
      console.log('   ❌ No FCM tokens found');
      console.log('\n🔍 User object keys:');
      console.log(Object.keys(user));
      
      console.log('\n🔍 Checking if fcmTokens field exists:');
      console.log('   fcmTokens:', user.fcmTokens);
      
      console.log('\n⚠️  Token might have been registered but not saved to this user');
      console.log('   Check backend logs for token registration errors');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

checkTokens();
