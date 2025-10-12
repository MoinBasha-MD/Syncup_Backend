const storyService = require('../services/storyService');

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

      if (!storyId) {
        console.error('❌ No story ID provided');
        return res.status(400).json({
          success: false,
          message: 'Story ID is required'
        });
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

      if (!id) {
        console.error('❌ No story ID provided');
        return res.status(400).json({
          success: false,
          message: 'Story ID is required'
        });
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

      if (!id) {
        console.error('❌ No story ID provided');
        return res.status(400).json({
          success: false,
          message: 'Story ID is required'
        });
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
