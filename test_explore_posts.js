/**
 * Test script to check Explore posts in database
 * Run: node test_explore_posts.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FeedPost = require('./models/FeedPost');
const User = require('./models/User');
const Friend = require('./models/Friend');

async function testExplorePosts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all users
    const users = await User.find({}).select('_id name username').limit(5);
    console.log(`\n📊 Found ${users.length} users in database`);
    users.forEach(user => {
      console.log(`  - ${user.name} (@${user.username}) - ID: ${user._id}`);
    });

    // Get all public posts
    const publicPosts = await FeedPost.find({ 
      isActive: true, 
      privacy: 'public' 
    }).select('userId caption privacy createdAt').sort({ createdAt: -1 });
    
    console.log(`\n📝 Found ${publicPosts.length} PUBLIC posts in database:`);
    publicPosts.forEach((post, index) => {
      console.log(`  ${index + 1}. User: ${post.userId} | Privacy: ${post.privacy} | Caption: ${post.caption?.substring(0, 40) || 'No caption'}`);
    });

    // Test for a specific user
    if (users.length > 0) {
      const testUser = users[0];
      console.log(`\n🧪 Testing Explore feed for user: ${testUser.name} (${testUser._id})`);

      // Get user's friends
      const friends = await Friend.getFriends(testUser._id.toString(), {
        status: 'accepted',
        includeDeviceContacts: true,
        includeAppConnections: true
      });
      
      const friendUserIds = friends
        .filter(friend => friend && friend.friendUserId)
        .map(friend => friend.friendUserId);

      console.log(`  👥 User has ${friendUserIds.length} friends`);
      console.log(`  Friends: ${friendUserIds.join(', ')}`);

      // Get explore posts
      const explorePosts = await FeedPost.getExplorePosts(testUser._id.toString(), 1, 20, friendUserIds, []);
      
      console.log(`\n✅ Explore feed returned ${explorePosts.length} posts`);
      explorePosts.forEach((post, index) => {
        console.log(`  ${index + 1}. User: ${post.userId} | Caption: ${post.caption?.substring(0, 40) || 'No caption'}`);
      });

      // Check what's being excluded
      const ownPosts = await FeedPost.countDocuments({ 
        userId: testUser._id, 
        isActive: true, 
        privacy: 'public' 
      });
      
      const friendPosts = await FeedPost.countDocuments({ 
        userId: { $in: friendUserIds }, 
        isActive: true, 
        privacy: 'public' 
      });

      console.log(`\n📊 Post breakdown:`);
      console.log(`  - Total public posts: ${publicPosts.length}`);
      console.log(`  - User's own posts: ${ownPosts}`);
      console.log(`  - Friends' posts: ${friendPosts}`);
      console.log(`  - Should show in Explore: ${publicPosts.length - ownPosts - friendPosts}`);
      console.log(`  - Actually showing: ${explorePosts.length}`);
    }

    console.log('\n✅ Test complete!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testExplorePosts();
