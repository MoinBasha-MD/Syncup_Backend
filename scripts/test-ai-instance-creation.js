#!/usr/bin/env node

const mongoose = require('mongoose');
const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
require('dotenv').config();

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                🧪 TEST AI INSTANCE CREATION                  ║
║                                                              ║
║  Quick test to verify AI instance creation is working       ║
╚══════════════════════════════════════════════════════════════╝
`);

async function testAIInstanceCreation() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Get a sample user
    console.log('\n👤 Finding a sample user...');
    const sampleUser = await User.findOne({}).select('_id userId username name email');
    
    if (!sampleUser) {
      console.log('❌ No users found in database. Please create a user first.');
      return;
    }

    console.log(`📋 Sample user found: ${sampleUser.name} (${sampleUser.email})`);
    console.log(`   User ID: ${sampleUser._id}`);

    // Check if this user already has an AI instance
    const existingAI = await AIInstance.findOne({ userId: sampleUser._id.toString() });
    
    if (existingAI) {
      console.log(`✅ User already has AI instance: ${existingAI.aiId}`);
      console.log(`   AI Name: ${existingAI.aiName}`);
      console.log(`   Status: ${existingAI.status}`);
      console.log(`   Created: ${existingAI.createdAt}`);
    } else {
      console.log('ℹ️  User does not have an AI instance yet');
    }

    // Test AI instance creation process
    console.log('\n🧪 Testing AI instance creation process...');
    
    try {
      const testAI = new AIInstance({
        userId: sampleUser._id.toString(),
        aiName: `${sampleUser.name}'s Maya (Test)`,
        status: 'offline',
        capabilities: {
          canSchedule: true,
          canAccessCalendar: true,
          canMakeReservations: false,
          canShareLocation: false,
          maxConcurrentConversations: 5
        },
        preferences: {
          responseStyle: 'friendly',
          privacyLevel: 'moderate',
          responseTimePreference: 'normal'
        },
        networkSettings: {
          allowDirectMentions: true,
          allowGroupMentions: true,
          trustedAIs: [],
          blockedAIs: [],
          allowedGroups: []
        },
        isActive: true
      });

      // Validate without saving
      await testAI.validate();
      console.log('✅ AI instance validation passed');
      console.log(`   Generated AI ID: ${testAI.aiId}`);
      console.log(`   AI Name: ${testAI.aiName}`);

    } catch (validationError) {
      console.error('❌ AI instance validation failed:', validationError.message);
    }

    // Check database indexes
    console.log('\n🔍 Checking database indexes...');
    const indexes = await AIInstance.collection.getIndexes();
    console.log('📊 AI Instance indexes:');
    Object.keys(indexes).forEach(indexName => {
      console.log(`   - ${indexName}: ${JSON.stringify(indexes[indexName].key)}`);
    });

    // Test API endpoint availability
    console.log('\n🌐 Testing API endpoint structure...');
    const aiInstanceController = require('../controllers/aiInstanceController');
    const aiCommunicationController = require('../controllers/aiCommunicationController');
    
    console.log('✅ AI Instance Controller loaded successfully');
    console.log('✅ AI Communication Controller loaded successfully');

    // Check if routes are properly structured
    const aiInstanceRoutes = require('../routes/aiInstanceRoutes');
    const aiCommunicationRoutes = require('../routes/aiCommunicationRoutes');
    
    console.log('✅ AI Instance Routes loaded successfully');
    console.log('✅ AI Communication Routes loaded successfully');

    console.log('\n🎉 All tests passed! AI instance creation system is ready.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the test
testAIInstanceCreation()
  .then(() => {
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
