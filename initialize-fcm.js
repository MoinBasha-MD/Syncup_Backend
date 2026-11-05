/**
 * Manual FCM Initialization Script
 * Forces FCM service to initialize and shows detailed error messages
 */

const admin = require('firebase-admin');
const path = require('path');

async function initializeFCM() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 MANUAL FCM INITIALIZATION');
  console.log('='.repeat(60) + '\n');

  try {
    console.log('📋 Step 1: Loading service account file...');
    const serviceAccountPath = path.join(__dirname, 'config', 'firebase-service-account.json');
    console.log(`   Path: ${serviceAccountPath}`);
    
    const serviceAccount = require(serviceAccountPath);
    console.log('✅ Service account file loaded');
    console.log(`   Project ID: ${serviceAccount.project_id}`);
    console.log(`   Client Email: ${serviceAccount.client_email}`);
    
    console.log('\n📋 Step 2: Checking if Firebase Admin is already initialized...');
    if (admin.apps.length > 0) {
      console.log('⚠️  Firebase Admin already initialized');
      console.log('   Deleting existing app...');
      await admin.app().delete();
      console.log('✅ Existing app deleted');
    } else {
      console.log('✅ No existing Firebase Admin app');
    }
  
  console.log('\n📋 Step 3: Initializing Firebase Admin SDK...');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  
  console.log('✅ Firebase Admin SDK initialized successfully!');
  
  console.log('\n📋 Step 4: Testing FCM messaging...');
  const messaging = admin.messaging();
  console.log('✅ FCM Messaging instance created');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ FCM INITIALIZATION SUCCESSFUL');
  console.log('='.repeat(60));
  
  console.log('\n📊 Summary:');
  console.log('   ✅ Service account: Valid');
  console.log('   ✅ Firebase Admin: Initialized');
  console.log('   ✅ FCM Messaging: Ready');
  console.log(`   ✅ Project: ${serviceAccount.project_id}`);
  
  console.log('\n🎯 Next Steps:');
  console.log('   1. Restart your backend server: pm2 restart server');
  console.log('   2. Check logs: pm2 logs server | grep FCM');
  console.log('   3. FCM should initialize automatically on startup');
  
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ FCM INITIALIZATION FAILED');
    console.error('='.repeat(60));
    console.error('\nError Details:');
    console.error(`   Type: ${error.code || 'Unknown'}`);
    console.error(`   Message: ${error.message}`);
    
    if (error.stack) {
      console.error('\nStack Trace:');
      console.error(error.stack);
    }
    
    console.error('\n🔧 Troubleshooting:');
    
    if (error.message.includes('ENOENT')) {
      console.error('   ❌ File not found');
      console.error('   → Check if firebase-service-account.json exists in config folder');
    } else if (error.message.includes('JSON')) {
      console.error('   ❌ Invalid JSON format');
      console.error('   → Check if firebase-service-account.json is valid JSON');
    } else if (error.message.includes('credential')) {
      console.error('   ❌ Invalid credentials');
      console.error('   → Download a new service account key from Firebase Console');
    } else if (error.message.includes('permission')) {
      console.error('   ❌ Permission denied');
      console.error('   → Check file permissions: chmod 644 config/firebase-service-account.json');
    } else {
      console.error('   ❌ Unknown error');
      console.error('   → Check Firebase Console for project status');
      console.error('   → Verify service account has FCM permissions');
    }
    
    process.exit(1);
  }
}

// Run the initialization
initializeFCM();
