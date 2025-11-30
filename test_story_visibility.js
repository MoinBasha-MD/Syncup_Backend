/**
 * Test script to check Story visibility between friends
 * Run: node test_story_visibility.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Suppress mongoose deprecation warnings
mongoose.set('strictQuery', false);

async function testStoryVisibility() {
  try {
    // Connect to MongoDB with options to suppress warnings
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Import models after connection to avoid index warnings
    const Story = require('./models/storyModel');
    const User = require('./models/userModel');
    const Friend = require('./models/Friend');

    // Get all users
    const users = await User.find({}).select('userId name username').limit(5);
    console.log(`📊 Found ${users.length} users in database:`);
    users.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.name} (@${user.username}) - userId: ${user.userId}`);
    });

    if (users.length < 2) {
      console.log('\n❌ Need at least 2 users to test story visibility');
      process.exit(1);
    }

    const user1 = users[0];
    const user2 = users[1];

    console.log(`\n🧪 Testing story visibility between:`);
    console.log(`  User 1: ${user1.name} (${user1.userId})`);
    console.log(`  User 2: ${user2.name} (${user2.userId})`);

    // Check if they are friends
    console.log(`\n👥 Checking friendship status...`);
    const friends1 = await Friend.getFriends(user1.userId, {
      status: 'accepted',
      includeDeviceContacts: true,
      includeAppConnections: true
    });
    
    const friends2 = await Friend.getFriends(user2.userId, {
      status: 'accepted',
      includeDeviceContacts: true,
      includeAppConnections: true
    });

    const user1FriendIds = friends1.map(f => f.friendUserId);
    const user2FriendIds = friends2.map(f => f.friendUserId);

    console.log(`  User 1 has ${user1FriendIds.length} friends:`, user1FriendIds);
    console.log(`  User 2 has ${user2FriendIds.length} friends:`, user2FriendIds);

    const areFriends = user1FriendIds.includes(user2.userId) && user2FriendIds.includes(user1.userId);
    console.log(`  Are they friends? ${areFriends ? '✅ YES' : '❌ NO'}`);

    if (!areFriends) {
      console.log('\n⚠️ Users are not friends! Stories won\'t be visible to each other.');
      console.log('   To fix: Make them friends first using the Friend API');
    }

    // Get all active stories
    console.log(`\n📖 Checking active stories...`);
    const allStories = await Story.find({
      expiresAt: { $gt: new Date() }
    }).select('userId createdAt expiresAt items').sort({ createdAt: -1 });

    console.log(`  Total active stories: ${allStories.length}`);
    allStories.forEach((story, index) => {
      const owner = users.find(u => u.userId === story.userId);
      console.log(`    ${index + 1}. Story by ${owner?.name || story.userId} - ${story.items.length} items - Created: ${story.createdAt.toLocaleString()}`);
    });

    // Check User 1's stories
    const user1Stories = allStories.filter(s => s.userId === user1.userId);
    console.log(`\n📱 User 1 (${user1.name}) has ${user1Stories.length} active stories`);

    // Check User 2's stories
    const user2Stories = allStories.filter(s => s.userId === user2.userId);
    console.log(`📱 User 2 (${user2.name}) has ${user2Stories.length} active stories`);

    // Simulate what User 2 should see
    console.log(`\n🔍 Simulating what User 2 should see:`);
    console.log(`  User 2's friends: ${user2FriendIds.length}`);
    console.log(`  User 2's friends list:`, user2FriendIds);

    const allUserIds = [user2.userId, ...user2FriendIds];
    console.log(`  Querying stories for users:`, allUserIds);

    const visibleStories = await Story.find({
      userId: { $in: allUserIds },
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    console.log(`  ✅ User 2 should see ${visibleStories.length} stories:`);
    visibleStories.forEach((story, index) => {
      const owner = users.find(u => u.userId === story.userId);
      const isOwn = story.userId === user2.userId;
      console.log(`    ${index + 1}. ${isOwn ? '(Own)' : '(Friend)'} Story by ${owner?.name || story.userId}`);
    });

    // Check if User 1's story is visible to User 2
    if (user1Stories.length > 0 && areFriends) {
      const user1StoryVisibleToUser2 = visibleStories.some(s => s.userId === user1.userId);
      console.log(`\n✅ User 1's story visible to User 2? ${user1StoryVisibleToUser2 ? '✅ YES' : '❌ NO'}`);
      
      if (!user1StoryVisibleToUser2) {
        console.log('❌ PROBLEM: User 1 has stories but User 2 cannot see them!');
        console.log('   This indicates a bug in the story visibility logic.');
      }
    } else if (user1Stories.length > 0 && !areFriends) {
      console.log(`\n⚠️ User 1 has stories but they are not friends, so User 2 cannot see them (expected behavior)`);
    } else {
      console.log(`\n⚠️ User 1 has no active stories to test visibility`);
    }

    // Summary
    console.log(`\n📊 Summary:`);
    console.log(`  - Total users: ${users.length}`);
    console.log(`  - Total active stories: ${allStories.length}`);
    console.log(`  - User 1 friends: ${user1FriendIds.length}`);
    console.log(`  - User 2 friends: ${user2FriendIds.length}`);
    console.log(`  - Are friends: ${areFriends ? 'YES' : 'NO'}`);
    console.log(`  - User 1 stories: ${user1Stories.length}`);
    console.log(`  - User 2 stories: ${user2Stories.length}`);
    console.log(`  - Stories visible to User 2: ${visibleStories.length}`);

    console.log('\n✅ Test complete!');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Close connection on error
    try {
      await mongoose.connection.close();
    } catch (closeError) {
      // Ignore close errors
    }
    
    process.exit(1);
  }
}

testStoryVisibility();
