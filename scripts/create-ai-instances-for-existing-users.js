#!/usr/bin/env node

const mongoose = require('mongoose');
const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
require('dotenv').config();

console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🤖 CREATE AI INSTANCES FOR EXISTING USERS          ║
║                                                              ║
║  This script will create AI instances for all existing      ║
║  users who don't have one yet.                              ║
╚══════════════════════════════════════════════════════════════╝
`);

async function createAIInstancesForExistingUsers() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Get all users
    console.log('\n👥 Fetching all users...');
    const allUsers = await User.find({}).select('_id userId username name email phoneNumber');
    console.log(`📊 Found ${allUsers.length} total users`);

    if (allUsers.length === 0) {
      console.log('ℹ️  No users found in database');
      return;
    }

    // Check which users already have AI instances
    console.log('\n🔍 Checking existing AI instances...');
    const existingAIInstances = await AIInstance.find({}).select('userId');
    const usersWithAI = new Set(existingAIInstances.map(ai => ai.userId));
    
    console.log(`📊 Found ${existingAIInstances.length} existing AI instances`);
    console.log(`📊 ${usersWithAI.size} users already have AI instances`);

    // Filter users who need AI instances
    const usersNeedingAI = allUsers.filter(user => {
      const userIdStr = user._id.toString();
      const userIdField = user.userId;
      return !usersWithAI.has(userIdStr) && !usersWithAI.has(userIdField);
    });

    console.log(`📊 ${usersNeedingAI.length} users need AI instances created`);

    if (usersNeedingAI.length === 0) {
      console.log('✅ All users already have AI instances!');
      return;
    }

    console.log('\n🤖 Creating AI instances...');
    let successCount = 0;
    let errorCount = 0;

    for (const user of usersNeedingAI) {
      try {
        // Use the user's _id as the userId for AI instance
        const userId = user._id.toString();
        const userName = user.name || user.username || 'User';
        
        console.log(`\n👤 Creating AI for: ${userName} (${user.email || user.phoneNumber})`);
        console.log(`   User ID: ${userId}`);

        // Create AI instance
        const aiInstance = new AIInstance({
          userId: userId,
          aiName: `${userName}'s Maya`,
          status: 'offline', // Start as offline
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
            autoApprovalSettings: {
              lowPriorityRequests: false,
              trustedAIsOnly: true,
              maxAutoApprovalDuration: 30
            },
            responseTimePreference: 'normal'
          },
          networkSettings: {
            allowDirectMentions: true,
            allowGroupMentions: true,
            trustedAIs: [],
            blockedAIs: [],
            allowedGroups: []
          },
          stats: {
            totalConversations: 0,
            successfulInteractions: 0,
            averageResponseTime: 0,
            lastCalculated: new Date()
          },
          version: '1.0.0',
          isActive: true
        });

        await aiInstance.save();
        
        console.log(`   ✅ AI Instance created: ${aiInstance.aiId}`);
        console.log(`   📝 AI Name: ${aiInstance.aiName}`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Failed to create AI for ${user.name || user.username}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 CREATION SUMMARY:');
    console.log(`✅ Successfully created: ${successCount} AI instances`);
    console.log(`❌ Failed to create: ${errorCount} AI instances`);
    console.log(`📊 Total processed: ${usersNeedingAI.length} users`);

    if (successCount > 0) {
      console.log(`
🎉 SUCCESS! 

${successCount} AI instances have been created for existing users.
These users can now use the AI-to-AI communication features!

Next steps:
1. Users need to restart their app to initialize their AI
2. AI instances will come online when users open Maya
3. Test @DirectMention functionality with these users
      `);
    }

    if (errorCount > 0) {
      console.log(`
⚠️  Some AI instances failed to create. Check the errors above.
You may need to run this script again for failed users.
      `);
    }

  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Confirmation prompt
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\n⚠️  This will create AI instances for all existing users without one. Continue? (y/N): ', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    console.log('\n🚀 Starting AI instance creation...');
    createAIInstancesForExistingUsers()
      .then(() => {
        console.log('\n✅ Script completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
      });
  } else {
    console.log('\n❌ Script cancelled by user');
    process.exit(0);
  }
  rl.close();
});
