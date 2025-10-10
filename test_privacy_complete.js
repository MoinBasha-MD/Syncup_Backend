const mongoose = require('mongoose');
const StatusPrivacy = require('./models/statusPrivacyModel');
const User = require('./models/userModel');
const Group = require('./models/groupModel');

// Comprehensive end-to-end privacy testing
async function testCompletePrivacySystem() {
  try {
    console.log('🧪 [Complete Test] Starting comprehensive privacy system test...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ [Test] Connected to MongoDB');
    
    // Find test users
    const users = await User.find({}).limit(3);
    if (users.length < 3) {
      console.log('❌ [Test] Need at least 3 users in database for comprehensive testing');
      return;
    }
    
    const [user1, user2, user3] = users;
    console.log(`🧪 [Test] Testing with users: ${user1.name}, ${user2.name}, ${user3.name}`);
    
    // Test 1: Public Visibility
    console.log('\n=== TEST 1: PUBLIC VISIBILITY ===');
    await setPrivacySettings(user1._id, 'public');
    const publicResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Public test: ${publicResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${publicResult}`);
    
    // Test 2: Private Visibility
    console.log('\n=== TEST 2: PRIVATE VISIBILITY ===');
    await setPrivacySettings(user1._id, 'private');
    const privateResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Private test: ${!privateResult ? 'PASS' : 'FAIL'} - Expected: false, Got: ${privateResult}`);
    
    // Test 3: Contacts Only (simulate adding user2 as contact of user1)
    console.log('\n=== TEST 3: CONTACTS ONLY ===');
    await setPrivacySettings(user1._id, 'contacts_only');
    
    // Add user2 to user1's contacts
    await User.findByIdAndUpdate(user1._id, {
      $addToSet: { contacts: user2._id }
    });
    
    const contactsResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Contacts only test: ${contactsResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${contactsResult}`);
    
    // Test with non-contact
    const nonContactResult = await StatusPrivacy.canUserSeeStatus(user1._id, user3._id);
    console.log(`✅ Non-contact test: ${!nonContactResult ? 'PASS' : 'FAIL'} - Expected: false, Got: ${nonContactResult}`);
    
    // Test 4: App Connections Only (simulate app connection)
    console.log('\n=== TEST 4: APP CONNECTIONS ONLY ===');
    await setPrivacySettings(user1._id, 'app_connections_only');
    
    // Add user2 as app connection of user1
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
    console.log(`✅ App connection test: ${appConnectionResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${appConnectionResult}`);
    
    // Test with non-app-connection
    const nonAppConnectionResult = await StatusPrivacy.canUserSeeStatus(user1._id, user3._id);
    console.log(`✅ Non-app-connection test: ${!nonAppConnectionResult ? 'PASS' : 'FAIL'} - Expected: false, Got: ${nonAppConnectionResult}`);
    
    // Test 5: Custom List
    console.log('\n=== TEST 5: CUSTOM LIST ===');
    await setPrivacySettings(user1._id, 'custom_list', [], [user2._id]);
    
    const customListResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Custom list (allowed) test: ${customListResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${customListResult}`);
    
    const customListNotAllowedResult = await StatusPrivacy.canUserSeeStatus(user1._id, user3._id);
    console.log(`✅ Custom list (not allowed) test: ${!customListNotAllowedResult ? 'PASS' : 'FAIL'} - Expected: false, Got: ${customListNotAllowedResult}`);
    
    // Test 6: Selected Groups
    console.log('\n=== TEST 6: SELECTED GROUPS ===');
    
    // Create a test group with user1 as owner and user2 as member
    const testGroup = await Group.create({
      name: 'Privacy Test Group',
      description: 'Test group for privacy testing',
      userId: user1._id,
      createdBy: user1.userId,
      admins: [user1.userId],
      members: [
        {
          memberId: user2.userId,
          memberType: 'app_connection',
          userId: user2.userId,
          name: user2.name,
          profileImage: user2.profileImage || '',
          role: 'member',
          addedBy: user1.userId
        }
      ],
      memberCount: 1
    });
    
    console.log(`📋 Created test group: ${testGroup.name} (${testGroup._id})`);
    
    await setPrivacySettings(user1._id, 'selected_groups', [testGroup._id], []);
    
    const groupMemberResult = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log(`✅ Group member test: ${groupMemberResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${groupMemberResult}`);
    
    const nonGroupMemberResult = await StatusPrivacy.canUserSeeStatus(user1._id, user3._id);
    console.log(`✅ Non-group member test: ${!nonGroupMemberResult ? 'PASS' : 'FAIL'} - Expected: false, Got: ${nonGroupMemberResult}`);
    
    // Test 7: Self-view (should always be true)
    console.log('\n=== TEST 7: SELF-VIEW ===');
    const selfViewResult = await StatusPrivacy.canUserSeeStatus(user1._id, user1._id);
    console.log(`✅ Self-view test: ${selfViewResult ? 'PASS' : 'FAIL'} - Expected: true, Got: ${selfViewResult}`);
    
    // Cleanup
    console.log('\n=== CLEANUP ===');
    await Group.findByIdAndDelete(testGroup._id);
    await User.findByIdAndUpdate(user1._id, {
      $pull: { contacts: user2._id },
      $unset: { appConnections: 1 }
    });
    await setPrivacySettings(user1._id, 'public'); // Reset to public
    
    console.log('✅ [Complete Test] All privacy tests completed!');
    
  } catch (error) {
    console.error('❌ [Complete Test] Error during comprehensive privacy test:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 [Complete Test] Disconnected from MongoDB');
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
  console.log(`🔧 Set privacy for user ${userId} to: ${visibility}`);
}

// Run the test if this file is executed directly
if (require.main === module) {
  testCompletePrivacySystem();
}

module.exports = { testCompletePrivacySystem };
