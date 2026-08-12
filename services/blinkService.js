const Blink = require('../models/blinkModel');
const User = require('../models/userModel');
const blinkNotificationService = require('./blinkNotificationService');
const fs = require('fs');
const path = require('path');

class BlinkService {
  // Remove uploaded media/music files from disk so deleted/replaced Blinks do not leak storage
  deleteBlinkMediaFiles(mediaUrl, musicUrl) {
    try {
      const deleteFileFromUrl = (url) => {
        if (!url || typeof url !== 'string') return;
        let relativePath = url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
          try {
            const parsed = new URL(url);
            relativePath = parsed.pathname;
          } catch (e) {
            return;
          }
        }
        if (!relativePath.startsWith('/uploads/')) return;
        const filePath = path.join(__dirname, '..', relativePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('Deleted blink media file:', filePath);
        }
      };

      deleteFileFromUrl(mediaUrl);
      deleteFileFromUrl(musicUrl);
    } catch (error) {
      console.warn('Failed to delete blink media files:', error.message);
    }
  }
  // Get active blinks from user’s contacts and own blinks
  async getContactsBlinks(currentUserId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    try {
      const contactUserIds = await this.getUserContactIds(currentUserId);
      const allUserIds = contactUserIds.length > 0
        ? [currentUserId, ...contactUserIds]
        : [currentUserId];

      await this.cleanupExpiredBlinks();

      const blinks = await Blink.find({
        userId: { $in: allUserIds },
        isActive: true,
        expiresAt: { $gt: new Date() }
      })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();

      if (!blinks.length) {
        return [];
      }

      // Enforce recipient / friend privacy before formatting
      const authorizedBlinks = [];
      for (const blink of blinks) {
        if (await this.isAuthorizedForBlink(blink, currentUserId)) {
          authorizedBlinks.push(blink);
        }
      }

      if (!authorizedBlinks.length) {
        return [];
      }

      const userIds = [...new Set(authorizedBlinks.map(blink => blink.userId))];
      const users = await User.find({ userId: { $in: userIds } })
        .select('userId name profileImage')
        .lean();
      const userMap = new Map(users.map(user => [user.userId, user]));

      const formattedBlinks = authorizedBlinks.map(blink => {
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

  // Check whether a user is allowed to view/like/mark a Blink.
  // Owner is always allowed. Explicit recipients are allowed. Empty recipients => all accepted friends.
  async isAuthorizedForBlink(blink, currentUserId) {
    if (!blink || !currentUserId) return false;
    if (blink.userId === currentUserId) return true;

    if (Array.isArray(blink.recipients) && blink.recipients.length > 0) {
      return blink.recipients.includes(currentUserId);
    }

    // Fall back to accepted-friends model
    try {
      const Friend = require('../models/Friend');
      return await Friend.areFriends(currentUserId, blink.userId);
    } catch (error) {
      console.error('Error checking blink authorization:', error);
      return false;
    }
  }

  // Create a new blink (multiple active Blinks per user are allowed)
  async createBlink(userId, blinkData) {
    try {
      if (!userId) throw new Error('User ID is required');
      if (!blinkData || !blinkData.mediaUrl) {
        throw new Error('Blink media URL is required');
      }

      // Normalize recipients: keep only accepted friends, default to all friends when empty
      const acceptedFriendIds = await this.getUserContactIds(userId);
      const acceptedSet = new Set(acceptedFriendIds);
      let recipients = [];
      if (Array.isArray(blinkData.recipients) && blinkData.recipients.length > 0) {
        recipients = blinkData.recipients
          .map(id => String(id))
          .filter(id => acceptedSet.has(id));
      }
      // If no valid recipients were supplied, share with all accepted friends
      if (recipients.length === 0) {
        recipients = acceptedFriendIds.slice();
      }

      const blink = new Blink({
        userId,
        mediaUrl: blinkData.mediaUrl,
        mediaType: blinkData.mediaType || 'image',
        musicUrl: blinkData.musicUrl || null,
        ringColor: blinkData.ringColor || '#8B5CF6',
        caption: blinkData.caption || '',
        recipients,
        recipientGroups: Array.isArray(blinkData.recipientGroups) ? blinkData.recipientGroups : []
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
        recipients: savedBlink.recipients || [],
        recipientGroups: savedBlink.recipientGroups || [],
        seen: false,
        liked: false,
        likeCount: 0
      };

      // Broadcast only to valid recipients
      try {
        const socketManager = require('../socketManager');
        for (const contactUserId of recipients) {
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

  // Get all active Blinks for the current user with like/viewer details
  async getMyBlinks(userId) {
    try {
      if (!userId) throw new Error('User ID is required');

      await this.cleanupExpiredBlinks();

      const blinks = await Blink.find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!blinks.length) {
        return [];
      }

      const allUserIds = new Set();
      for (const blink of blinks) {
        (blink.seenBy || []).forEach(s => allUserIds.add(s.userId));
        (blink.likes || []).forEach(l => allUserIds.add(l.userId));
      }

      const users = await User.find({ userId: { $in: [...allUserIds] } })
        .select('userId name profileImage')
        .lean();
      const userMap = new Map(users.map(user => [user.userId, user]));

      const populateUser = (id) => ({
        userId: id,
        name: userMap.get(id)?.name || 'Unknown User',
        profileImage: userMap.get(id)?.profileImage || null
      });

      const user = await User.findOne({ userId }).select('name profileImage').lean();

      return blinks.map(blink => {
        const seenBy = (blink.seenBy || []).map(s => ({
          ...populateUser(s.userId),
          seenAt: s.seenAt?.toISOString?.() || s.seenAt
        }));
        const likes = (blink.likes || []).map(l => ({
          ...populateUser(l.userId),
          likedAt: l.likedAt?.toISOString?.() || l.likedAt
        }));

        return {
          id: blink._id.toString(),
          userId: blink.userId,
          userName: user?.name || 'You',
          userProfileImage: user?.profileImage || null,
          createdAt: blink.createdAt.toISOString(),
          expiresAt: blink.expiresAt.toISOString(),
          mediaUrl: blink.mediaUrl,
          mediaType: blink.mediaType,
          musicUrl: blink.musicUrl,
          ringColor: blink.ringColor,
          caption: blink.caption,
          recipients: blink.recipients || [],
          recipientGroups: blink.recipientGroups || [],
          seenBy,
          likes,
          likeCount: likes.length,
          seenCount: seenBy.length
        };
      });
    } catch (error) {
      throw new Error(`Failed to get my Blinks: ${error.message}`);
    }
  }

  // Get detailed like/viewer info for a single Blink (owner only)
  async getBlinkDetails(blinkId, userId) {
    try {
      if (!blinkId) throw new Error('Blink ID is required');
      if (!userId) throw new Error('User ID is required');

      const blink = await Blink.findOne({
        _id: blinkId,
        userId: userId?.toString() || userId
      }).lean();

      if (!blink) {
        throw new Error('Blink not found or not authorized');
      }

      const allUserIds = new Set([
        ...(blink.seenBy || []).map(s => s.userId),
        ...(blink.likes || []).map(l => l.userId)
      ]);

      const users = await User.find({ userId: { $in: [...allUserIds] } })
        .select('userId name profileImage')
        .lean();
      const userMap = new Map(users.map(user => [user.userId, user]));

      const populateUser = (id) => ({
        userId: id,
        name: userMap.get(id)?.name || 'Unknown User',
        profileImage: userMap.get(id)?.profileImage || null
      });

      const user = await User.findOne({ userId }).select('name profileImage').lean();

      const seenBy = (blink.seenBy || []).map(s => ({
        ...populateUser(s.userId),
        seenAt: s.seenAt?.toISOString?.() || s.seenAt
      }));
      const likes = (blink.likes || []).map(l => ({
        ...populateUser(l.userId),
        likedAt: l.likedAt?.toISOString?.() || l.likedAt
      }));

      return {
        id: blink._id.toString(),
        userId: blink.userId,
        userName: user?.name || 'You',
        userProfileImage: user?.profileImage || null,
        createdAt: blink.createdAt.toISOString(),
        expiresAt: blink.expiresAt.toISOString(),
        mediaUrl: blink.mediaUrl,
        mediaType: blink.mediaType,
        musicUrl: blink.musicUrl,
        ringColor: blink.ringColor,
        caption: blink.caption,
        recipients: blink.recipients || [],
        recipientGroups: blink.recipientGroups || [],
        seenBy,
        likes,
        likeCount: likes.length,
        seenCount: seenBy.length
      };
    } catch (error) {
      throw new Error(`Failed to get Blink details: ${error.message}`);
    }
  }

  // Delete a blink (owner only)
  async deleteBlink(blinkId, userId) {
    try {
      if (!blinkId) throw new Error('Blink ID is required');
      if (!userId) throw new Error('User ID is required');

      const blink = await Blink.findOne({
        _id: blinkId,
        userId: userId?.toString() || userId,
        isActive: true
      });

      if (!blink) {
        throw new Error('Blink not found or not authorized');
      }

      this.deleteBlinkMediaFiles(blink.mediaUrl, blink.musicUrl);
      await Blink.findByIdAndDelete(blinkId);

      // Broadcast deletion only to recipients (or all contacts if recipients not set)
      try {
        const socketManager = require('../socketManager');
        const broadcastTargets = Array.isArray(blink.recipients) && blink.recipients.length > 0
          ? blink.recipients
          : await this.getUserContactIds(userId);
        for (const contactUserId of broadcastTargets) {
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
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!blink) {
        throw new Error('Blink not found or expired');
      }

      const isAuthorized = await this.isAuthorizedForBlink(blink, userId);
      if (!isAuthorized) {
        throw new Error('Not authorized to view this blink');
      }

      const alreadySeen = blink.seenBy?.some(s => s.userId === userId);
      if (!alreadySeen) {
        blink.seenBy.push({ userId, seenAt: new Date() });
        await blink.save();
      }

      // Notify the viewer's own clients so the ring dims on all devices
      try {
        const socketManager = require('../socketManager');
        socketManager.broadcastToUser(userId, 'blink:seen', {
          blinkId: blink._id.toString(),
          userId,
          seenAt: new Date().toISOString()
        });
      } catch (broadcastError) {
        console.warn('Failed to broadcast blink seen update:', broadcastError);
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
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!blink) {
        throw new Error('Blink not found or expired');
      }

      const isAuthorized = await this.isAuthorizedForBlink(blink, userId);
      if (!isAuthorized) {
        throw new Error('Not authorized to interact with this blink');
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

      if (liked) {
        blinkNotificationService.notifyBlinkLiked(blink, userId);
      }

      return {
        success: true,
        liked,
        likeCount: blink.likes.length
      };
    } catch (error) {
      throw new Error(`Failed to toggle blink like: ${error.message}`);
    }
  }

  // Report that a viewer captured a Blink (screenshot / screen recording)
  async reportBlinkCapture(blinkId, userId, captureType) {
    try {
      if (!blinkId) throw new Error('Blink ID is required');
      if (!userId) throw new Error('User ID is required');
      if (!['screenshot', 'screen_recording'].includes(captureType)) {
        throw new Error('Invalid capture type');
      }

      const blink = await Blink.findOne({
        _id: blinkId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!blink) {
        throw new Error('Blink not found or expired');
      }

      if (blink.userId === userId) {
        // Owner capturing their own Blink doesn't need a notification
        return { success: true, notified: false };
      }

      const isAuthorized = await this.isAuthorizedForBlink(blink, userId);
      if (!isAuthorized) {
        throw new Error('Not authorized to view this blink');
      }

      blinkNotificationService.notifyBlinkCaptured(blink, userId, captureType);

      return { success: true, notified: true };
    } catch (error) {
      throw new Error(`Failed to report Blink capture: ${error.message}`);
    }
  }

  // Cleanup expired blinks
  async cleanupExpiredBlinks() {
    try {
      const expired = await Blink.find({
        expiresAt: { $lte: new Date() }
      }).select('mediaUrl musicUrl').lean();

      for (const blink of expired) {
        this.deleteBlinkMediaFiles(blink.mediaUrl, blink.musicUrl);
      }

      const result = await Blink.cleanupExpiredBlinks();
      return { expiredDeleted: result.deletedCount };
    } catch (error) {
      throw new Error(`Failed to cleanup blinks: ${error.message}`);
    }
  }

  // Get accepted friend IDs. Blinks are visible to accepted friends only.
  async getUserContactIds(currentUserId) {
    try {
      const Friend = require('../models/Friend');
      const friends = await Friend.getFriends(currentUserId, { status: 'accepted' });

      return (friends || [])
        .filter(friend => friend && friend.friendUserId)
        .map(friend => friend.friendUserId);
    } catch (error) {
      console.error('Error getting accepted friends for blink distribution:', error);
      return [];
    }
  }
}

module.exports = new BlinkService();
