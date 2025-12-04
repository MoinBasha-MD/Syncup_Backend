/**
 * Profile Controller
 * Handles public profile, friend profile, and follow/unfollow operations
 */

const User = require('../models/userModel');
const Friend = require('../models/Friend');
const FeedPost = require('../models/FeedPost');

/**
 * Get public profile with posts
 * GET /api/users/public-profile/:userId
 */
exports.getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { includePosts } = req.query;
    const currentUserId = req.user.userId;

    console.log('🔍 [PROFILE] Getting public profile for:', userId);

    // Find the user
    const user = await User.findOne({ userId }).select(
      'userId name username profileImage bio isOnline lastSeen'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if current user is following this user
    const isFollowing = await FeedPost.exists({
      userId: currentUserId,
      following: userId
    });

    // Check if they are friends
    const friendship = await Friend.findOne({
      $or: [
        { userId: currentUserId, friendUserId: userId, status: 'accepted' },
        { userId: userId, friendUserId: currentUserId, status: 'accepted' }
      ]
    });
    const isFriend = !!friendship;

    // Check if can send friend request
    const existingRequest = await Friend.findOne({
      $or: [
        { userId: currentUserId, friendUserId: userId },
        { userId: userId, friendUserId: currentUserId }
      ]
    });
    const canSendRequest = !existingRequest;

    // Get posts count - all posts for friends, public only for strangers
    const postsCountQuery = isFriend 
      ? { userId: userId }  // All posts for friends
      : { userId: userId, isPublic: true };  // Only public posts for strangers
    
    const postsCount = await FeedPost.countDocuments(postsCountQuery);

    // Get followers/following counts
    const followersCount = await User.countDocuments({
      following: userId
    });

    const followingCount = user.following ? user.following.length : 0;

    // Get mutual friends count
    const currentUserFriends = await Friend.find({
      $or: [
        { userId: currentUserId, status: 'accepted' },
        { friendUserId: currentUserId, status: 'accepted' }
      ]
    }).select('userId friendUserId');

    const currentUserFriendIds = currentUserFriends.map(f => 
      f.userId === currentUserId ? f.friendUserId : f.userId
    );

    const targetUserFriends = await Friend.find({
      $or: [
        { userId: userId, status: 'accepted' },
        { friendUserId: userId, status: 'accepted' }
      ]
    }).select('userId friendUserId');

    const targetUserFriendIds = targetUserFriends.map(f => 
      f.userId === userId ? f.friendUserId : f.userId
    );

    const mutualCount = currentUserFriendIds.filter(id => 
      targetUserFriendIds.includes(id)
    ).length;

    // Build response
    const profileData = {
      userId: user.userId,
      name: user.name,
      username: user.username,
      profileImage: user.profileImage,
      bio: user.bio,
      postsCount,
      followersCount,
      followingCount,
      mutualCount,
      isFollowing: !!isFollowing,
      isFriend,
      canSendRequest,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    };

    // Include posts if requested
    if (includePosts === 'true') {
      // If friends, show ALL posts. If not friends, show only public posts
      const postQuery = isFriend 
        ? { userId: userId }  // All posts for friends
        : { userId: userId, isPublic: true };  // Only public posts for strangers
      
      const posts = await FeedPost.find(postQuery)
        .sort({ createdAt: -1 })
        .limit(50)
        .select('_id imageUrl videoUrl caption likesCount commentsCount createdAt');

      // Use 'posts' key for friends, 'publicPosts' for strangers
      if (isFriend) {
        profileData.posts = posts;
      } else {
        profileData.publicPosts = posts;
      }
    }

    console.log('✅ [PROFILE] Public profile retrieved successfully');

    res.status(200).json({
      success: true,
      data: profileData
    });

  } catch (error) {
    console.error('❌ [PROFILE] Error getting public profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
};

/**
 * Get friend profile with all posts
 * GET /api/friends/:userId/profile
 */
exports.getFriendProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { includePosts } = req.query;
    const currentUserId = req.user.userId;

    console.log('🔍 [PROFILE] Getting friend profile for:', userId);

    // Verify friendship
    const friendship = await Friend.findOne({
      $or: [
        { userId: currentUserId, friendUserId: userId, status: 'accepted' },
        { userId: userId, friendUserId: currentUserId, status: 'accepted' }
      ]
    });

    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'Not friends with this user'
      });
    }

    // Find the user
    const user = await User.findOne({ userId }).select(
      'userId name username profileImage bio isOnline lastSeen'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get all posts count (friends can see all posts)
    const postsCount = await FeedPost.countDocuments({
      userId: userId
    });

    // Get friends count
    const friendsCount = await Friend.countDocuments({
      $or: [
        { userId: userId, status: 'accepted' },
        { friendUserId: userId, status: 'accepted' }
      ]
    });

    // Get followers count
    const followersCount = await User.countDocuments({
      following: userId
    });

    // Get mutual friends count
    const currentUserFriends = await Friend.find({
      $or: [
        { userId: currentUserId, status: 'accepted' },
        { friendUserId: currentUserId, status: 'accepted' }
      ]
    }).select('userId friendUserId');

    const currentUserFriendIds = currentUserFriends.map(f => 
      f.userId === currentUserId ? f.friendUserId : f.userId
    );

    const targetUserFriends = await Friend.find({
      $or: [
        { userId: userId, status: 'accepted' },
        { friendUserId: userId, status: 'accepted' }
      ]
    }).select('userId friendUserId');

    const targetUserFriendIds = targetUserFriends.map(f => 
      f.userId === userId ? f.friendUserId : f.userId
    );

    const mutualCount = currentUserFriendIds.filter(id => 
      targetUserFriendIds.includes(id)
    ).length;

    // Build response
    const profileData = {
      userId: user.userId,
      name: user.name,
      username: user.username,
      profileImage: user.profileImage,
      bio: user.bio,
      postsCount,
      friendsCount,
      followersCount,
      mutualCount,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      isFriend: true,
      isFollowing: true, // Friends auto-follow each other
      connectionDate: friendship.addedAt
    };

    // Include all posts if requested (friends can see all posts)
    if (includePosts === 'true') {
      const posts = await FeedPost.find({
        userId: userId
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('_id imageUrl videoUrl caption likesCount commentsCount createdAt');

      profileData.posts = posts;
    }

    console.log('✅ [PROFILE] Friend profile retrieved successfully');

    res.status(200).json({
      success: true,
      data: profileData
    });

  } catch (error) {
    console.error('❌ [PROFILE] Error getting friend profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get friend profile',
      error: error.message
    });
  }
};

