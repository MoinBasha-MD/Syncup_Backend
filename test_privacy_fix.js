const mongoose = require('mongoose');
const StatusPrivacy = require('./models/statusPrivacyModel');
const User = require('./models/userModel');

// Test script to verify privacy settings are working
async function testPrivacySettings() {
  try {
    console.log('🧪 [Test] Starting privacy settings test...');
    
    // Connect to MongoDB (use your connection string)
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ [Test] Connected to MongoDB');
    
    // Find two test users
    const users = await User.find({}).limit(2);
    if (users.length < 2) {
      console.log('❌ [Test] Need at least 2 users in database for testing');
      return;
    }
    
    const user1 = users[0];
    const user2 = users[1];
    
    console.log(`🧪 [Test] Testing privacy between ${user1.name} and ${user2.name}`);
    
    // Test 1: Default settings (should be public)
    console.log('\n--- Test 1: Default Privacy Settings ---');
    let canSee = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`Can ${user2.name} see ${user1.name}'s status (default): ${canSee}`);
    
    // Test 2: Set privacy to app_connections_only
    console.log('\n--- Test 2: App Connections Only ---');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'app_connections_only',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: { enabled: true, shareWith: 'all' },
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    canSee = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`Can ${user2.name} see ${user1.name}'s status (app connections only): ${canSee}`);
    
    // Test 3: Set privacy to private
    console.log('\n--- Test 3: Private ---');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'private',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: { enabled: true, shareWith: 'all' },
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    canSee = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`Can ${user2.name} see ${user1.name}'s status (private): ${canSee}`);
    
    // Test 4: Set privacy to custom_list with user2 allowed
    console.log('\n--- Test 4: Custom List (with user2 allowed) ---');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'custom_list',
        allowedGroups: [],
        allowedContacts: [user2._id],
        blockedContacts: [],
        locationSharing: { enabled: true, shareWith: 'all' },
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    canSee = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`Can ${user2.name} see ${user1.name}'s status (custom list - allowed): ${canSee}`);
    
    // Test 5: Set privacy to custom_list without user2 allowed
    console.log('\n--- Test 5: Custom List (without user2 allowed) ---');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'custom_list',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: { enabled: true, shareWith: 'all' },
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    canSee = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`Can ${user2.name} see ${user1.name}'s status (custom list - not allowed): ${canSee}`);
    
    // Reset to public for cleanup
    console.log('\n--- Cleanup: Reset to Public ---');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'public',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: { enabled: true, shareWith: 'all' },
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    console.log('✅ [Test] Privacy settings test completed successfully!');
    
  } catch (error) {
    console.error('❌ [Test] Error during privacy test:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 [Test] Disconnected from MongoDB');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPrivacySettings();
}

module.exports = { testPrivacySettings };
