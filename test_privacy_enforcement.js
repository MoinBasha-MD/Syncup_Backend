const mongoose = require('mongoose');
const User = require('./models/userModel');
const StatusPrivacy = require('./models/statusPrivacyModel');
const Group = require('./models/groupModel');

// Test script to verify privacy enforcement
async function testPrivacyEnforcement() {
  try {
    // Connect to MongoDB (adjust connection string as needed)
    await mongoose.connect('mongodb://localhost:27017/syncup', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Create test users
    const user1 = await User.findOneAndUpdate(
      { phoneNumber: '+1234567890' },
      {
        name: 'Test User 1',
        phoneNumber: '+1234567890',
        status: 'busy',
        customStatus: 'In a meeting',
      },
      { upsert: true, new: true }
    );

    const user2 = await User.findOneAndUpdate(
      { phoneNumber: '+1234567891' },
      {
        name: 'Test User 2',
        phoneNumber: '+1234567891',
        status: 'available',
        customStatus: 'Ready to chat',
      },
      { upsert: true, new: true }
    );

    console.log('✅ Created test users');
    console.log('User 1:', user1._id, user1.name);
    console.log('User 2:', user2._id, user2.name);

    // Test 1: Public visibility
    console.log('\n🔍 Test 1: Public visibility');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'public',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeePublic = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (public):', canSeePublic);
    console.log('Expected: true, Actual:', canSeePublic, canSeePublic ? '✅' : '❌');

    // Test 2: Private visibility
    console.log('\n🔍 Test 2: Private visibility');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'private',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeePrivate = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (private):', canSeePrivate);
    console.log('Expected: false, Actual:', canSeePrivate, !canSeePrivate ? '✅' : '❌');

    // Test 3: Friends visibility (should return true for now since areUsersConnected returns true)
    console.log('\n🔍 Test 3: Friends visibility');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'friends',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeeFriends = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (friends):', canSeeFriends);
    console.log('Expected: true (hardcoded), Actual:', canSeeFriends, canSeeFriends ? '✅' : '❌');

    // Test 4: Contacts visibility
    console.log('\n🔍 Test 4: Contacts visibility');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'contacts',
        allowedGroups: [],
        allowedContacts: [user2._id], // Allow user2 to see
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeeContacts = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (contacts - allowed):', canSeeContacts);
    console.log('Expected: true, Actual:', canSeeContacts, canSeeContacts ? '✅' : '❌');

    // Test 5: Contacts visibility - not allowed
    console.log('\n🔍 Test 5: Contacts visibility - not allowed');
    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'contacts',
        allowedGroups: [],
        allowedContacts: [], // Don't allow user2 to see
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeeContactsBlocked = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (contacts - not allowed):', canSeeContactsBlocked);
    console.log('Expected: false, Actual:', canSeeContactsBlocked, !canSeeContactsBlocked ? '✅' : '❌');

    // Test 6: Groups visibility
    console.log('\n🔍 Test 6: Groups visibility');
    
    // Create a test group with user2 as member
    const testGroup = await Group.findOneAndUpdate(
      { name: 'Test Group' },
      {
        name: 'Test Group',
        description: 'Test group for privacy',
        members: [user2._id],
        memberCount: 1,
      },
      { upsert: true, new: true }
    );

    await StatusPrivacy.findOneAndUpdate(
      { userId: user1._id, isDefault: true },
      {
        userId: user1._id,
        visibility: 'groups',
        allowedGroups: [testGroup._id], // Allow the test group
        allowedContacts: [],
        blockedContacts: [],
        isDefault: true,
      },
      { upsert: true, new: true }
    );

    const canSeeGroups = await StatusPrivacy.canUserSeeStatus(user1._id, user2._id);
    console.log('Can user2 see user1 status (groups - member):', canSeeGroups);
    console.log('Expected: true, Actual:', canSeeGroups, canSeeGroups ? '✅' : '❌');

    // Test 7: Self visibility (should always be true)
    console.log('\n🔍 Test 7: Self visibility');
    const canSeeSelf = await StatusPrivacy.canUserSeeStatus(user1._id, user1._id);
    console.log('Can user1 see own status:', canSeeSelf);
    console.log('Expected: true, Actual:', canSeeSelf, canSeeSelf ? '✅' : '❌');

    console.log('\n🎉 Privacy enforcement tests completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the test
testPrivacyEnforcement();
