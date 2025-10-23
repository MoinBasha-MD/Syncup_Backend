const Comment = require('../models/Comment');
const FeedPost = require('../models/FeedPost');
const User = require('../models/userModel');

// Create a comment on a post
const createComment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    // Check if post exists
    const post = await FeedPost.findOne({ _id: postId, isActive: true });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
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

    // Create comment
    const comment = new Comment({
      postId,
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      text: text.trim()
    });

    await comment.save();

    // Update post comment count
    post.commentsCount += 1;
    await post.save();

    console.log(`💬 Comment created on post ${postId} by ${user.name}`);

    // Broadcast to WebSocket for real-time updates
    try {
      const { broadcastToUser } = require('../socketManager');
      
      // Notify post owner if it's not their own comment
      if (post.userId !== userId) {
        broadcastToUser(post.userId, 'post:new_comment', {
          postId,
          comment: {
            _id: comment._id,
            userId: comment.userId,
            userName: comment.userName,
            userProfileImage: comment.userProfileImage,
            text: comment.text,
            likesCount: comment.likesCount,
            repliesCount: comment.repliesCount,
            createdAt: comment.createdAt
          }
        });
      }
    } catch (broadcastError) {
      console.error('❌ Error broadcasting comment:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: comment,
      message: 'Comment created successfully'
    });

  } catch (error) {
    console.error('❌ Create comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create comment',
      error: error.message
    });
  }
};

// Get comments for a post
const getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const comments = await Comment.getPostComments(postId, page, limit);

    res.status(200).json({
      success: true,
      data: comments,
      pagination: {
        page,
        limit,
        total: comments.length
      }
    });

  } catch (error) {
    console.error('❌ Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get comments',
      error: error.message
    });
  }
};

// Update/Edit comment
const updateComment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId } = req.params;
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      userId: userId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found or you do not have permission to edit'
      });
    }

    comment.text = text.trim();
    comment.isEdited = true;
    await comment.save();

    console.log(`✏️ Comment updated: ${commentId}`);

    res.status(200).json({
      success: true,
      data: comment,
      message: 'Comment updated successfully'
    });

  } catch (error) {
    console.error('❌ Update comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update comment',
      error: error.message
    });
  }
};

// Delete comment
const deleteComment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId } = req.params;

    const comment = await Comment.findOne({
      _id: commentId,
      userId: userId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found or you do not have permission to delete'
      });
    }

    comment.isActive = false;
    await comment.save();

    // Update post comment count
    const post = await FeedPost.findById(comment.postId);
    if (post) {
      post.commentsCount = Math.max(0, post.commentsCount - 1);
      await post.save();
    }

    console.log(`🗑️ Comment deleted: ${commentId}`);

    res.status(200).json({
      success: true,
      message: 'Comment deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete comment',
      error: error.message
    });
  }
};

// Toggle like on comment
const toggleCommentLike = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId } = req.params;

    const comment = await Comment.findOne({
      _id: commentId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    await comment.toggleLike(userId);

    const isLiked = comment.likes.includes(userId);

    console.log(`${isLiked ? '❤️' : '💔'} Comment ${commentId} ${isLiked ? 'liked' : 'unliked'}`);

    res.status(200).json({
      success: true,
      data: {
        isLiked,
        likesCount: comment.likesCount
      }
    });

  } catch (error) {
    console.error('❌ Toggle comment like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// Add reply to comment
const addReply = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId } = req.params;
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reply text is required'
      });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
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

    const replyData = {
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      text: text.trim()
    };

    await comment.addReply(replyData);

    console.log(`💬 Reply added to comment ${commentId}`);

    // Broadcast to WebSocket
    try {
      const { broadcastToUser } = require('../socketManager');
      
      // Notify comment owner if it's not their own reply
      if (comment.userId !== userId) {
        broadcastToUser(comment.userId, 'comment:new_reply', {
          commentId,
          reply: replyData
        });
      }
    } catch (broadcastError) {
      console.error('❌ Error broadcasting reply:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: comment,
      message: 'Reply added successfully'
    });

  } catch (error) {
    console.error('❌ Add reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reply',
      error: error.message
    });
  }
};

// Toggle like on reply
const toggleReplyLike = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId, replyId } = req.params;

    const comment = await Comment.findOne({
      _id: commentId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    await comment.toggleReplyLike(replyId, userId);

    const reply = comment.replies.id(replyId);
    const isLiked = reply.likes.includes(userId);

    console.log(`${isLiked ? '❤️' : '💔'} Reply ${replyId} ${isLiked ? 'liked' : 'unliked'}`);

    res.status(200).json({
      success: true,
      data: {
        isLiked,
        likesCount: reply.likesCount
      }
    });

  } catch (error) {
    console.error('❌ Toggle reply like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle reply like',
      error: error.message
    });
  }
};

// Delete reply
const deleteReply = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { commentId, replyId } = req.params;

    const comment = await Comment.findOne({
      _id: commentId,
      isActive: true
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(replyId);
    
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if user owns the reply
    if (reply.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this reply'
      });
    }

    await comment.deleteReply(replyId);

    console.log(`🗑️ Reply deleted: ${replyId}`);

    res.status(200).json({
      success: true,
      message: 'Reply deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reply',
      error: error.message
    });
  }
};

module.exports = {
  createComment,
  getComments,
  updateComment,
  deleteComment,
  toggleCommentLike,
  addReply,
  toggleReplyLike,
  deleteReply
};
