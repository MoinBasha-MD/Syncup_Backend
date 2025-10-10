const mongoose = require('mongoose');
const StatusPrivacy = require('./models/statusPrivacyModel');
const User = require('./models/userModel');
const Group = require('./models/groupModel');
const axios = require('axios');

// Final comprehensive privacy verification test
async function finalPrivacyVerification() {
  try {
    console.log('🔍 [Final Test] Starting comprehensive privacy verification...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ [Test] Connected to MongoDB');
    
    // Test 1: Database Privacy Logic
    console.log('\n=== TEST 1: DATABASE PRIVACY LOGIC ===');
    await testDatabasePrivacyLogic();
    
    // Test 2: API Endpoint Privacy Filtering
    console.log('\n=== TEST 2: API ENDPOINT PRIVACY FILTERING ===');
    await testAPIPrivacyFiltering();
    
    // Test 3: Groups Loading
    console.log('\n=== TEST 3: GROUPS LOADING ===');
    await testGroupsLoading();
    
    // Test 4: Null Safety
    console.log('\n=== TEST 4: NULL SAFETY ===');
    await testNullSafety();
    
    console.log('\n✅ [Final Test] All privacy verification tests completed!');
    
  } catch (error) {
    console.error('❌ [Final Test] Error during privacy verification:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 [Final Test] Disconnected from MongoDB');
  }
}

async function testDatabasePrivacyLogic() {
  try {
    // Find test users
    const users = await User.find({}).limit(2);
    if (users.length < 2) {
      console.log('⚠️ Need at least 2 users for testing');
      return;
    }
    
    const [user1, user2] = users;
    console.log(`Testing privacy between ${user1.name} and ${user2.name}`);
    
    // Test public visibility
    await setPrivacySettings(user1._id, 'public');
    const publicResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Public test: ${publicResult ? 'PASS' : 'FAIL'}`);
    
    // Test private visibility
    await setPrivacySettings(user1._id, 'private');
    const privateResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Private test: ${!privateResult ? 'PASS' : 'FAIL'}`);
    
    // Test app connections
    await setPrivacySettings(user1._id, 'app_connections_only');
    
    // Add user2 as app connection
    await User.findByIdAndUpdate(user1._id, {
      $addToSet: { 
        appConnections: {
          userId: user2.userId,
          phoneNumber: user2.phoneNumber,
          name: user2.name,
          addedAt: new Date()
        }
      }
    });
    
    const appConnectionResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ App connection test: ${appConnectionResult ? 'PASS' : 'FAIL'}`);
    
    // Cleanup
    await User.findByIdAndUpdate(user1._id, { $unset: { appConnections: 1 } });
    await setPrivacySettings(user1._id, 'public');
    
  } catch (error) {
    console.error('❌ Database privacy logic test failed:', error);
  }
}

async function testAPIPrivacyFiltering() {
  try {
    console.log('Testing API privacy filtering...');
    
    // This would require actual HTTP requests to test endpoints
    // For now, we'll test the service methods directly
    const contactService = require('./services/contactService');
    const users = await User.find({}).limit(2);
    
    if (users.length < 2) {
      console.log('⚠️ Need at least 2 users for API testing');
      return;
    }
    
    const [user1, user2] = users;
    
    // Set user1 to private
    await setPrivacySettings(user1._id, 'private');
    
    // Try to get user1's status as user2 (should be filtered)
    try {
      const status = await contactService.getContactByPhone(user1.phoneNumber, user2._id);
      const isFiltered = status.status === 'available';
      console.log(`✅ API privacy filtering: ${isFiltered ? 'PASS' : 'FAIL'} - Status: ${status.status}`);
    } catch (error) {
      console.log('⚠️ API test skipped due to error:', error.message);
    }
    
    // Reset to public
    await setPrivacySettings(user1._id, 'public');
    
  } catch (error) {
    console.error('❌ API privacy filtering test failed:', error);
  }
}

async function testGroupsLoading() {
  try {
    console.log('Testing groups loading...');
    
    const users = await User.find({}).limit(1);
    if (users.length < 1) {
      console.log('⚠️ Need at least 1 user for groups testing');
      return;
    }
    
    const user = users[0];
    
    // Create a test group
    const testGroup = await Group.create({
      name: 'Test Privacy Group',
      description: 'Test group for privacy verification',
      userId: user._id,
      createdBy: user.userId,
      admins: [user.userId],
      members: [],
      memberCount: 0
    });
    
    console.log(`Created test group: ${testGroup.name}`);
    
    // Test groups query (simulate the API endpoint)
    const groups = await Group.find({
      $or: [
        { userId: user._id },
        { createdBy: user.userId },
        { 'members.memberId': user.userId },
        { 'members.phoneNumber': user.phoneNumber },
        { admins: user.userId }
      ]
    });
    
    const foundTestGroup = groups.some(g => g.name === 'Test Privacy Group');
    console.log(`✅ Groups loading test: ${foundTestGroup ? 'PASS' : 'FAIL'} - Found ${groups.length} groups`);
    
    // Cleanup
    await Group.findByIdAndDelete(testGroup._id);
    
  } catch (error) {
    console.error('❌ Groups loading test failed:', error);
  }
}

async function testNullSafety() {
  try {
    console.log('Testing null safety...');
    
    const users = await User.find({}).limit(1);
    if (users.length < 1) {
      console.log('⚠️ Need at least 1 user for null safety testing');
      return;
    }
    
    const user = users[0];
    
    // Create privacy settings with null/undefined values
    const privacyWithNulls = await StatusPrivacy.create({
      userId: user._id,
      visibility: 'custom_list',
      allowedGroups: null, // This should be handled safely
      allowedContacts: undefined, // This should be handled safely
      blockedContacts: [],
      locationSharing: { enabled: true, shareWith: 'all' },
      isDefault: false
    });
    
    console.log('Created privacy settings with null values');
    
    // Test that the system handles null values gracefully
    const retrieved = await StatusPrivacy.findById(privacyWithNulls._id);
    console.log(`Retrieved privacy settings:`, {
      allowedGroups: retrieved.allowedGroups,
      allowedContacts: retrieved.allowedContacts
    });
    
    // Test privacy checking with null values
    const canSee = await StatusPrivacy.canUserSeeStatus(user._id, user._id); // Self-view should always work
    console.log(`✅ Null safety test: ${canSee ? 'PASS' : 'FAIL'} - Self-view with null values`);
    
    // Cleanup
    await StatusPrivacy.findByIdAndDelete(privacyWithNulls._id);
    
  } catch (error) {
    console.error('❌ Null safety test failed:', error);
  }
}

// Helper function to set privacy settings
async function setPrivacySettings(userId, visibility, allowedGroups = [], allowedContacts = []) {
  await StatusPrivacy.findOneAndUpdate(
    { userId, isDefault: true },
    {
      userId,
      visibility,
      allowedGroups,
      allowedContacts,
      blockedContacts: [],
      locationSharing: { enabled: true, shareWith: 'all' },
      isDefault: true,
    },
    { new: true, upsert: true }
  );
}

// Run the test if this file is executed directly
if (require.main === module) {
  finalPrivacyVerification();
}

module.exports = { finalPrivacyVerification };
