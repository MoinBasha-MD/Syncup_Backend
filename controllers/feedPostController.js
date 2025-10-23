const FeedPost = require('../models/FeedPost');
const User = require('../models/userModel');

// Create a new feed post
const createFeedPost = async (req, res) => {
  try {
    const { caption, type, mediaUrls, location, privacy } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!type || !mediaUrls || mediaUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Post type and media are required'
      });
    }

    // Get user info
    const user = await User.findOne({ userId }).select('name profileImage');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create media items
    const media = mediaUrls.map((url, index) => ({
      type: type === 'carousel' ? (url.includes('.mp4') ? 'video' : 'photo') : type,
      url: url,
      width: 1080,
      height: 1080,
      order: index
    }));

    // Create new feed post
    const newPost = new FeedPost({
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      type,
      caption: caption || '',
      media,
      location: location ? { name: location } : undefined,
      privacy: privacy || 'public'
    });

    await newPost.save();

    console.log(`✅ Feed post created by ${user.name}:`, newPost._id);

    // Broadcast to WebSocket (optional - for real-time updates)
    try {
      const { broadcastToUser } = require('../socketManager');
      const currentUser = await User.findOne({ userId }).select('contacts');
      const contactObjectIds = currentUser?.contacts || [];
      const contactUserIds = contactObjectIds.map(id => id.toString());

      const postData = {
        _id: newPost._id,
        userId: newPost.userId,
        userName: newPost.userName,
        userProfileImage: newPost.userProfileImage,
        type: newPost.type,
        caption: newPost.caption,
        media: newPost.media,
        location: newPost.location,
        privacy: newPost.privacy,
        likesCount: newPost.likesCount,
        commentsCount: newPost.commentsCount,
        createdAt: newPost.createdAt
      };

      let successfulBroadcasts = 0;
      contactUserIds.forEach(contactUserId => {
        const success = broadcastToUser(contactUserId, 'feed:new_post', postData);
        if (success) successfulBroadcasts++;
      });

      console.log(`📡 Post broadcast: ${successfulBroadcasts}/${contactUserIds.length} successful`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting post:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: newPost,
      message: 'Post created successfully'
    });

  } catch (error) {
    console.error('❌ Create feed post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: error.message
    });
  }
};

// Get feed posts (Instagram-style with contacts + app connections)
const getFeedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Get user's contacts AND app connections for Instagram-style feed filtering
    const currentUser = await User.findOne({ userId }).select('contacts appConnections');
    const contactObjectIds = currentUser?.contacts || [];
    const appConnections = currentUser?.appConnections || [];
    
    // Convert contact ObjectIds to userIds
    const contactUsers = await User.find({ 
      _id: { $in: contactObjectIds } 
    }).select('userId');
    
    const contactUserIds = contactUsers.map(user => user.userId);
    
    // Extract userIds from app connections
    const appConnectionUserIds = appConnections.map(conn => conn.userId).filter(Boolean);
    
    // Combine both contact types (device contacts + app connections)
    const allConnectionUserIds = [...new Set([...contactUserIds, ...appConnectionUserIds])];
    
    console.log(`📱 Getting feed for user ${userId}:`);
    console.log(`  📞 Device contacts: ${contactUserIds.length}`);
    console.log(`  🌐 App connections: ${appConnectionUserIds.length}`);
    console.log(`  ✅ Total connections: ${allConnectionUserIds.length}`);

    // Pass all connection IDs to getFeedPosts for Instagram-style filtering
    const posts = await FeedPost.getFeedPosts(userId, page, limit, allConnectionUserIds);

    console.log(`✅ Returning ${posts.length} posts (own + contacts + app connections + public)`);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get feed posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get feed posts',
      error: error.message
    });
  }
};

// Get single post
const getPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await FeedPost.findById(postId);

    if (!post || !post.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment view count
    await post.incrementViews();

    res.status(200).json({
      success: true,
      data: post
    });

  } catch (error) {
    console.error('❌ Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get post',
      error: error.message
    });
  }
};

