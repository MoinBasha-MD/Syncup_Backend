/**
 * FCM Connection Test Script
 * Tests if FCM is properly initialized and can send notifications
 * 
 * Usage: node test-fcm-connection.js <userId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import FCM service
const fcmNotificationService = require('./services/fcmNotificationService');
const User = require('./models/userModel');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.cyan}📋 ${msg}${colors.reset}`)
};

async function testFCMConnection(userId) {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 FCM CONNECTION TEST');
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Connect to MongoDB
    log.step('Step 1: Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    log.success('Connected to MongoDB');

    // Step 2: Initialize FCM Service (if not already initialized)
    log.step('\nStep 2: Initializing FCM Service...');
    
    // Call initialize to ensure FCM is ready
    fcmNotificationService.initialize();
    
    // Small delay to allow initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const isEnabled = fcmNotificationService.isEnabled();
    
    if (isEnabled) {
      log.success('FCM Service is initialized and enabled');
    } else {
      log.error('FCM Service failed to initialize');
      log.warning('Check if firebase-service-account.json exists in config folder');
      log.warning('Run: node initialize-fcm.js for detailed error messages');
      process.exit(1);
    }

    // Step 3: Check Firebase Service Account
    log.step('\nStep 3: Checking Firebase Service Account...');
    try {
      const serviceAccount = require('./config/firebase-service-account.json');
      log.success('Firebase service account file found');
      log.info(`Project ID: ${serviceAccount.project_id}`);
      log.info(`Client Email: ${serviceAccount.client_email}`);
    } catch (error) {
      log.error('Firebase service account file not found or invalid');
      log.warning('Path: ./config/firebase-service-account.json');
      process.exit(1);
    }

    // Step 4: Check User and FCM Tokens
    log.step('\nStep 4: Checking user FCM tokens...');
    
    if (!userId) {
      log.warning('No userId provided. Usage: node test-fcm-connection.js <userId>');
      log.info('Listing users with FCM tokens...\n');
      
      const usersWithTokens = await User.find(
        { 'fcmTokens.0': { $exists: true } },
        { userId: 1, name: 1, fcmTokens: 1 }
      ).limit(5);
      
      if (usersWithTokens.length === 0) {
        log.warning('No users found with FCM tokens');
        log.info('Make sure users have logged in and FCM tokens are registered');
        process.exit(0);
      }
      
      console.log('\nUsers with FCM tokens:');
      usersWithTokens.forEach((user, index) => {
        console.log(`\n${index + 1}. User: ${user.name} (${user.userId})`);
        console.log(`   Tokens: ${user.fcmTokens.length}`);
        user.fcmTokens.forEach((token, idx) => {
          console.log(`   - Token ${idx + 1}: ${token.token.substring(0, 30)}...`);
          console.log(`     Platform: ${token.platform}`);
          console.log(`     Added: ${token.addedAt}`);
        });
      });
      
      log.info('\nRun again with userId to test notification:');
      log.info(`node test-fcm-connection.js ${usersWithTokens[0].userId}`);
      process.exit(0);
    }

    // Find specific user
    const user = await User.findOne({ userId }).select('userId name fcmTokens');
    
    if (!user) {
      log.error(`User not found: ${userId}`);
      process.exit(1);
    }
    
    log.success(`User found: ${user.name} (${userId})`);
    
    if (!user.fcmTokens || user.fcmTokens.length === 0) {
      log.error('User has no FCM tokens registered');
      log.warning('Make sure user has logged in and FCM is initialized on app');
      process.exit(1);
    }
    
    log.success(`User has ${user.fcmTokens.length} FCM token(s)`);
    user.fcmTokens.forEach((token, idx) => {
      console.log(`   Token ${idx + 1}: ${token.token.substring(0, 40)}...`);
      console.log(`   Platform: ${token.platform}`);
      console.log(`   Added: ${token.addedAt}`);
    });

    // Step 5: Send Test Notification
    log.step('\nStep 5: Sending test notification...');
    
    const result = await fcmNotificationService.sendTestNotification(userId, {
      title: '🧪 FCM Connection Test',
      body: 'If you see this, FCM is working perfectly!',
      data: {
        testId: Date.now().toString(),
        source: 'test-fcm-connection.js'
      }
    });

    if (result.success) {
      log.success('Test notification sent successfully!');
      console.log(`   Sent to: ${result.sentCount} device(s)`);
      console.log(`   Failed: ${result.failedCount} device(s)`);
      console.log(`   Total tokens: ${result.totalTokens}`);
      
      log.info('\nCheck your device - you should receive a notification!');
      log.info('If app is closed, notification should wake it up.');
    } else {
      log.error('Failed to send test notification');
      console.log(`   Error: ${result.error || 'Unknown error'}`);
      process.exit(1);
    }

    // Step 6: Summary
    console.log('\n' + '='.repeat(60));
    log.success('FCM CONNECTION TEST COMPLETED');
    console.log('='.repeat(60));
    
    console.log('\n📊 Summary:');
    console.log(`   ✅ FCM Service: Enabled`);
    console.log(`   ✅ Firebase Config: Valid`);
    console.log(`   ✅ User Tokens: ${user.fcmTokens.length} registered`);
    console.log(`   ✅ Test Notification: Sent successfully`);
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Check your device for the test notification');
    console.log('   2. Try closing the app completely and send a message');
    console.log('   3. You should receive notification even when app is closed');
    
    console.log('\n');

  } catch (error) {
    log.error('Test failed with error:');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    log.info('MongoDB connection closed');
  }
}

// Get userId from command line arguments
const userId = process.argv[2];

// Run test
testFCMConnection(userId);
