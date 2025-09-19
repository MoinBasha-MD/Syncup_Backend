const Post = require('../models/postModel');
const User = require('../models/userModel');

// Create a new post
const createPost = async (req, res) => {
  try {
    const { content } = req.body;
    const userId = req.user.userId;

    // Validate content
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Post content is required'
      });
    }

    if (content.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Post content must be 50 characters or less'
      });
    }

    // Check if user already has an active post
    const existingPost = await Post.findUserActivePost(userId);
    if (existingPost) {
      // Deactivate existing post
      await existingPost.deactivate();
    }

    // Create new post with 24-hour expiration
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const newPost = new Post({
      userId,
      content: content.trim(),
      expiresAt
    });

    await newPost.save();

    // Get user info for broadcasting
    const user = await User.findOne({ userId }).select('name profileImage');

    // Broadcast to WebSocket using the socketManager's broadcastToUser method
    const { broadcastToUser } = require('../socketManager');
    
    try {
      // Get user's contacts to broadcast to
      const currentUser = await User.findOne({ userId }).select('contacts');
      const contactObjectIds = currentUser?.contacts || [];
      
      // Use MongoDB ObjectIds for broadcasting (matches userSockets map keys)
      const contactUserIds = contactObjectIds.map(id => id.toString());
      
      console.log('🔍 Broadcasting to contact ObjectIds:', contactUserIds);

      // Broadcast new post to contacts using socketManager's broadcastToUser
      const postData = {
        postId: newPost._id,
        userId: userId,
        userName: user.name,
        userProfileImage: user.profileImage,
        content: newPost.content,
        createdAt: newPost.createdAt,
        expiresAt: newPost.expiresAt
      };

      console.log(`📝 Broadcasting new post from ${user.name} to ${contactUserIds.length} contacts`);
      
      // Use socketManager's broadcastToUser method for consistent broadcasting
      let successfulBroadcasts = 0;
      contactUserIds.forEach(contactUserId => {
        const success = broadcastToUser(contactUserId, 'post:new', postData);
        if (success) successfulBroadcasts++;
      });
      
      console.log(`✅ Post broadcast completed: ${successfulBroadcasts}/${contactUserIds.length} successful`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting post:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: {
        postId: newPost._id,
        content: newPost.content,
        createdAt: newPost.createdAt,
        expiresAt: newPost.expiresAt
      },
      message: 'Post created successfully'
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  }
};

// Get user's current active post
const getUserPost = async (req, res) => {
  try {
    const userId = req.user.userId;

    const post = await Post.findUserActivePost(userId);

    if (!post) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No active post found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        postId: post._id,
        content: post.content,
        createdAt: post.createdAt,
        expiresAt: post.expiresAt
      }
    });

  } catch (error) {
    console.error('Get user post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user post'
    });
  }
};

// Get active posts from user's contacts
const getContactsPosts = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's contacts
    const currentUser = await User.findOne({ userId }).select('contacts');
    const contactObjectIds = currentUser?.contacts || [];
    
    // Convert ObjectIds to userIds for post filtering
    const contactUsers = await User.find({ _id: { $in: contactObjectIds } }).select('userId');
    const contactUserIds = contactUsers.map(user => user.userId);

    if (contactUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No contacts found'
      });
    }

    // Get active posts from contacts
    const posts = await Post.findActivePostsForContacts(contactUserIds);

    // Get user details for each post
    const postsWithUserInfo = await Promise.all(
      posts.map(async (post) => {
        const user = await User.findOne({ userId: post.userId }).select('name profileImage');
        return {
          postId: post._id,
          userId: post.userId,
          userName: user?.name || 'Unknown User',
          userProfileImage: user?.profileImage || null,
          content: post.content,
          createdAt: post.createdAt,
          expiresAt: post.expiresAt
        };
      })
    );

    res.status(200).json({
      success: true,
      data: postsWithUserInfo
    });

  } catch (error) {
    console.error('Get contacts posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get contacts posts'
    });
  }
};

// Delete user's post
const deletePost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    // Find the post and verify ownership
    const post = await Post.findOne({
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

    // Deactivate the post
    await post.deactivate();

    // Broadcast deletion to WebSocket
    const io = req.app.get('io');
    if (io) {
      // Get user's contacts to broadcast to
      const currentUser = await User.findOne({ userId }).select('contacts');
      const contactObjectIds = currentUser?.contacts || [];
      
      // Convert ObjectIds to userIds for broadcasting
      const contactUsers = await User.find({ _id: { $in: contactObjectIds } }).select('userId');
      const contactUserIds = contactUsers.map(user => user.userId);

      // Broadcast post deletion to contacts
      contactUserIds.forEach(contactUserId => {
        io.to(`user_${contactUserId}`).emit('post:deleted', {
          postId: post._id,
          userId: userId
        });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
};

// Cleanup expired posts (for scheduled job)
const cleanupExpiredPosts = async (req, res) => {
  try {
    const result = await Post.cleanupExpiredPosts();
    
    res.status(200).json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount
      },
      message: `Cleaned up ${result.modifiedCount} expired posts`
    });

  } catch (error) {
    console.error('Cleanup expired posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired posts'
    });
  }
};

module.exports = {
  createPost,
  getUserPost,
  getContactsPosts,
  deletePost,
  cleanupExpiredPosts
};