// Delete post
const deletePost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    const post = await FeedPost.findOne({
      _id: postId,
      userId: userId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or already deleted'
      });
    }

    post.isActive = false;
    await post.save();

    console.log(`🗑️ Post deleted: ${postId} by ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post',
      error: error.message
    });
  }
};

// Toggle like on post
const toggleLike = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    const post = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.toggleLike(userId);

    const isLiked = post.likes.includes(userId);

    console.log(`${isLiked ? '❤️' : '💔'} Post ${postId} ${isLiked ? 'liked' : 'unliked'} by ${userId}`);

    // BROADCAST LIKE UPDATE TO ALL USERS IN REAL-TIME
    try {
      const { broadcastToAll } = require('../socketManager');
      
      // Get user info for the person who liked
      const user = await User.findOne({ userId }).select('name profileImage');
      
      // Broadcast to ALL connected users (not just connections)
      broadcastToAll('post:like_update', {
        postId: post._id,
        userId: userId,
        userName: user?.name || 'Unknown',
        userProfileImage: user?.profileImage,
        isLiked: isLiked,
        likesCount: post.likesCount,
        likes: post.likes // Send full likes array for accurate sync
      });
      
      console.log(`📡 Like update broadcasted to all users for post ${postId}`);
      
      // Also notify post owner if someone else liked their post
      if (isLiked && post.userId !== userId) {
        const { broadcastToUser } = require('../socketManager');
        broadcastToUser(post.userId, 'post:new_like', {
          postId: post._id,
          userId: userId,
          userName: user?.name || 'Unknown',
          userProfileImage: user?.profileImage
        });
      }
    } catch (broadcastError) {
      console.error('❌ Error broadcasting like update:', broadcastError);
    }

    res.status(200).json({
      success: true,
      data: {
        isLiked,
        likesCount: post.likesCount,
        likes: post.likes
      }
    });

  } catch (error) {
    console.error('❌ Toggle like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// Update/Edit post
const updatePost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { caption, location, privacy } = req.body;

    const post = await FeedPost.findOne({
      _id: postId,
      userId: userId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or you do not have permission to edit'
      });
    }

    // Update allowed fields
    if (caption !== undefined) post.caption = caption;
    if (location !== undefined) post.location = location ? { name: location } : undefined;
    if (privacy !== undefined) post.privacy = privacy;

    // Re-extract hashtags and mentions from updated caption
    if (caption !== undefined) {
      post.hashtags = post.extractHashtags();
      post.mentions = post.extractMentions();
    }

    await post.save();

    console.log(`✏️ Post updated: ${postId} by ${userId}`);

    res.status(200).json({
      success: true,
      data: post,
      message: 'Post updated successfully'
    });

  } catch (error) {
    console.error('❌ Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post',
      error: error.message
    });
  }
};

// Repost (share) a post
const repostPost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { caption } = req.body; // Optional caption for repost

    // Find original post
    const originalPost = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!originalPost) {
      return res.status(404).json({
        success: false,
        message: 'Original post not found'
      });
    }

    // Check if user already reposted this
    const existingRepost = await FeedPost.findOne({
      userId: userId,
      originalPostId: postId,
      isActive: true
    });

    if (existingRepost) {
      return res.status(400).json({
        success: false,
        message: 'You have already reposted this'
      });
    }

    // Get user info
    const User = require('../models/userModel');
    const user = await User.findOne({ userId }).select('name profileImage');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create repost
    const repost = new FeedPost({
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      type: originalPost.type,
      caption: caption || `Reposted from @${originalPost.userName}`,
      media: originalPost.media,
      location: originalPost.location,
      privacy: 'public', // Reposts are always public
      originalPostId: originalPost._id,
      originalUserId: originalPost.userId,
      isRepost: true
    });

    await repost.save();

    // Increment shares count on original post
    originalPost.sharesCount += 1;
    await originalPost.save();

    console.log(`🔄 Post reposted: ${postId} by ${userId}`);

    // Broadcast to WebSocket (optional - for real-time updates)
    try {
      const { broadcastToUser } = require('../socketManager');
      const currentUser = await User.findOne({ userId }).select('contacts appConnections');
      
      // Get all connection userIds
      const contactObjectIds = currentUser?.contacts || [];
      const appConnections = currentUser?.appConnections || [];
      
      const contactUsers = await User.find({ 
        _id: { $in: contactObjectIds } 
      }).select('userId');
      
      const contactUserIds = contactUsers.map(u => u.userId);
      const appConnectionUserIds = appConnections.map(conn => conn.userId).filter(Boolean);
      const allConnectionUserIds = [...new Set([...contactUserIds, ...appConnectionUserIds])];

      const repostData = {
        _id: repost._id,
        userId: repost.userId,
        userName: repost.userName,
        userProfileImage: repost.userProfileImage,
        type: repost.type,
        caption: repost.caption,
        media: repost.media,
        location: repost.location,
        privacy: repost.privacy,
        isRepost: true,
        originalPostId: originalPost._id,
        likesCount: repost.likesCount,
        commentsCount: repost.commentsCount,
        createdAt: repost.createdAt
      };

      let successfulBroadcasts = 0;
      allConnectionUserIds.forEach(connectionUserId => {
        const success = broadcastToUser(connectionUserId, 'feed:new_post', repostData);
        if (success) successfulBroadcasts++;
      });

      console.log(`📡 Repost broadcast: ${successfulBroadcasts}/${allConnectionUserIds.length} successful`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting repost:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: repost,
      message: 'Post reposted successfully'
    });

  } catch (error) {
    console.error('❌ Repost error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to repost',
      error: error.message
    });
  }
};

// Get user's posts
const getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const posts = await FeedPost.getUserPosts(userId, page, limit);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get user posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user posts',
      error: error.message
    });
  }
};

// Toggle bookmark on post
const toggleBookmark = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    // Check if post exists
    const post = await FeedPost.findOne({ _id: postId, isActive: true });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Toggle bookmark
    const postObjectId = post._id;
    const bookmarkIndex = user.savedPosts.findIndex(
      savedPost => savedPost.toString() === postObjectId.toString()
    );

    let isBookmarked;
    if (bookmarkIndex > -1) {
      // Remove bookmark
      user.savedPosts.splice(bookmarkIndex, 1);
      isBookmarked = false;
      console.log(`🔖 Post ${postId} unbookmarked by ${userId}`);
    } else {
      // Add bookmark
      user.savedPosts.push(postObjectId);
      isBookmarked = true;
      console.log(`🔖 Post ${postId} bookmarked by ${userId}`);
    }

    await user.save();

    res.status(200).json({
      success: true,
      data: {
        isBookmarked,
        savedPostsCount: user.savedPosts.length
      }
    });

  } catch (error) {
    console.error('❌ Toggle bookmark error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle bookmark',
      error: error.message
    });
  }
};

// Get user's saved/bookmarked posts
const getSavedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get user with saved posts
    const user = await User.findOne({ userId })
      .select('savedPosts')
      .populate({
        path: 'savedPosts',
        match: { isActive: true },
        options: {
          sort: { createdAt: -1 },
          skip: skip,
          limit: limit
        }
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const savedPosts = user.savedPosts || [];

    console.log(`📚 Retrieved ${savedPosts.length} saved posts for ${userId}`);

    res.status(200).json({
      success: true,
      data: savedPosts,
      pagination: {
        page,
        limit,
        total: savedPosts.length
      }
    });

  } catch (error) {
    console.error('❌ Get saved posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved posts',
      error: error.message
    });
  }
};

module.exports = {
  createFeedPost,
  getFeedPosts,
  getPost,
  deletePost,
  updatePost,
  repostPost,
  toggleLike,
  toggleBookmark,
  getSavedPosts,
  getUserPosts
};
