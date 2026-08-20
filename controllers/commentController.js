const Comment = require('../models/Comment');
const FeedPost = require('../models/FeedPost');
const User = require('../models/userModel');
const mongoose = require('mongoose');
const { getInstance: getPostEncryption } = require('../utils/postEncryption');
const enhancedNotificationService = require('../services/enhancedNotificationService');

// ✅ ARCHITECTURE FIX: A page post shown in the Feed is a denormalized `FeedPost` copy
// of the canonical `PagePost` document. Comments made from the Feed live in this
// generic `Comment` collection (keyed by the FeedPost copy's _id), while comments made
// directly on the Page profile live in `PagePost.comments`. Until these are fully
// unified (see AGENTS.md "Pages ↔ Feed architecture"), keep the *counts* in sync so the
// number shown doesn't visibly disagree depending on where the user is looking.
async function syncPagePostCommentCount(post) {
  if (!post || !post.isPagePost || !post.pagePostId) return;
  try {
    const PagePost = require('../models/PagePost');
    await PagePost.findByIdAndUpdate(post.pagePostId, { commentCount: post.commentsCount });
  } catch (syncError) {
    console.error('❌ [COMMENT SYNC] Failed to sync PagePost.commentCount:', syncError);
  }
}

// Create a comment on a post
const createComment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { text, parentId } = req.body;

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

    // Create comment (top-level; replies are still embedded for now)
    const comment = new Comment({
      postId,
      postType: 'FeedPost',
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      text: text.trim(),
      parentId: parentId || null
    });

    await comment.save();

    // ENCRYPTION DISABLED - Comments stored as plain text
    const decryptedComment = comment.toObject();

    // Update post comment count (recalculate total including replies)
    const totalComments = await Comment.aggregate([
      { $match: { postId: new mongoose.Types.ObjectId(postId), isActive: true } },
      {
        $project: {
          total: { $add: [1, { $size: '$replies' }] } // 1 for comment + number of replies
        }
      },
      {
        $group: {
          _id: null,
          totalCount: { $sum: '$total' }
        }
      }
    ]);
    
    post.commentsCount = totalComments.length > 0 ? totalComments[0].totalCount : 0;
    await post.save();
    await syncPagePostCommentCount(post);

    // Update page statistics if it's a page post
    if (post.isPagePost && post.pageId) {
      try {
        const Page = require('../models/Page');
        await Page.findByIdAndUpdate(post.pageId, {
          $inc: { totalComments: 1 }
        });
        console.log(`📊 Page ${post.pageId} totalComments incremented`);
      } catch (pageError) {
        console.error('❌ Error updating page comments:', pageError);
      }
    }

    console.log(`💬 Comment created on post ${postId} by ${user.name}`);

    // Broadcast to WebSocket for real-time updates
    try {
      const { broadcastToAll, broadcastToUser } = require('../socketManager');
      
      // Broadcast comment to ALL users for real-time feed updates
      broadcastToAll('post:comment_update', {
        postId,
        comment: {
          _id: comment._id,
          userId: comment.userId,
          userName: comment.userName,
          userProfileImage: comment.userProfileImage,
          text: decryptedComment.text, // Send decrypted text
          likesCount: comment.likesCount,
          repliesCount: comment.repliesCount,
          createdAt: comment.createdAt
        },
        commentsCount: post.commentsCount
      });
      
      console.log(`📡 Comment update broadcasted to all users for post ${postId}`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting comment:', broadcastError);
    }

    // Notify the post owner (WebSocket + persisted notification + FCM push fallback)
    try {
      if (post.userId !== userId) {
        await enhancedNotificationService.sendCommentNotification(
          post.userId,
          { userId, name: user.name, profileImage: user.profileImage },
          { postId, isPagePost: post.isPagePost, pageId: post.pageId },
          decryptedComment.text
        );
      }
    } catch (notifyError) {
      console.error('❌ Error sending comment notification:', notifyError);
    }

    res.status(201).json({
      success: true,
      data: decryptedComment,
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

    const comments = await Comment.getPostComments(postId, 'FeedPost', page, limit);

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

    // ENCRYPTION DISABLED - Comments stored as plain text
    const decryptedComment = comment.toObject();

    console.log(`✏️ Comment updated: ${commentId}`);

    res.status(200).json({
      success: true,
      data: decryptedComment,
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

    // Update post comment count (recalculate total including replies)
    const post = await FeedPost.findById(comment.postId);
    if (post) {
      const totalComments = await Comment.aggregate([
        { $match: { postId: new mongoose.Types.ObjectId(comment.postId), isActive: true } },
        {
          $project: {
            total: { $add: [1, { $size: '$replies' }] }
          }
        },
        {
          $group: {
            _id: null,
            totalCount: { $sum: '$total' }
          }
        }
      ]);
      
      post.commentsCount = totalComments.length > 0 ? totalComments[0].totalCount : 0;
      await post.save();
      await syncPagePostCommentCount(post);

      // Update page statistics if it's a page post
      if (post.isPagePost && post.pageId) {
        try {
          const Page = require('../models/Page');
          await Page.findByIdAndUpdate(post.pageId, {
            $inc: { totalComments: -1 }
          });
          console.log(`📊 Page ${post.pageId} totalComments decremented`);
        } catch (pageError) {
          console.error('❌ Error updating page comments:', pageError);
        }
      }
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

    // Notify comment owner only when it becomes liked (not on unlike)
    if (isLiked && comment.userId !== userId) {
      try {
        const liker = await User.findOne({ userId }).select('name profileImage');
        const post = await FeedPost.findById(comment.postId).select('isPagePost pageId');
        await enhancedNotificationService.sendCommentLikeNotification(
          comment.userId,
          { userId, name: liker?.name || 'Someone', profileImage: liker?.profileImage },
          { postId: comment.postId, commentId, isPagePost: post && post.isPagePost, pageId: post && post.pageId }
        );
      } catch (notifyError) {
        console.error('❌ Error sending comment like notification:', notifyError);
      }
    }

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

    // Update post comment count to include this new reply
    const post = await FeedPost.findById(comment.postId);
    if (post) {
      const totalComments = await Comment.aggregate([
        { $match: { postId: new mongoose.Types.ObjectId(comment.postId), isActive: true } },
        {
          $project: {
            total: { $add: [1, { $size: '$replies' }] }
          }
        },
        {
          $group: {
            _id: null,
            totalCount: { $sum: '$total' }
          }
        }
      ]);
      
      post.commentsCount = totalComments.length > 0 ? totalComments[0].totalCount : 0;
      await post.save();
      await syncPagePostCommentCount(post);
      
      // Broadcast to WebSocket for real-time updates
      try {
        const { broadcastToAll } = require('../socketManager');
        
        broadcastToAll('post:comment_update', {
          postId: comment.postId,
          comment: replyData,
          commentsCount: post.commentsCount
        });
        
        console.log(`📡 Reply update broadcasted for post ${comment.postId}`);
      } catch (broadcastError) {
        console.error('❌ Error broadcasting reply:', broadcastError);
      }
    }

    console.log(`💬 Reply added to comment ${commentId}`);

    // Notify comment owner (WebSocket + persisted notification + FCM push fallback)
    try {
      if (comment.userId !== userId) {
        await enhancedNotificationService.sendCommentReplyNotification(
          comment.userId,
          { userId, name: user.name, profileImage: user.profileImage },
          { postId: comment.postId, commentId, isPagePost: post && post.isPagePost, pageId: post && post.pageId },
          text.trim()
        );
      }
    } catch (notifyError) {
      console.error('❌ Error sending reply notification:', notifyError);
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

    // Notify reply owner only when it becomes liked (not on unlike)
    if (isLiked && reply.userId !== userId) {
      try {
        const liker = await User.findOne({ userId }).select('name profileImage');
        const post = await FeedPost.findById(comment.postId).select('isPagePost pageId');
        await enhancedNotificationService.sendReplyLikeNotification(
          reply.userId,
          { userId, name: liker?.name || 'Someone', profileImage: liker?.profileImage },
          { postId: comment.postId, commentId, replyId, isPagePost: post && post.isPagePost, pageId: post && post.pageId }
        );
      } catch (notifyError) {
        console.error('❌ Error sending reply like notification:', notifyError);
      }
    }

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

    // Update post comment count to reflect deleted reply
    const post = await FeedPost.findById(comment.postId);
    if (post) {
      const totalComments = await Comment.aggregate([
        { $match: { postId: new mongoose.Types.ObjectId(comment.postId), isActive: true } },
        {
          $project: {
            total: { $add: [1, { $size: '$replies' }] }
          }
        },
        {
          $group: {
            _id: null,
            totalCount: { $sum: '$total' }
          }
        }
      ]);
      
      post.commentsCount = totalComments.length > 0 ? totalComments[0].totalCount : 0;
      await post.save();
      await syncPagePostCommentCount(post);
      
      // Broadcast to WebSocket for real-time updates
      try {
        const { broadcastToAll } = require('../socketManager');
        
        broadcastToAll('post:comment_update', {
          postId: comment.postId,
          commentsCount: post.commentsCount
        });
        
        console.log(`📡 Reply deletion broadcasted for post ${comment.postId}`);
      } catch (broadcastError) {
        console.error('❌ Error broadcasting reply deletion:', broadcastError);
      }
    }

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
