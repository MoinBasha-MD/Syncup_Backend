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
    const fileEncryption = getInstance();
    
    console.log('🔓 [FILE SERVE] Decrypting and serving file:', path.basename(filePath));
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    // Decrypt file to buffer
    const decryptedBuffer = await fileEncryption.decryptFile(filePath);
    
    // Detect content type from file extension
    const ext = path.extname(filePath).toLowerCase();
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
    
    // Send decrypted file
    res.set('Content-Type', contentType);
    res.send(decryptedBuffer);
    
    console.log('✅ [FILE SERVE] File served successfully');
  } catch (error) {
    console.error('❌ [FILE SERVE] Failed to serve encrypted file:', error);
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
