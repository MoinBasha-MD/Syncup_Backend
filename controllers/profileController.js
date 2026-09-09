/**
 * Profile Controller
 * Handles public profile, friend profile, and follow/unfollow operations
 */

const User = require('../models/userModel');
const Friend = require('../models/Friend');
const FeedPost = require('../models/FeedPost');
const LogSanitizer = require('../utils/logSanitizer');

/**
 * Get public profile with posts
 * GET /api/users/public-profile/:userId
 */
exports.getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { includePosts } = req.query;
    
    // Use userId field (UUID string) for Friend model, not _id (MongoDB ObjectId)
    const currentUserId = req.user.userId || req.user._id.toString();

    console.log('🔍 [PROFILE] Getting public profile for userId:', userId);
    console.log('🔍 [PROFILE] Current user ID:', currentUserId);
    console.log('🔍 [PROFILE] Current user details:', {
      _id: req.user._id,
      userId: req.user.userId,
      name: req.user.name
    });

    // Determine if userId is a UUID (36 chars with dashes) or MongoDB ObjectId (24 hex chars)
    const isUUID = typeof userId === 'string' && userId.length === 36 && userId.includes('-');
    const isObjectId = typeof userId === 'string' && userId.length === 24 && /^[0-9a-fA-F]{24}$/.test(userId);
    
    console.log('🔍 [PROFILE] UserId format - isUUID:', isUUID, 'isObjectId:', isObjectId);

    // Find the user based on ID format
    let user;
    if (isUUID) {
      // UUID format - search by userId field
      user = await User.findOne({ userId }).select(
        'userId name username profileImage bio isOnline lastSeen following'
      );
    } else if (isObjectId) {
      // MongoDB ObjectId format - search by _id
      user = await User.findById(userId).select(
        'userId name username profileImage bio isOnline lastSeen following'
      );
    } else {
      // Try both methods as fallback
      user = await User.findOne({ userId }).select(
        'userId name username profileImage bio isOnline lastSeen following'
      );
      if (!user) {
        user = await User.findById(userId).select(
          'userId name username profileImage bio isOnline lastSeen following'
        ).catch(() => null); // Catch casting errors
      }
    }

    if (!user) {
      console.log('❌ [PROFILE] User not found:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('✅ [PROFILE] User found:', user.name);

    // Use the correct userId field for Friend model (UUID string, not MongoDB ObjectId)
    const targetUserId = user.userId || user._id.toString();
    
    console.log('🔍 [PROFILE] Target userId for Friend queries:', targetUserId);
    console.log('🔍 [PROFILE] Checking friendship between:', currentUserId, 'and', targetUserId);

    // Check if current user is following this user
    const isFollowing = user.following && user.following.includes(currentUserId);

    // Load both directional records so we can distinguish a mutual friendship
    // from a one-way device contact.
    const [forwardFriendship, reverseFriendship] = await Promise.all([
      Friend.findOne({
        userId: currentUserId,
        friendUserId: targetUserId,
        isDeleted: { $ne: true }
      }).lean(),
      Friend.findOne({
        userId: targetUserId,
        friendUserId: currentUserId,
        isDeleted: { $ne: true }
      }).lean()
    ]);

    // isFriend is true only for a mutual connection (or an app connection, which
    // is created as reciprocal by the accept flow). One-way device contacts are
    // not considered friends.
    const isFriend = !!forwardFriendship &&
      forwardFriendship.status === 'accepted' &&
      (!forwardFriendship.isDeviceContact ||
        (reverseFriendship && reverseFriendship.status === 'accepted'));

    console.log('🤝 [PROFILE] Are friends?', isFriend);

    // Determine detailed connection status from the current user's POV
    let canSendRequest = true;
    let hasPendingRequest = false;
    let hasReceivedRequest = false;
    let connectionStatus = 'none';
    let requestId = null;

    if (forwardFriendship) {
      requestId = forwardFriendship._id;
      if (forwardFriendship.status === 'accepted') {
        connectionStatus = 'connected';
        canSendRequest = false;
      } else if (forwardFriendship.status === 'pending') {
        hasPendingRequest = true;
        connectionStatus = 'pending';
        canSendRequest = false;
      } else if (forwardFriendship.status === 'blocked') {
        connectionStatus = 'blocked';
        canSendRequest = false;
      }
    } else if (reverseFriendship) {
      requestId = reverseFriendship._id;
      if (reverseFriendship.status === 'pending') {
        hasReceivedRequest = true;
        connectionStatus = 'received';
        canSendRequest = false;
      } else if (reverseFriendship.status === 'accepted') {
        // The other user has us as a contact/friend; we can send a request.
        connectionStatus = 'none';
        canSendRequest = true;
      } else if (reverseFriendship.status === 'blocked') {
        connectionStatus = 'blocked';
        canSendRequest = false;
      }
    }
    
    console.log('📤 [PROFILE] Connection status:', {
      canSendRequest,
      hasPendingRequest,
      hasReceivedRequest,
      connectionStatus,
      requestId
    });

    // Get posts count - all posts for friends, public only for strangers
    const postsCountQuery = isFriend 
      ? { userId: targetUserId }  // All posts for friends
      : { userId: targetUserId, privacy: 'public' };  // Only public posts for strangers
    
    console.log('📊 [PROFILE] Posts query:', postsCountQuery);
    const postsCount = await FeedPost.countDocuments(postsCountQuery);
    console.log('📊 [PROFILE] Posts count:', postsCount);

    // Get followers/following counts
    const followersCount = await User.countDocuments({
      following: targetUserId
    });
    console.log('📊 [PROFILE] Followers count:', followersCount);

    const followingCount = user.following ? user.following.length : 0;
    console.log('📊 [PROFILE] Following count:', followingCount);

    // CRITICAL FIX: Get friends count for the target user
    // Use Friend.getFriends which properly handles bidirectional friendships
    const targetUserFriendsData = await Friend.getFriends(targetUserId);
    const friendsCount = targetUserFriendsData.length;

    // CRITICAL FIX: Get mutual friends count using the fixed getMutualFriends method
    const mutualFriendIds = await Friend.getMutualFriends(currentUserId, targetUserId);
    const mutualCount = mutualFriendIds.length;
    
    console.log(`📊 [PROFILE] Target user ${targetUserId} has ${friendsCount} friends, ${mutualCount} mutual with current user`);

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
      followingCount,
      mutualCount,
      isFollowing: !!isFollowing,
      isFriend,
      canSendRequest,
      hasPendingRequest,
      hasReceivedRequest,
      connectionStatus,
      requestId,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    };

    // Include posts if requested
    if (includePosts === 'true') {
      // If friends, show ALL posts. If not friends, show only public posts
      const postQuery = isFriend 
        ? { userId: targetUserId }  // All posts for friends
        : { userId: targetUserId, privacy: 'public' };  // Only public posts for strangers
      
      console.log('📸 [PROFILE] Fetching posts with query:', postQuery);
      const posts = await FeedPost.find(postQuery)
        .sort({ createdAt: -1 })
        .limit(50)
        .select('_id media type caption likes comments createdAt privacy');
      
      console.log(`📸 [PROFILE] Found ${posts.length} posts`);
      
      // Transform posts to match frontend format
      const transformedPosts = posts.map(post => ({
        _id: post._id,
        imageUrl: post.media && post.media.length > 0 && post.media[0].type === 'photo' ? post.media[0].url : null,
        images: post.media ? post.media.filter(m => m.type === 'photo').map(m => m.url) : [],
        videoUrl: post.media && post.media.length > 0 && post.media[0].type === 'video' ? post.media[0].url : null,
        caption: post.caption,
        likesCount: post.likes ? post.likes.length : 0,
        commentsCount: post.comments ? post.comments.length : 0,
        createdAt: post.createdAt
      }));

      // Use 'posts' key for friends, 'publicPosts' for strangers
      if (isFriend) {
        profileData.posts = transformedPosts;
      } else {
        profileData.publicPosts = transformedPosts;
      }
      
      console.log('✅ [PROFILE] Posts transformed and added to response');
    }

    console.log('✅ [PROFILE] Public profile retrieved successfully');
    console.log('📦 [PROFILE] Response data:', {
      name: profileData.name,
      postsCount: profileData.postsCount,
      friendsCount: profileData.friendsCount,
      followersCount: profileData.followersCount,
      mutualCount: profileData.mutualCount,
      isFriend: profileData.isFriend,
      isFollowing: profileData.isFollowing,
      canSendRequest: profileData.canSendRequest,
      postsIncluded: includePosts === 'true' ? (profileData.posts?.length || profileData.publicPosts?.length || 0) : 'not requested'
    });

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

    // CRITICAL FIX: Get friends count using proper method
    const targetUserFriendsData = await Friend.getFriends(userId);
    const friendsCount = targetUserFriendsData.length;

    // Get followers count
    const followersCount = await User.countDocuments({
      following: userId
    });

    // CRITICAL FIX: Get mutual friends count using the fixed getMutualFriends method
    const mutualFriendIds = await Friend.getMutualFriends(currentUserId, userId);
    const mutualCount = mutualFriendIds.length;
    
    console.log(`📊 [FRIEND PROFILE] Target user ${userId} has ${friendsCount} friends, ${mutualCount} mutual with current user`);

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
