const Story = require('../models/storyModel');
const StorySeen = require('../models/storySeenModel');
const StoryLike = require('../models/storyLikeModel');
const StoryView = require('../models/storyViewModel');
const User = require('../models/userModel');

class StoryService {
  // Get active stories from user's contacts AND the user's own stories
  async getContactsStories(currentUserId, options = {}) {
    const { limit = 50, offset = 0, contactsArray = null } = options;

    try {
      // Get user's contacts - pass contactsArray from frontend if provided
      const contactUserIds = await this.getUserContactIds(currentUserId, contactsArray);
      
      // Only include current user's own stories if no contacts, otherwise include both
      const allUserIds = contactUserIds.length > 0 
        ? [currentUserId, ...contactUserIds] 
        : [currentUserId]; // Only show own stories if no contacts
      
      console.log('🔍 Getting stories for users:', allUserIds);
      console.log('🔍 Current user ID:', currentUserId);
      console.log('🔍 Contact IDs:', contactUserIds);
      console.log('🔍 Total users to query:', allUserIds.length);

      // Clean up expired stories first
      await this.cleanupExpiredStories();
      
      // Get active stories from contacts AND current user using userId field (string)
      const stories = await Story.find({
        userId: { $in: allUserIds },
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();

      console.log('📊 Raw stories found:', stories.length);
      console.log('📊 Story details:', stories.map(s => ({id: s._id, userId: s.userId, createdAt: s.createdAt})));

      if (!stories.length) {
        console.log('❌ No stories found for users:', allUserIds);
        return [];
      }

      // Get story IDs for seen status check
      const storyIds = stories.map(story => story._id.toString());

      // Get seen status for current user
      const seenStories = await StorySeen.getSeenStoriesForUser(currentUserId, storyIds);
      const seenMap = new Map(seenStories.map(seen => [seen.storyId, seen.seenAt]));

      // Get like status and counts for all stories
      const likedStories = await StoryLike.getLikedStoriesByUser(currentUserId, storyIds);
      const likedMap = new Map(likedStories.map(like => [like.storyId, like.likedAt]));
      
      // Get like counts for all stories
      const likeCounts = await Promise.all(
        storyIds.map(async storyId => ({
          storyId,
          count: await StoryLike.countLikes(storyId)
        }))
      );
      const likeCountMap = new Map(likeCounts.map(lc => [lc.storyId, lc.count]));

      // Get user details for stories using userId field (string) instead of _id
      const userIds = [...new Set(stories.map(story => story.userId))];
      const users = await User.find({ userId: { $in: userIds } })
        .select('userId name profileImage')
        .lean();
      const userMap = new Map(users.map(user => [user.userId, user]));

      // Format response and sort: current user's stories first, then others by creation time
      const formattedStories = stories.map(story => {
        const user = userMap.get(story.userId);
        const storyIdStr = story._id.toString();
        const seen = seenMap.has(storyIdStr);
        const liked = likedMap.has(storyIdStr);
        const likeCount = likeCountMap.get(storyIdStr) || 0;

        return {
          id: storyIdStr,
          userId: story.userId,
          userName: user?.name || 'Unknown User',
          userProfileImage: user?.profileImage || null,
          createdAt: story.createdAt.toISOString(),
          expiresAt: story.expiresAt.toISOString(),
          seen,
          liked,
          likeCount,
          items: story.items || []
        };
      });

      // Sort stories: current user's stories first, then others by creation time
      const sortedStories = formattedStories.sort((a, b) => {
        // Current user stories first
        if (a.userId === currentUserId && b.userId !== currentUserId) return -1;
        if (b.userId === currentUserId && a.userId !== currentUserId) return 1;
        
        // For current user stories: sort newest first (latest story shows first)
        if (a.userId === currentUserId && b.userId === currentUserId) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        
        // For other users: sort newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      console.log(`✅ Found ${sortedStories.length} stories for user ${currentUserId}`);
      console.log('📊 Stories breakdown:', sortedStories.map(s => ({id: s.id, userId: s.userId, userName: s.userName})));
      return sortedStories;
    } catch (error) {
      throw new Error(`Failed to get contacts stories: ${error.message}`);
    }
  }

  // Create a new story
  async createStory(userId, storyData) {
    try {
      console.log('📝 StoryService.createStory called with userId:', userId);
      console.log('📝 Story data:', JSON.stringify(storyData, null, 2));
      
      // Validate input
      if (!userId) {
        throw new Error('User ID is required');
      }
      
      if (!storyData || !storyData.items || !Array.isArray(storyData.items) || storyData.items.length === 0) {
        throw new Error('Story must contain at least one item');
      }
      
      // Check for existing active stories for this user
      const existingActiveStories = await Story.find({ 
        userId,
        expiresAt: { $gt: new Date() }
      });
      
      console.log(`📊 User has ${existingActiveStories.length} existing active stories`);
      
      // Instagram-style: Allow multiple stories, but limit to reasonable number (e.g., 10)
      const MAX_STORIES_PER_USER = 10;
      
      if (existingActiveStories.length >= MAX_STORIES_PER_USER) {
        console.log(`⚠️ User has reached maximum stories limit (${MAX_STORIES_PER_USER}), removing oldest`);
        
        // Remove oldest story to make room for new one
        const oldestStory = await Story.findOne({ 
          userId,
          expiresAt: { $gt: new Date() }
        }).sort({ createdAt: 1 });
        
        if (oldestStory) {
          await Story.deleteOne({ _id: oldestStory._id });
          await StorySeen.deleteMany({ storyId: oldestStory._id.toString() });
          console.log('🗑️ Removed oldest story to make room for new one');
        }
      }
      
      // Process story items
      const processedItems = storyData.items.map((item, index) => ({
        id: item.id || `item_${Date.now()}_${index}`,
        type: item.type || 'image',
        url: item.url || null,
        text: item.text || null,
        backgroundColor: item.backgroundColor || '#000000',
        textColor: item.textColor || '#FFFFFF',
        fontSize: item.fontSize || 'medium',
        fontFamily: item.fontFamily || 'default',
        textAlign: item.textAlign || 'center',
        durationMs: item.durationMs || 5000
      }));
      
      // Set expiration time (24 hours from now)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      console.log('💾 Creating story document with data:', {
        userId,
        itemsCount: processedItems.length,
        expiresAt: expiresAt.toISOString()
      });
      
      // Create story document with explicit expiresAt field
      const story = new Story({
        userId,
        items: processedItems,
        expiresAt // Add this explicitly to satisfy validation
      });
      
      const savedStory = await story.save();
      console.log('✅ Story saved successfully with ID:', savedStory._id);
      
      // Format the result for API response
      const formattedResult = {
        id: savedStory._id.toString(),
        userId: savedStory.userId,
        userName: 'You', // This will be populated by the frontend
        userProfileImage: null, // This will be populated by the frontend
        createdAt: savedStory.createdAt.toISOString(),
        expiresAt: savedStory.expiresAt.toISOString(),
        seen: false,
        items: savedStory.items
      };
      
      console.log('📤 Returning formatted story:', JSON.stringify(formattedResult, null, 2));
      
      // Broadcast new story to contacts via WebSocket
      try {
        const socketManager = require('../socketManager');
        const contactUserIds = await this.getUserContactIds(userId);
        
        console.log('📡 Broadcasting new story to contacts:', contactUserIds.length);
        
        // Broadcast to all contacts
        for (const contactUserId of contactUserIds) {
          socketManager.broadcastToUser(contactUserId, 'story:new', {
            story: formattedResult,
            fromUser: userId
          });
        }
        
        console.log('✅ Story broadcast completed');
      } catch (broadcastError) {
        console.error('⚠️ Failed to broadcast story, but story created successfully:', broadcastError);
      }
      
      return formattedResult;
    } catch (error) {
      console.error('❌ Story creation failed:', error);
      throw new Error(`Failed to create story: ${error.message}`);
    }
  }

  // Delete a story (owner only)
  async deleteStory(storyId, userId) {
    try {
      console.log('🗑️ StoryService.deleteStory called');
      console.log('🗑️ Story ID:', storyId);
      console.log('🗑️ User ID:', userId);
      
      // Validate inputs
      if (!storyId) {
        throw new Error('Story ID is required');
      }
      if (!userId) {
        throw new Error('User ID is required');
      }
      
      // First, let's check if the story exists at all
      const storyCheck = await Story.findById(storyId);
      console.log('🔍 Story exists check:', storyCheck ? 'Found' : 'Not found');
      
      if (storyCheck) {
        console.log('📋 Story owner:', storyCheck.userId);
        console.log('📋 Requesting user:', userId);
        console.log('📋 Ownership match:', storyCheck.userId === userId);
      }
      
      // Find story by ObjectId and verify ownership
      const story = await Story.findOne({
        _id: storyId,
        userId: userId
      });

      if (!story) {
        console.log('❌ Story not found or user not authorized');
        console.log('❌ Searched for story with _id:', storyId, 'and userId:', userId);
        
        // If story exists but user doesn't match, it's authorization issue
        if (storyCheck) {
          throw new Error('You are not authorized to delete this story');
        } else {
          throw new Error('Story not found');
        }
      }

      console.log('✅ Story found and user authorized, proceeding with deletion');
      console.log('✅ Story details:', {
        id: story._id,
        userId: story.userId,
        createdAt: story.createdAt,
        itemsCount: story.items?.length || 0
      });
      
      // Delete the story
      const deleteResult = await Story.findByIdAndDelete(storyId);
      console.log('🗑️ Story deletion result:', deleteResult ? 'Success' : 'Failed');
      
      // Also remove all seen records for this story
      const seenDeleteResult = await StorySeen.deleteMany({ storyId: storyId.toString() });
      console.log('🗑️ Seen records deleted:', seenDeleteResult.deletedCount);

      console.log('✅ Story and related data deleted successfully');
      
      // Broadcast story deletion to contacts via WebSocket
      try {
        const socketManager = require('../socketManager');
        const contactUserIds = await this.getUserContactIds(userId);
        
        console.log('📡 Broadcasting story deletion to contacts:', contactUserIds.length);
        
        // Broadcast to all contacts
        for (const contactUserId of contactUserIds) {
          socketManager.broadcastToUser(contactUserId, 'story:deleted', {
            storyId: storyId,
            fromUser: userId
          });
        }
        
        console.log('✅ Story deletion broadcast completed');
      } catch (broadcastError) {
        console.error('⚠️ Failed to broadcast story deletion, but story deleted successfully:', broadcastError);
      }
      
      return { 
        success: true,
        message: 'Story deleted successfully',
        deletedStoryId: storyId,
        seenRecordsDeleted: seenDeleteResult.deletedCount
      };
    } catch (error) {
      console.error('❌ Story deletion failed:', error);
      throw new Error(`Failed to delete story: ${error.message}`);
    }
  }

  // Mark story as seen
  async markStorySeen(storyId, userId) {
    try {
      console.log('👁️ Marking story as seen - Story ID:', storyId, 'User ID:', userId);
      
      // Verify story exists and is not expired
      const story = await Story.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        console.log('❌ Story not found or expired');
        throw new Error('Story not found or expired');
      }

      console.log('✅ Story found, marking as seen');
      
      // Mark as seen (idempotent) - use string storyId
      const seenRecord = await StorySeen.markAsSeen(storyId.toString(), userId);

      const result = {
        storyId: storyId.toString(),
        seenAt: seenRecord.seenAt.toISOString()
      };
      
      console.log('✅ Story marked as seen successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to mark story as seen:', error);
      throw new Error(`Failed to mark story as seen: ${error.message}`);
    }
  }

  // Toggle story like (like/unlike)
  async toggleStoryLike(storyId, userId) {
    try {
      console.log('❤️ Toggling story like - Story ID:', storyId, 'User ID:', userId);
      
      // Verify story exists and is not expired
      const story = await Story.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        console.log('❌ Story not found or expired');
        throw new Error('Story not found or expired');
      }

      // Get user info for like record
      const user = await User.findOne({ userId }).select('name profileImage');
      const userName = user?.name || 'User';
      const userProfileImage = user?.profileImage || null;

      console.log('✅ Story found, toggling like');
      
      // Toggle like (returns liked status and like count)
      const result = await StoryLike.toggleLike(
        storyId.toString(), 
        userId, 
        userName, 
        userProfileImage
      );

      // Broadcast like update to story owner via WebSocket
      try {
        const socketManager = require('../socketManager');
        socketManager.broadcastToUser(story.userId, 'story:like_update', {
          storyId: storyId.toString(),
          userId,
          userName,
          liked: result.liked,
          likeCount: result.likeCount,
          timestamp: new Date().toISOString()
        });
        console.log('✅ Like update broadcast to story owner');
      } catch (broadcastError) {
        console.error('⚠️ Failed to broadcast like update:', broadcastError);
      }
      
      console.log('✅ Story like toggled successfully:', result);
      return {
        storyId: storyId.toString(),
        liked: result.liked,
        likeCount: result.likeCount
      };
    } catch (error) {
      console.error('❌ Failed to toggle story like:', error);
      throw new Error(`Failed to toggle story like: ${error.message}`);
    }
  }

