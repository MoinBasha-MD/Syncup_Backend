#!/usr/bin/env node

const mongoose = require('mongoose');
const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
require('dotenv').config();

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🔍 DEBUG AI INSTANCES                     ║
║                                                              ║
║  Check what AI instances exist and their user ID formats    ║
╚══════════════════════════════════════════════════════════════╝
`);

async function debugAIInstances() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Get all users
    console.log('\n👥 Checking users...');
    const users = await User.find({}).select('_id userId username name email').limit(5);
    console.log(`📊 Found ${users.length} users (showing first 5):`);
    
    users.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.name} (${user.email})`);
      console.log(`      _id: ${user._id}`);
      console.log(`      userId: ${user.userId}`);
    });

    // Get all AI instances
    console.log('\n🤖 Checking AI instances...');
    const aiInstances = await AIInstance.find({}).select('aiId userId aiName status isActive');
    console.log(`📊 Found ${aiInstances.length} AI instances:`);
    
    aiInstances.forEach((ai, index) => {
      console.log(`   ${index + 1}. ${ai.aiName} (${ai.aiId})`);
      console.log(`      userId: ${ai.userId}`);
      console.log(`      status: ${ai.status}`);
      console.log(`      isActive: ${ai.isActive}`);
    });

    // Test user-AI matching
    console.log('\n🔍 Testing user-AI matching...');
    for (const user of users) {
      const userIdStr = user._id.toString();
      const userIdField = user.userId;
      
      console.log(`\n👤 Testing user: ${user.name}`);
      console.log(`   _id: ${userIdStr}`);
      console.log(`   userId: ${userIdField}`);
      
      // Try finding AI with _id
      const aiWithId = await AIInstance.findOne({ userId: userIdStr, isActive: true });
      console.log(`   AI with _id: ${aiWithId ? aiWithId.aiId : 'NOT FOUND'}`);
      
      // Try finding AI with userId field
      const aiWithUserId = await AIInstance.findOne({ userId: userIdField, isActive: true });
      console.log(`   AI with userId: ${aiWithUserId ? aiWithUserId.aiId : 'NOT FOUND'}`);
      
      // Try the enhanced findByUserId method
      const aiWithMethod = await AIInstance.findByUserId(userIdStr);
      console.log(`   AI with method: ${aiWithMethod ? aiWithMethod.aiId : 'NOT FOUND'}`);
    }

    console.log('\n✅ Debug completed!');

  } catch (error) {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the debug
debugAIInstances()
  .then(() => {
    console.log('\n✅ Debug completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Debug failed:', error);
    process.exit(1);
  });
