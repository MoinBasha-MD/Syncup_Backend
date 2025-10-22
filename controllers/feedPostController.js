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

// Get feed posts
const getFeedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const posts = await FeedPost.getFeedPosts(userId, page, limit);

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

    res.status(200).json({
      success: true,
      data: {
        isLiked,
        likesCount: post.likesCount
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

module.exports = {
  createFeedPost,
  getFeedPosts,
  getPost,
  deletePost,
  toggleLike,
  getUserPosts
};