  // Get likes for a story
  async getStoryLikes(storyId, options = {}) {
    try {
      const { limit = 50 } = options;
      
      console.log('👥 Getting likes for story:', storyId);
      
      // Verify story exists
      const story = await Story.findById(storyId);
      if (!story) {
        throw new Error('Story not found');
      }

      const likes = await StoryLike.getLikesForStory(storyId.toString(), limit);
      const likeCount = await StoryLike.countLikes(storyId.toString());
      
      console.log('✅ Found', likes.length, 'likes for story');
      
      return {
        storyId: storyId.toString(),
        likeCount,
        likes: likes.map(like => ({
          userId: like.userId,
          userName: like.userName,
          userProfileImage: like.userProfileImage,
          likedAt: like.likedAt.toISOString()
        }))
      };
    } catch (error) {
      console.error('❌ Failed to get story likes:', error);
      throw new Error(`Failed to get story likes: ${error.message}`);
    }
  }

  // Track story view
  async trackStoryView(storyId, userId, userName, userProfileImage = null, io = null) {
    try {
      console.log('👁️ Tracking view for story:', storyId, 'by user:', userId);
      
      // Verify story exists
      const story = await Story.findById(storyId);
      if (!story) {
        throw new Error('Story not found');
      }

      // Don't track if user is viewing their own story
      if (story.userId === userId) {
        console.log('⏭️ Skipping view tracking - user viewing own story');
        return {
          storyId: storyId.toString(),
          viewCount: await this.getStoryViewCount(storyId)
        };
      }

      // Create or update view record (upsert to handle duplicates gracefully)
      const viewData = {
        storyId: storyId.toString(),
        userId,
        userName,
        userProfileImage,
        viewedAt: new Date()
      };

      // Use updateOne with upsert to avoid duplicate key errors
      await StoryView.updateOne(
        { storyId: storyId.toString(), userId },
        { $set: viewData },
        { upsert: true }
      );

      const viewCount = await this.getStoryViewCount(storyId);
      
      console.log('✅ Story view tracked. Total views:', viewCount);

      // Broadcast view update to story owner via WebSocket
      if (io) {
        try {
          io.to(story.userId).emit('story:view_update', {
            storyId: storyId.toString(),
            userId,
            userName,
            viewCount,
            timestamp: new Date().toISOString()
          });
          console.log('✅ View update broadcast to story owner');
        } catch (broadcastError) {
          console.error('⚠️ Failed to broadcast view update:', broadcastError);
        }
      }
      
      return {
        storyId: storyId.toString(),
        viewCount
      };
    } catch (error) {
      console.error('❌ Failed to track story view:', error);
      // Don't throw error for view tracking - it's not critical
      return {
        storyId: storyId.toString(),
        viewCount: 0
      };
    }
  }

