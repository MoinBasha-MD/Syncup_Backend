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
    // Handle both /uploads/* and /api/uploads/* paths
    let requestPath = req.path;
    
    // Normalize path - remove /api prefix if present
    if (requestPath.startsWith('/api/uploads/')) {
      requestPath = requestPath.replace('/api/uploads/', '/uploads/');
    }
    
    // Only process /uploads/* paths
    if (!requestPath.startsWith('/uploads/')) {
      return next();
    }

    console.log('📁 [MEDIA DECRYPT] Request for:', req.path, '→', requestPath);

    // Get the file path
    let filePath = path.join(__dirname, '..', requestPath);
    let encryptedFilePath = filePath.endsWith('.enc') ? filePath : `${filePath}.enc`;
    let unencryptedFilePath = filePath.replace('.enc', '');
    
    // Check if encrypted version exists first
    if (fs.existsSync(encryptedFilePath)) {
      // File is encrypted - need to decrypt
      console.log('🔓 [MEDIA DECRYPT] Found encrypted file:', encryptedFilePath);
      filePath = encryptedFilePath;
    } else if (fs.existsSync(unencryptedFilePath)) {
      // Legacy unencrypted file exists
      console.log('📁 [MEDIA DECRYPT] Serving legacy unencrypted file:', unencryptedFilePath);
      return res.sendFile(unencryptedFilePath);
    } else {
      // File doesn't exist
      console.log('❌ [MEDIA DECRYPT] File not found:', req.path);
      return next(); // Let 404 handler deal with it
    }

    // At this point, we have an encrypted file to decrypt
    const mediaEncryption = getMediaEncryption();

    // Get encryption metadata from database based on file type
    let encryptionIv, encryptionAuthTag, mimeType;

    // Determine file type from path
    // Strip .enc extension for database lookup (URLs in DB don't have .enc)
    const requestedFilename = path.basename(requestPath).replace('.enc', '');
    
    if (requestPath.includes('/post-media/')) {
      // Post media - get from FeedPost model
      const FeedPost = require('../models/FeedPost');
      
      const post = await FeedPost.findOne({
        'media.url': { $regex: requestedFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
      }).lean();

      if (post && post.media) {
        const mediaItem = post.media.find(m => m.url && m.url.includes(requestedFilename));
        if (mediaItem && mediaItem.encrypted) {
          encryptionIv = mediaItem.encryptionIv;
          encryptionAuthTag = mediaItem.encryptionAuthTag;
          mimeType = mediaItem.type === 'video' ? 'video/mp4' : 'image/jpeg';
          console.log('✅ [MEDIA DECRYPT] Found encryption metadata for post media');
        }
      }
    } else if (requestPath.includes('/story-images/')) {
      // Story image - get from Story model
      const Story = require('../models/storyModel');
      
      const story = await Story.findOne({
        'items.url': { $regex: requestedFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
      }).lean();

      if (story && story.items) {
        const item = story.items.find(i => i.url && i.url.includes(requestedFilename));
        if (item && item.encryptionIv) {
          encryptionIv = item.encryptionIv;
          encryptionAuthTag = item.encryptionAuthTag;
          mimeType = 'image/jpeg';
          console.log('✅ [MEDIA DECRYPT] Found encryption metadata for story');
        }
      }
    } else if (requestPath.includes('/profile-images/')) {
      // Profile image - get from User model
      const User = require('../models/userModel');
      
      const user = await User.findOne({
        profileImage: { $regex: requestedFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
      }).lean();

      if (user && user.profileImageEncrypted) {
        encryptionIv = user.profileImageIv;
        encryptionAuthTag = user.profileImageAuthTag;
        mimeType = 'image/jpeg';
        console.log('✅ [MEDIA DECRYPT] Found encryption metadata for profile');
      }
    } else if (requestPath.includes('/group-images/')) {
      // Group image - get from Group model
      const Group = require('../models/Group');
      
      const group = await Group.findOne({
        groupImage: { $regex: requestedFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
      }).lean();

      if (group && group.groupImageEncrypted) {
        encryptionIv = group.groupImageIv;
        encryptionAuthTag = group.groupImageAuthTag;
        mimeType = 'image/jpeg';
        console.log('✅ [MEDIA DECRYPT] Found encryption metadata for group');
      }
    }

    // If we don't have encryption metadata, check if unencrypted version exists
    if (!encryptionIv || !encryptionAuthTag) {
      console.warn('⚠️ [MEDIA DECRYPT] No encryption metadata found for:', requestedFilename);
      
      // Check if unencrypted file exists (legacy file)
      const legacyPath = path.join(__dirname, '..', requestPath.replace('.enc', ''));
      if (fs.existsSync(legacyPath)) {
        console.log('📁 [MEDIA DECRYPT] Serving legacy unencrypted file:', legacyPath);
        return res.sendFile(legacyPath);
      }
      
      // File not found
      console.error('❌ [MEDIA DECRYPT] File not found and no metadata:', requestedFilename);
      return next();
    }

    // Decrypt and stream the file
    console.log('🔓 [MEDIA DECRYPT] Decrypting with IV and authTag');
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
    console.error('❌ [MEDIA DECRYPT] Stack:', error.stack);
    // On error, try to continue to next middleware
    next();
  }
};

module.exports = decryptMediaMiddleware;
