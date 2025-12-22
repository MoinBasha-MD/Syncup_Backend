/**
 * Comment Mentions Routes
 * Handles @mention functionality in comments with friend validation
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Comment = require('../models/Comment');
const User = require('../models/userModel');
const Notification = require('../models/Notification');

// Save comment with mentions
router.post('/comments/:commentId/mentions', protect, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { mentions } = req.body; // Array of { userId, userName, startIndex, endIndex }
    const userId = req.user._id;

    console.log('💬 [MENTIONS] Save mentions:', { commentId, mentionsCount: mentions?.length });

    // Validate mentions array
    if (!mentions || !Array.isArray(mentions)) {
      return res.status(400).json({
        success: false,
        message: 'Mentions array is required'
      });
    }

    // Find comment
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Verify user owns this comment
    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this comment'
      });
    }

    // Get user's friends list
    const currentUser = await User.findById(userId).select('friends');
    const friendIds = currentUser.friends.map(f => f.toString());

    // Validate that all mentioned users are friends
    const validMentions = [];
    const invalidMentions = [];

    for (const mention of mentions) {
      if (friendIds.includes(mention.userId)) {
        validMentions.push(mention);
      } else {
        invalidMentions.push(mention);
        console.log('⚠️ [MENTIONS] Invalid mention - not a friend:', mention.userId);
      }
    }

    // Save valid mentions
    comment.mentions = validMentions;
    await comment.save();

    // Send notifications to mentioned friends
    for (const mention of validMentions) {
      try {
        await Notification.create({
          userId: mention.userId,
          type: 'comment_mention',
          fromUserId: userId,
          message: `${req.user.name} mentioned you in a comment`,
          data: {
            commentId: comment._id,
            postId: comment.postId,
            mentionText: mention.userName,
          },
          createdAt: new Date()
        });
        console.log('✅ [MENTIONS] Notification sent to:', mention.userId);
      } catch (notifError) {
        console.error('❌ [MENTIONS] Error sending notification:', notifError);
      }
    }

    console.log('✅ [MENTIONS] Mentions saved:', {
      valid: validMentions.length,
      invalid: invalidMentions.length
    });

    res.json({
      success: true,
      message: 'Mentions saved successfully',
      validMentions: validMentions.length,
      invalidMentions: invalidMentions.length,
      mentions: validMentions
    });
  } catch (error) {
    console.error('❌ [MENTIONS] Error saving mentions:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving mentions',
      error: error.message
    });
  }
});

// Get user's friends for mention autocomplete
router.get('/users/friends/search', protect, async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.user._id;

    console.log('🔍 [MENTIONS] Search friends:', { userId, query });

    // Get user's friends
    const user = await User.findById(userId)
      .populate('friends', 'name username profileImage');

    if (!user || !user.friends) {
      return res.json({
        success: true,
        friends: []
      });
    }

    // Filter friends by query
    let friends = user.friends;
    if (query && query.trim().length > 0) {
      const searchQuery = query.toLowerCase().trim();
      friends = friends.filter(friend => 
        friend.name.toLowerCase().includes(searchQuery) ||
        friend.username.toLowerCase().includes(searchQuery)
      );
    }

    // Format response
    const formattedFriends = friends.map(friend => ({
      userId: friend._id,
      userName: friend.username,
      name: friend.name,
      avatar: friend.profileImage
    }));

    console.log('✅ [MENTIONS] Found', formattedFriends.length, 'friends');

    res.json({
      success: true,
      friends: formattedFriends,
      count: formattedFriends.length
    });
  } catch (error) {
    console.error('❌ [MENTIONS] Error searching friends:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching friends',
      error: error.message
    });
  }
});

// Get mentions for a comment
router.get('/comments/:commentId/mentions', protect, async (req, res) => {
  try {
    const { commentId } = req.params;

    console.log('💬 [MENTIONS] Get mentions:', { commentId });

    const comment = await Comment.findById(commentId)
      .select('mentions')
      .populate('mentions.userId', 'name username profileImage');

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    console.log('✅ [MENTIONS] Found', comment.mentions?.length || 0, 'mentions');

    res.json({
      success: true,
      mentions: comment.mentions || [],
      count: comment.mentions?.length || 0
    });
  } catch (error) {
    console.error('❌ [MENTIONS] Error getting mentions:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting mentions',
      error: error.message
    });
  }
});

module.exports = router;