  // Get view count for a story
  async getStoryViewCount(storyId) {
    try {
      return await StoryView.countDocuments({ storyId: storyId.toString() });
    } catch (error) {
      console.error('❌ Failed to get view count:', error);
      return 0;
    }
  }

  // Get views for a story
  async getStoryViews(storyId, options = {}) {
    try {
      const { limit = 50 } = options;
      
      console.log('👁️ Getting views for story:', storyId);
      
      // Verify story exists
      const story = await Story.findById(storyId);
      if (!story) {
        throw new Error('Story not found');
      }

      const views = await StoryView.find({ storyId: storyId.toString() })
        .sort({ viewedAt: -1 })
        .limit(limit)
        .lean();

      const viewCount = await this.getStoryViewCount(storyId);
      
      console.log('✅ Found', views.length, 'views for story');
      
      return {
        storyId: storyId.toString(),
        viewCount,
        views: views.map(view => ({
          userId: view.userId,
          userName: view.userName,
          userProfileImage: view.userProfileImage,
          viewedAt: view.viewedAt.toISOString()
        }))
      };
    } catch (error) {
      console.error('❌ Failed to get story views:', error);
      throw new Error(`Failed to get story views: ${error.message}`);
    }
  }

  // Get user's contact IDs - now accepts contacts array from frontend
  async getUserContactIds(currentUserId, contactsArray = null) {
    try {
      console.log('🔍 Getting contacts for user:', currentUserId);
      
      // ALWAYS use Friend model to get actual friends (privacy enforcement)
      // This ensures stories only show to accepted friends, not random contacts
      try {
        const Friend = require('../models/Friend');
        const friends = await Friend.getFriends(currentUserId, {
          status: 'accepted',
          includeDeviceContacts: true,
          includeAppConnections: true
        });
        
        if (friends && friends.length > 0) {
          const friendIds = friends
            .filter(friend => friend && friend.friendUserId)
            .map(friend => friend.friendUserId);
          
          console.log('📋 Found friends from Friend model:', friendIds.length, 'friends');
          console.log('📋 Friend IDs:', friendIds);
          return friendIds;
        }
      } catch (friendModelError) {
        console.error('❌ Error getting friends from Friend model:', friendModelError);
      }
      
      // If contacts array is provided from frontend, use it as fallback but only for actual friends
      if (contactsArray && Array.isArray(contactsArray) && contactsArray.length > 0) {
        console.log('⚠️ Friend model failed, using contacts array as fallback (privacy may be compromised)');
        const contactIds = contactsArray
          .filter(contact => contact && (contact.userId || contact.id))
          .map(contact => contact.userId || contact.id);
        
        console.log('📋 Using provided contacts array as fallback:', contactIds.length, 'contacts');
        return contactIds;
      }
      
      // No contacts found - return empty array
      console.log('📋 No contacts/friends found - returning empty array');
      return [];
    } catch (error) {
      console.error('❌ Error getting user contacts:', error);
      return [];
    }
  }