/**
 * Follow a user
 * POST /api/users/:userId/follow
 */
exports.followUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    console.log('👤 [PROFILE] Following user:', userId);

    if (userId === currentUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot follow yourself'
      });
    }

    // Check if user exists
    const userToFollow = await User.findOne({ userId });
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already following
    const currentUser = await User.findOne({ userId: currentUserId });
    if (currentUser.following && currentUser.following.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Already following this user'
      });
    }

    // Add to following list
    await User.findOneAndUpdate(
      { userId: currentUserId },
      { $addToSet: { following: userId } }
    );

    // Increment follower count for target user
    await User.findOneAndUpdate(
      { userId: userId },
      { $inc: { followersCount: 1 } }
    );

    console.log('✅ [PROFILE] User followed successfully');

    res.status(200).json({
      success: true,
      message: 'User followed successfully'
    });

  } catch (error) {
    console.error('❌ [PROFILE] Error following user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to follow user',
      error: error.message
    });
  }
};

/**
 * Unfollow a user
 * POST /api/users/:userId/unfollow
 */
exports.unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    console.log('👤 [PROFILE] Unfollowing user:', userId);

    if (userId === currentUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot unfollow yourself'
      });
    }

    // Remove from following list
    await User.findOneAndUpdate(
      { userId: currentUserId },
      { $pull: { following: userId } }
    );

    // Decrement follower count for target user
    await User.findOneAndUpdate(
      { userId: userId },
      { $inc: { followersCount: -1 } }
    );

    console.log('✅ [PROFILE] User unfollowed successfully');

    res.status(200).json({
      success: true,
      message: 'User unfollowed successfully'
    });

  } catch (error) {
    console.error('❌ [PROFILE] Error unfollowing user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unfollow user',
      error: error.message
    });
  }
};
