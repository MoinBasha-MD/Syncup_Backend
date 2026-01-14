const { getInstance } = require('../utils/fileEncryption');
const fs = require('fs').promises;
const path = require('path');

/**
 * Middleware to encrypt uploaded files automatically
 * 
 * This middleware intercepts multer uploads and encrypts files before
 * they are permanently stored on disk.
 */

/**
 * Encrypt file after upload
 * Use this middleware AFTER multer middleware
 */
const encryptUploadedFile = async (req, res, next) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return next();
    }

    const fileEncryption = getInstance();
    const filePath = req.file.path;

    console.log('🔐 [UPLOAD ENCRYPTION] Encrypting uploaded file:', req.file.filename);

    // Encrypt file in place
    await fileEncryption.encryptInPlace(filePath);

    console.log('✅ [UPLOAD ENCRYPTION] File encrypted successfully');

    // Add encryption flag to request
    req.file.encrypted = true;

    next();
  } catch (error) {
    console.error('❌ [UPLOAD ENCRYPTION] Failed to encrypt file:', error);
    
    // Delete the uploaded file if encryption fails
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('❌ [UPLOAD ENCRYPTION] Failed to delete unencrypted file:', unlinkError);
      }
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to encrypt uploaded file'
    });
  }
};

/**
 * Encrypt multiple files after upload
 * Use this middleware AFTER multer middleware for multiple file uploads
 */
const encryptUploadedFiles = async (req, res, next) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return next();
    }

    const fileEncryption = getInstance();

    console.log(`🔐 [UPLOAD ENCRYPTION] Encrypting ${req.files.length} uploaded files`);

    // Encrypt all files
    for (const file of req.files) {
      try {
        await fileEncryption.encryptInPlace(file.path);
        file.encrypted = true;
        console.log('✅ [UPLOAD ENCRYPTION] Encrypted:', file.filename);
      } catch (error) {
        console.error('❌ [UPLOAD ENCRYPTION] Failed to encrypt:', file.filename, error);
        
        // Delete the file if encryption fails
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('❌ [UPLOAD ENCRYPTION] Failed to delete unencrypted file:', unlinkError);
        }
        
        throw error;
      }
    }

    console.log('✅ [UPLOAD ENCRYPTION] All files encrypted successfully');

    next();
  } catch (error) {
    console.error('❌ [UPLOAD ENCRYPTION] Failed to encrypt files:', error);
    
    // Delete all uploaded files if any encryption fails
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to encrypt uploaded files'
    });
  }
};

/**
 * Decrypt file before sending to client
 * Use this middleware in routes that serve files
 */
const decryptFileMiddleware = async (req, res, next) => {
  try {
    const fileEncryption = getInstance();
    
    // Store original res.sendFile
    const originalSendFile = res.sendFile.bind(res);
    
    // Override res.sendFile to decrypt before sending
    res.sendFile = async function(filePath, options, callback) {
      try {
        console.log('🔓 [FILE DECRYPTION] Decrypting file for download:', path.basename(filePath));
        
        // Decrypt file to temp location
        const tempPath = `${filePath}.decrypted`;
        await fileEncryption.decryptFile(filePath, tempPath);
        
        // Send decrypted file
        originalSendFile(tempPath, options, async (err) => {
          // Delete temp file after sending
          try {
            await fs.unlink(tempPath);
          } catch (cleanupError) {
            console.error('❌ [FILE DECRYPTION] Failed to cleanup temp file:', cleanupError);
          }
          
          if (callback) {
            callback(err);
          }
        });
      } catch (error) {
        console.error('❌ [FILE DECRYPTION] Failed to decrypt file:', error);
        if (callback) {
          callback(error);
        } else {
          res.status(500).json({
            success: false,
            message: 'Failed to decrypt file'
          });
        }
      }
    };
    
    next();
  } catch (error) {
    console.error('❌ [FILE DECRYPTION] Middleware error:', error);
    next(error);
  }
};

/**
 * Serve encrypted file (decrypt on-the-fly)
 * This is a route handler, not middleware
 */
