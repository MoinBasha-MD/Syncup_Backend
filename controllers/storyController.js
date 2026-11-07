const storyService = require('../services/storyService');
const mongoose = require('mongoose');
const Story = require('../models/storyModel');
const Friend = require('../models/Friend');

// Stories are visible to their owner and accepted friends only.
const canAccessStory = async (storyId, userId) => {
  if (!storyId || !userId || !mongoose.Types.ObjectId.isValid(String(storyId))) return null;
  const story = await Story.findById(storyId).select('userId');
  if (!story) return null;
  if (String(story.userId) === String(userId)) return story;
  const [forward, reverse] = await Promise.all([
    Friend.areFriends(userId, story.userId),
    Friend.areFriends(story.userId, userId),
  ]);
  return forward || reverse ? story : null;
};

class StoryController {
  // GET /api/stories/contacts - Get active stories from user's contacts
  async getContactsStories(req, res) {
    try {
      console.log('📚 Get contacts stories request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      
      // Use userId from req.user (consistent with other methods)
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      
      if (!currentUserId) {
        console.error('❌ No user ID found in request');
        return res.status(400).json({
          success: false,
          message: 'User authentication failed - no user ID found'
        });
      }
      
      console.log('✅ Using user ID:', currentUserId);

      // Extract contacts array from request body if provided
      const contactsArray = req.body?.contacts || null;
      console.log('📋 Contacts array from frontend:', contactsArray ? contactsArray.length : 'none');

      const stories = await storyService.getContactsStories(currentUserId, { contactsArray });
      
      console.log('✅ Retrieved stories count:', stories.length);

      res.status(200).json({
        success: true,
        data: stories
      });
    } catch (error) {
      console.error('❌ Error getting contacts stories:', error);
      
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get contacts stories'
      });
    }
  }

  // POST /api/stories - Create a new story
  async createStory(req, res) {
    try {
      console.log('📝 Story creation request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      // Use userId from req.user (more reliable than id)
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      
      if (!currentUserId) {
        console.error('❌ No user ID found in request');
        return res.status(400).json({
          success: false,
          message: 'User authentication failed - no user ID found'
        });
      }
      
      console.log('✅ Using user ID:', currentUserId);
      
      const storyData = req.body;
      
      // Validate request body
      if (!storyData || !storyData.items || !Array.isArray(storyData.items) || storyData.items.length === 0) {
        console.error('❌ Invalid story data - missing items');
        return res.status(400).json({
          success: false,
          message: 'Story must contain at least one item'
        });
      }

      const result = await storyService.createStory(currentUserId, storyData);
      
      console.log('✅ Story created successfully:', result.id);

      res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error creating story:', error);
      
      if (error.message.includes('must contain') || error.message.includes('required') || error.message.includes('Text content') || error.message.includes('URL is required')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create story'
      });
    }
  }

  // DELETE /api/stories/:id - Delete a story
  async deleteStory(req, res) {
    try {
      console.log('🗑️ Delete story request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      
      // Use userId from req.user (consistent with other methods)
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      
      if (!currentUserId) {
        console.error('❌ No user ID found in request');
        return res.status(400).json({
          success: false,
          message: 'User authentication failed - no user ID found'
        });
      }
      
      const { id } = req.params;
      console.log('✅ Deleting story ID:', id, 'for user:', currentUserId);

      const result = await storyService.deleteStory(id, currentUserId);
      
      console.log('✅ Story deleted successfully');

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error deleting story:', error);
      
      if (error.message.includes('not found') || error.message.includes('not authorized')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete story'
      });
    }
  }

  // POST /api/stories/seen
  async markStorySeen(req, res) {
    try {
      console.log('👁️ Mark story as seen request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      
      // Use userId from req.user (consistent with other methods)
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      
      if (!currentUserId) {
        console.error('❌ No user ID found in request');
        return res.status(400).json({
          success: false,
          message: 'User authentication failed - no user ID found'
        });
      }
      
      const { storyId } = req.body;

      if (!storyId || !(await canAccessStory(storyId, currentUserId))) {
        return res.status(404).json({ success: false, message: 'Story not found' });
      }

      console.log('✅ Marking story as seen - Story ID:', storyId, 'User ID:', currentUserId);

      const result = await storyService.markStorySeen(storyId, currentUserId);
      
      console.log('✅ Story marked as seen successfully');

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error marking story as seen:', error);
      
      // Check if response already sent
      if (res.headersSent) {
        console.error('❌ Response already sent, cannot send error response');
        return;
      }
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to mark story as seen'
      });
    }
  }

  // POST /api/stories/:id/like - Toggle like on a story
  async toggleStoryLike(req, res) {
    try {
      console.log('❤️ Toggle story like request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      
      if (!currentUserId) {
        console.error('❌ No user ID found in request');
        return res.status(400).json({
          success: false,
          message: 'User authentication failed - no user ID found'
        });
      }
      
      const { id } = req.params;

      if (!id || !(await canAccessStory(id, currentUserId))) {
        return res.status(404).json({ success: false, message: 'Story not found' });
      }

      console.log('✅ Toggling like - Story ID:', id, 'User ID:', currentUserId);

      const result = await storyService.toggleStoryLike(id, currentUserId);
      
      console.log('✅ Story like toggled successfully');

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error toggling story like:', error);
      
      if (res.headersSent) {
        console.error('❌ Response already sent, cannot send error response');
        return;
      }
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to toggle story like'
      });
    }
  }

  // GET /api/stories/:id/likes - Get likes for a story
  async getStoryLikes(req, res) {
    try {
      console.log('👥 Get story likes request received');
      
      const { id } = req.params;

      if (!id || !(await canAccessStory(id, req.user.userId))) {
        return res.status(404).json({ success: false, message: 'Story not found' });
      }

      console.log('✅ Getting likes for story:', id);

      const result = await storyService.getStoryLikes(id);
      
      console.log('✅ Story likes retrieved successfully');

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error getting story likes:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get story likes'
      });
    }
  }

  // POST /api/stories/:id/view - Track story view
  async trackStoryView(req, res) {
    try {
      console.log('👁️ Track story view request received');
      
      const { id } = req.params;
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      const userName = req.user.fullName || req.user.name || req.user.username || 'Unknown User';
      const userProfileImage = req.user.profileImage || null;

      if (!currentUserId) {
        return res.status(400).json({
          success: false,
          message: 'User authentication failed'
        });
      }

      if (!id || !(await canAccessStory(id, currentUserId))) {
        return res.status(404).json({ success: false, message: 'Story not found' });
      }

      console.log('✅ Tracking view for story:', id, 'by user:', currentUserId);

      // Get io instance from app (set in server.js)
      const io = req.app.get('io');
      const result = await storyService.trackStoryView(id, currentUserId, userName, userProfileImage, io);
      
      console.log('✅ Story view tracked successfully');

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error tracking story view:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to track story view'
      });
    }
  }

  // GET /api/stories/:id/views - Get views for a story
  async getStoryViews(req, res) {
    try {
      console.log('👁️ Get story views request received');
      
      const { id } = req.params;

      if (!id || !(await canAccessStory(id, req.user.userId))) {
        return res.status(404).json({ success: false, message: 'Story not found' });
      }

      console.log('✅ Getting views for story:', id);

      const result = await storyService.getStoryViews(id);
      
      console.log('✅ Story views retrieved successfully');

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Error getting story views:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get story views'
      });
    }
  }

  // POST /api/stories/cleanup - Clean up expired and duplicate stories
  async cleanupStories(req, res) {
    try {
      console.log('🧹 Story cleanup request received');
      
      const result = await storyService.cleanupExpiredStories();
      
      console.log('✅ Story cleanup completed:', result);

      res.status(200).json({
        success: true,
        data: result,
        message: `Cleanup completed: ${result.totalDeleted} stories removed`
      });
    } catch (error) {
      console.error('❌ Error during story cleanup:', error);
      
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to cleanup stories'
      });
    }
  }
}

module.exports = new StoryController();
