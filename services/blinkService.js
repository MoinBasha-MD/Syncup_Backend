const Blink = require('../models/blinkModel');
const User = require('../models/userModel');

class BlinkService {
  // Get active blinks from user’s contacts and own blinks
  async getContactsBlinks(currentUserId, options = {}) {
    const { limit = 50, offset = 0, contactsArray = null } = options;

    try {
      const contactUserIds = await this.getUserContactIds(currentUserId, contactsArray);
      const allUserIds = contactUserIds.length > 0
        ? [currentUserId, ...contactUserIds]
        : [currentUserId];

      await this.cleanupExpiredBlinks();

      const blinks = await Blink.find({
        userId: { $in: allUserIds },
        expiresAt: { $gt: new Date() }
      })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();

      if (!blinks.length) {
        return [];
      }

      const userIds = [...new Set(blinks.map(blink => blink.userId))];
      const users = await User.find({ userId: { $in: userIds } })
        .select('userId name profileImage')
        .lean();
      const userMap = new Map(users.map(user => [user.userId, user]));

      const formattedBlinks = blinks.map(blink => {
        const user = userMap.get(blink.userId);
        const seen = blink.seenBy?.some(s => s.userId === currentUserId) || false;
        const liked = blink.likes?.some(l => l.userId === currentUserId) || false;
        const likeCount = blink.likes?.length || 0;

        return {
          id: blink._id.toString(),
          userId: blink.userId,
          userName: user?.name || 'Unknown User',
          userProfileImage: user?.profileImage || null,
          createdAt: blink.createdAt.toISOString(),
          expiresAt: blink.expiresAt.toISOString(),
          mediaUrl: blink.mediaUrl,
          mediaType: blink.mediaType,
          musicUrl: blink.musicUrl,
          ringColor: blink.ringColor,
          caption: blink.caption,
          seen,
          liked,
          likeCount
        };
      });

      // Current user first, then others by creation time
      return formattedBlinks.sort((a, b) => {
        if (a.userId === currentUserId && b.userId !== currentUserId) return -1;
        if (b.userId === currentUserId && a.userId !== currentUserId) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } catch (error) {
      throw new Error(`Failed to get contacts blinks: ${error.message}`);
    }
  }

  // Create a new blink
  async createBlink(userId, blinkData) {
    try {
      if (!userId) throw new Error('User ID is required');
      if (!blinkData || !blinkData.mediaUrl) {
        throw new Error('Blink media URL is required');
      }

      // Only one active blink per user at a time
      const existingActive = await Blink.findOne({
        userId,
        expiresAt: { $gt: new Date() }
      });

      if (existingActive) {
        await Blink.deleteOne({ _id: existingActive._id });
      }

      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

      const blink = new Blink({
        userId,
        mediaUrl: blinkData.mediaUrl,
        mediaType: blinkData.mediaType || 'image',
        musicUrl: blinkData.musicUrl || null,
        ringColor: blinkData.ringColor || '#8B5CF6',
        caption: blinkData.caption || '',
        expiresAt
      });

      const savedBlink = await blink.save();

      const user = await User.findOne({ userId }).select('name profileImage').lean();

      const formattedResult = {
        id: savedBlink._id.toString(),
        userId: savedBlink.userId,
        userName: user?.name || 'You',
        userProfileImage: user?.profileImage || null,
        createdAt: savedBlink.createdAt.toISOString(),
        expiresAt: savedBlink.expiresAt.toISOString(),
        mediaUrl: savedBlink.mediaUrl,
        mediaType: savedBlink.mediaType,
        musicUrl: savedBlink.musicUrl,
        ringColor: savedBlink.ringColor,
        caption: savedBlink.caption,
        seen: false,
        liked: false,
        likeCount: 0
      };

      // Broadcast to contacts
      try {
        const socketManager = require('../socketManager');
        const contactUserIds = await this.getUserContactIds(userId);
        for (const contactUserId of contactUserIds) {
          socketManager.broadcastToUser(contactUserId, 'blink:new', {
            blink: formattedResult,
            fromUser: userId
          });
        }
      } catch (broadcastError) {
        console.warn('Failed to broadcast blink, but blink created successfully:', broadcastError);
      }

      return formattedResult;
    } catch (error) {
      throw new Error(`Failed to create blink: ${error.message}`);
    }
  }

  // Delete a blink (owner only)
  async deleteBlink(blinkId, userId) {
    try {
      if (!blinkId) throw new Error('Blink ID is required');
      if (!userId) throw new Error('User ID is required');

      const blink = await Blink.findOne({
        _id: blinkId,
        userId: userId?.toString() || userId
      });

      if (!blink) {
        throw new Error('Blink not found or not authorized');
      }

      await Blink.findByIdAndDelete(blinkId);

      // Broadcast deletion
      try {
        const socketManager = require('../socketManager');
        const contactUserIds = await this.getUserContactIds(userId);
        for (const contactUserId of contactUserIds) {
          socketManager.broadcastToUser(contactUserId, 'blink:deleted', {
            blinkId,
            fromUser: userId
          });
        }
      } catch (broadcastError) {
        console.warn('Failed to broadcast blink deletion:', broadcastError);
      }

      return { success: true, message: 'Blink deleted successfully', deletedBlinkId: blinkId };
    } catch (error) {
      throw new Error(`Failed to delete blink: ${error.message}`);
    }
  }

  // Mark blink as seen
  async markBlinkSeen(blinkId, userId) {
    try {
      const blink = await Blink.findOne({
        _id: blinkId,
        expiresAt: { $gt: new Date() }
      });

      if (!blink) {
        throw new Error('Blink not found or expired');
      }

      const alreadySeen = blink.seenBy?.some(s => s.userId === userId);
      if (!alreadySeen) {
        blink.seenBy.push({ userId, seenAt: new Date() });
        await blink.save();
      }

      return { success: true, seen: true };
    } catch (error) {
      throw new Error(`Failed to mark blink as seen: ${error.message}`);
    }
  }

  // Toggle like on a blink
  async toggleBlinkLike(blinkId, userId) {
    try {
      const blink = await Blink.findOne({
        _id: blinkId,
        expiresAt: { $gt: new Date() }
      });

      if (!blink) {
        throw new Error('Blink not found or expired');
      }

      const likeIndex = blink.likes?.findIndex(l => l.userId === userId) ?? -1;
      let liked;

      if (likeIndex > -1) {
        blink.likes.splice(likeIndex, 1);
        liked = false;
      } else {
        blink.likes.push({ userId, likedAt: new Date() });
        liked = true;
      }

      await blink.save();

      return {
        success: true,
        liked,
        likeCount: blink.likes.length
      };
    } catch (error) {
      throw new Error(`Failed to toggle blink like: ${error.message}`);
    }
  }

  // Cleanup expired blinks
  async cleanupExpiredBlinks() {
    try {
      const result = await Blink.cleanupExpiredBlinks();
      return { expiredDeleted: result.deletedCount };
    } catch (error) {
      throw new Error(`Failed to cleanup blinks: ${error.message}`);
    }
  }

  // Get user contact IDs
  async getUserContactIds(currentUserId, contactsArray = null) {
    try {
      try {
        const Friend = require('../models/Friend');
        const friends = await Friend.getFriends(currentUserId, {
          status: 'accepted',
          includeDeviceContacts: true,
          includeAppConnections: true
        });

        if (friends && friends.length > 0) {
          return friends
            .filter(friend => friend && friend.friendUserId)
            .map(friend => friend.friendUserId);
        }
      } catch (friendModelError) {
        console.error('Error getting friends from Friend model:', friendModelError);
      }

      if (contactsArray && Array.isArray(contactsArray) && contactsArray.length > 0) {
        return contactsArray
          .filter(contact => contact && (contact.userId || contact.id))
          .map(contact => contact.userId || contact.id);
      }

      return [];
    } catch (error) {
      console.error('Error getting user contacts:', error);
      return [];
    }
  }
}

module.exports = new BlinkService();