  // Cleanup expired stories and duplicates (utility method)
  async cleanupExpiredStories() {
    try {
      console.log('🧹 Starting story cleanup...');
      
      // 1. Delete expired stories
      const expiredResult = await Story.deleteMany({
        expiresAt: { $lte: new Date() }
      });
      console.log('🗑️ Deleted expired stories:', expiredResult.deletedCount);
      
      // 2. Clean up seen records for deleted stories
      const existingStoryIds = await Story.find({}).distinct('_id').then(ids => ids.map(id => id.toString()));
      
      const seenCleanupResult = await StorySeen.deleteMany({
        storyId: { $nin: existingStoryIds }
      });
      console.log('🗑️ Cleaned up orphaned seen records:', seenCleanupResult.deletedCount);
      
      // 3. Clean up like records for deleted stories
      const likeCleanupResult = await StoryLike.deleteMany({
        storyId: { $nin: existingStoryIds }
      });
      console.log('🗑️ Cleaned up orphaned like records:', likeCleanupResult.deletedCount);
      
      // 4. Clean up view records for deleted stories
      const viewCleanupResult = await StoryView.deleteMany({
        storyId: { $nin: existingStoryIds }
      });
      console.log('🗑️ Cleaned up orphaned view records:', viewCleanupResult.deletedCount);
      
      console.log('✅ Story cleanup completed');
      return { 
        expiredDeleted: expiredResult.deletedCount,
        seenCleanupDeleted: seenCleanupResult.deletedCount,
        likeCleanupDeleted: likeCleanupResult.deletedCount,
        viewCleanupDeleted: viewCleanupResult.deletedCount,
        totalDeleted: expiredResult.deletedCount + seenCleanupResult.deletedCount + likeCleanupResult.deletedCount + viewCleanupResult.deletedCount
      };
    } catch (error) {
      console.error('❌ Story cleanup failed:', error);
      throw new Error(`Failed to cleanup stories: ${error.message}`);
    }
  }
}

module.exports = new StoryService();