const serveEncryptedFile = async (filePath, res) => {
  try {
    console.log('🔓 [FILE SERVE] Serving file:', path.basename(filePath));
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.log('❌ [FILE SERVE] File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    // Detect content type from file extension
    const ext = path.extname(filePath).toLowerCase().replace('.enc', '');
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    // Determine which encryption method to use based on file path
    const isPostMedia = filePath.includes('/post-media/');
    const isStoryImage = filePath.includes('/story-images/');
    const isProfileImage = filePath.includes('/profile-images/');
    const isGroupImage = filePath.includes('/group-images/');
    
    // Post media, stories, and profiles use mediaFileEncryption
    const useMediaEncryption = isPostMedia || isStoryImage || isProfileImage || isGroupImage;
    
    if (useMediaEncryption) {
      console.log('🔓 [FILE SERVE] Using media encryption for:', path.basename(filePath));
      
      // Use media file encryption (server-side encryption)
      const { getInstance: getMediaEncryption } = require('../utils/mediaFileEncryption');
      const mediaEncryption = getMediaEncryption();
      
      // Get encryption metadata from database
      const FeedPost = require('../models/FeedPost');
      const Story = require('../models/storyModel');
      const User = require('../models/userModel');
      const Group = require('../models/groupModel');
      
      const filename = path.basename(filePath).replace('.enc', '');
      let encryptionIv, encryptionAuthTag;
      
      // Query database for encryption metadata
      if (isPostMedia) {
        const post = await FeedPost.findOne({
          'media.url': { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
        }).lean();
        
        if (post && post.media) {
          const mediaItem = post.media.find(m => m.url && m.url.includes(filename));
          if (mediaItem && mediaItem.encrypted) {
            encryptionIv = mediaItem.encryptionIv;
            encryptionAuthTag = mediaItem.encryptionAuthTag;
          }
        }
      } else if (isStoryImage) {
        const story = await Story.findOne({
          'items.url': { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
        }).lean();
        
        if (story && story.items) {
          const item = story.items.find(i => i.url && i.url.includes(filename));
          if (item && item.encryptionIv) {
            encryptionIv = item.encryptionIv;
            encryptionAuthTag = item.encryptionAuthTag;
          }
        }
      } else if (isProfileImage) {
        const user = await User.findOne({
          profileImage: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
        }).lean();
        
        if (user && user.profileImageEncrypted) {
          encryptionIv = user.profileImageIv;
          encryptionAuthTag = user.profileImageAuthTag;
        }
      } else if (isGroupImage) {
        const group = await Group.findOne({
          groupImage: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
        }).lean();
        
        if (group && group.groupImageEncrypted) {
          encryptionIv = group.groupImageIv;
          encryptionAuthTag = group.groupImageAuthTag;
        }
      }
      
      if (encryptionIv && encryptionAuthTag) {
        console.log('✅ [FILE SERVE] Found encryption metadata, decrypting...');
        
        // Decrypt and stream using media encryption
        await mediaEncryption.decryptFileStream(
          filePath,
          encryptionIv,
          encryptionAuthTag,
          res,
          contentType
        );
        
        console.log('✅ [FILE SERVE] Media encrypted file decrypted and served');
        return;
      } else {
        console.log('⚠️ [FILE SERVE] No encryption metadata found, serving as unencrypted');
        const fileBuffer = await fs.readFile(filePath);
        res.set('Content-Type', contentType);
        res.send(fileBuffer);
        console.log('✅ [FILE SERVE] Unencrypted file served');
        return;
      }
    }
    
    // Chat files use E2EE encryption
    console.log('🔓 [FILE SERVE] Using E2EE encryption for:', path.basename(filePath));
    const fileEncryption = getInstance();
    
    try {
      console.log('🔓 [FILE SERVE] Attempting E2EE decryption');
      const decryptedBuffer = await fileEncryption.decryptFile(filePath);
      
      // Send decrypted file
      res.set('Content-Type', contentType);
      res.send(decryptedBuffer);
      console.log('✅ [FILE SERVE] E2EE encrypted file decrypted and served');
    } catch (decryptError) {
      // If decryption fails, file might be unencrypted (legacy)
      console.log('📁 [FILE SERVE] E2EE decryption failed, serving as unencrypted file');
      
      // Read and serve unencrypted file
      const fileBuffer = await fs.readFile(filePath);
      res.set('Content-Type', contentType);
      res.send(fileBuffer);
      console.log('✅ [FILE SERVE] Unencrypted file served');
    }
  } catch (error) {
    console.error('❌ [FILE SERVE] Failed to serve file:', error);
    console.error('❌ [FILE SERVE] Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to serve file'
    });
  }
};

module.exports = {
  encryptUploadedFile,
  encryptUploadedFiles,
  decryptFileMiddleware,
  serveEncryptedFile
};
