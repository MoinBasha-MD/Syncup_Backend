const path = require('path');
const fs = require('fs');
const { getInstance: getMediaEncryption } = require('../utils/mediaFileEncryption');

/**
 * Middleware to decrypt and serve encrypted media files
 * 
 * This middleware intercepts requests to /uploads/* and checks if the file is encrypted.
 * If encrypted, it decrypts on-the-fly and serves the decrypted content.
 * If not encrypted (legacy files), it serves them as-is.
 */
const decryptMediaMiddleware = async (req, res, next) => {
  try {
    // Only process /uploads/* paths
    if (!req.path.startsWith('/uploads/')) {
      return next();
    }

    // Get the file path
    const filePath = path.join(__dirname, '..', req.path);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      // If .enc file doesn't exist, try without .enc (legacy files)
      const legacyPath = filePath.replace('.enc', '');
      if (fs.existsSync(legacyPath)) {
        console.log('📁 [MEDIA DECRYPT] Serving legacy unencrypted file:', legacyPath);
        return res.sendFile(legacyPath);
      }
      return next(); // Let 404 handler deal with it
    }

    // Check if file is encrypted
    const mediaEncryption = getMediaEncryption();
    
    if (!mediaEncryption.isEncryptedFile(filePath)) {
      // Not encrypted, serve as-is (legacy files)
      console.log('📁 [MEDIA DECRYPT] Serving unencrypted file:', filePath);
      return res.sendFile(filePath);
    }

    // File is encrypted - need to decrypt
    console.log('🔓 [MEDIA DECRYPT] Decrypting file:', filePath);

    // Get encryption metadata from database based on file type
    let encryptionIv, encryptionAuthTag, mimeType;

    // Determine file type from path
    if (req.path.includes('/post-media/')) {
      // Post media - get from FeedPost model
      const FeedPost = require('../models/FeedPost');
      const filename = path.basename(req.path);
      
      const post = await FeedPost.findOne({
        'media.url': { $regex: filename }
      }).lean();

      if (post && post.media) {
        const mediaItem = post.media.find(m => m.url.includes(filename));
        if (mediaItem && mediaItem.encrypted) {
          encryptionIv = mediaItem.encryptionIv;
          encryptionAuthTag = mediaItem.encryptionAuthTag;
          mimeType = mediaItem.type === 'video' ? 'video/mp4' : 'image/jpeg';
        }
      }
    } else if (req.path.includes('/story-images/')) {
      // Story image - get from Story model
      const Story = require('../models/Story');
      const filename = path.basename(req.path);
      
      const story = await Story.findOne({
        'items.url': { $regex: filename }
      }).lean();

      if (story && story.items) {
        const item = story.items.find(i => i.url && i.url.includes(filename));
        if (item && item.encrypted) {
          encryptionIv = item.encryptionIv;
          encryptionAuthTag = item.encryptionAuthTag;
          mimeType = 'image/jpeg';
        }
      }
    } else if (req.path.includes('/profile-images/')) {
      // Profile image - get from User model
      const User = require('../models/User');
      const filename = path.basename(req.path);
      
      const user = await User.findOne({
        profileImage: { $regex: filename }
      }).lean();

      if (user && user.profileImageEncrypted) {
        encryptionIv = user.profileImageIv;
        encryptionAuthTag = user.profileImageAuthTag;
        mimeType = 'image/jpeg';
      }
    } else if (req.path.includes('/group-images/')) {
      // Group image - get from Group model
      const Group = require('../models/Group');
      const filename = path.basename(req.path);
      
      const group = await Group.findOne({
        groupImage: { $regex: filename }
      }).lean();

      if (group && group.groupImageEncrypted) {
        encryptionIv = group.groupImageIv;
        encryptionAuthTag = group.groupImageAuthTag;
        mimeType = 'image/jpeg';
      }
    }

    // If we don't have encryption metadata, file might be corrupted or legacy
    if (!encryptionIv || !encryptionAuthTag) {
      console.warn('⚠️ [MEDIA DECRYPT] No encryption metadata found for:', filePath);
      // Try to serve as-is (might fail)
      return res.sendFile(filePath);
    }

    // Decrypt and stream the file
    await mediaEncryption.decryptFileStream(
      filePath,
      encryptionIv,
      encryptionAuthTag,
      res,
      mimeType
    );

    console.log('✅ [MEDIA DECRYPT] File decrypted and served successfully');

  } catch (error) {
    console.error('❌ [MEDIA DECRYPT] Error:', error);
    // On error, try to continue to next middleware
    next();
  }
};

module.exports = decryptMediaMiddleware;
