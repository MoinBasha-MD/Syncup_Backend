const User = require('../models/userModel');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Configure storage for profile images
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/profile-images');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

// Configure storage for story images
const storyStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/story-images');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'story-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Configure uploads
const profileUpload = multer({ 
  storage: profileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: fileFilter
});

const storyUpload = multer({ 
  storage: storyStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size for stories
  },
  fileFilter: fileFilter
});

// Configure storage for chat images
const chatStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/chat-images');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'chat-' + uniqueSuffix + ext);
  }
});

const chatUpload = multer({ 
  storage: chatStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max file size for chat images
  },
  fileFilter: fileFilter
});

// Configure storage for post media (photos and videos)
const postMediaStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/post-media');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const prefix = file.mimetype.startsWith('video/') ? 'video' : 'photo';
    cb(null, `post-${prefix}-${uniqueSuffix}${ext}`);
  }
});

// Allowed post media MIME types (front-end sends image/jpeg for photos and video/mp4 for videos)
const ALLOWED_POST_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];

// File filter for post media (images and videos)
const postMediaFilter = (req, file, cb) => {
  if (ALLOWED_POST_MEDIA_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed for posts`), false);
  }
};

const postMediaUpload = multer({ 
  storage: postMediaStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size for post media
  },
  fileFilter: postMediaFilter
});

// Configure storage for chat files (documents, etc.)
const chatFileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/chat-files');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    cb(null, 'file-' + uniqueSuffix + '-' + baseName + ext);
  }
});

// File filter for general files
const generalFileFilter = (req, file, cb) => {
  // Allow common file types
  const allowedTypes = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/x-m4a',
    // Video
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    // Images (for completeness)
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed!`), false);
  }
};

const chatFileUpload = multer({ 
  storage: chatFileStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size for general files
  },
  fileFilter: generalFileFilter
});

// Upload profile image
const uploadProfileImage = async (req, res) => {
  try {
    console.log('Upload controller - Request received');
    console.log('Upload controller - Authenticated user:', req.user?._id);
    console.log('Upload controller - Request body:', req.body);
    console.log('Upload controller - File:', req.file ? 'File uploaded' : 'No file');
    
    // req.file is the 'profileImage' file
    // req.body will hold the text fields, if there were any
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    // Get userid from request body
    const { userid } = req.body;
    console.log('Upload controller - User ID from body:', userid);
    
    if (!userid) {
      // Delete the uploaded file if no user ID provided
      fs.unlinkSync(req.file.path);
      console.error('Upload controller - No userid provided in request body');
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Verify the authenticated user matches the requested user ID
    // This ensures users can only upload profile pictures for themselves
    if (req.user && req.user.userId && req.user.userId.toString() !== userid.toString()) {
      console.error(`Upload controller - User ID mismatch: ${req.user.userId} vs ${userid}`);
      fs.unlinkSync(req.file.path);
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload for this user'
      });
    }

    // Find user by UUID (userId field)
    console.log('Upload controller - Finding user with userId:', userid);
    const user = await User.findOne({ userId: userid });

    if (!user) {
      // Delete the uploaded file if user not found
      fs.unlinkSync(req.file.path);
      console.error('Upload controller - User not found with ID:', userid);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('Upload controller - User found:', user._id);

    // If user already has a profile image, delete the old one
    if (user.profileImage && user.profileImage.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, '..', user.profileImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // 🔐 ENCRYPTION DISABLED - Serve files directly for better performance
    // const { getInstance: getMediaEncryption } = require('../utils/mediaFileEncryption');
    // const mediaEncryption = getMediaEncryption();
    // const encryptionResult = await mediaEncryption.encryptFile(req.file.path);
    
    const filename = req.file.filename;
    const imageUrl = `/uploads/profile-images/${filename}`;
    
    console.log('Upload controller - Profile image saved (encryption disabled)');
    
    // Update user profile with new image URL
    user.profileImage = imageUrl;
    user.profileImageEncrypted = false;
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        profileImage: imageUrl,
        encrypted: false
      },
      message: 'Profile image uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading profile image:', error);
    // If there was an error and a file was uploaded, delete it
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading profile image',
      error: error.message
    });
  }
};

// Upload story image
const uploadStoryImage = async (req, res) => {
  try {
    console.log('📸 Story upload controller - Request received');
    console.log('📸 Story upload - Headers:', req.headers);
    console.log('📸 Story upload - Body:', req.body);
    console.log('📸 Story upload - Authenticated user:', req.user?.userId);
    console.log('📸 Story upload - File:', req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    } : 'No file');
    
    if (!req.file) {
      console.error('📸 Story upload - No file in request');
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    // Get userid from request body
    const { userid } = req.body;
    console.log('📸 Story upload - User ID from body:', userid);
    
    if (!userid) {
      // Delete the uploaded file if no user ID provided
      console.error('📸 Story upload - No userid provided, deleting file:', req.file.path);
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Verify the authenticated user matches the requested user ID
    if (req.user && req.user.userId && req.user.userId.toString() !== userid.toString()) {
      console.error(`📸 Story upload - User ID mismatch: ${req.user.userId} vs ${userid}`);
      fs.unlinkSync(req.file.path);
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload for this user'
      });
    }

    // Find user by UUID (userId field)
    console.log('📸 Story upload - Finding user with userId:', userid);
    const user = await User.findOne({ userId: userid });

    if (!user) {
      // Delete the uploaded file if user not found
      console.error('📸 Story upload - User not found, deleting file:', req.file.path);
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('📸 Story upload - User found:', user._id);
    console.log('📸 Story upload - File saved to:', req.file.path);
    console.log('📸 Story upload - File exists:', fs.existsSync(req.file.path));

    // 🔐 ENCRYPTION DISABLED - Serve files directly for better performance
    // const { getInstance: getMediaEncryption } = require('../utils/mediaFileEncryption');
    // const mediaEncryption = getMediaEncryption();
    // const encryptionResult = await mediaEncryption.encryptFile(req.file.path);
    
    const filename = req.file.filename;
    const imageUrl = `/uploads/story-images/${filename}`;
    
    console.log('📸 Story upload - Image saved (encryption disabled)');
    console.log('📸 Story upload - URL:', imageUrl);

    res.status(200).json({
      success: true,
      data: {
        imageUrl: imageUrl,
        fileName: filename,
        filePath: req.file.path,
        fileSize: req.file.size,
        encrypted: false
      },
      message: 'Story image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ Error uploading story image:', error);
    // If there was an error and a file was uploaded, delete it
    if (req.file && fs.existsSync(req.file.path)) {
      console.log('📸 Cleaning up file due to error:', req.file.path);
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading story image',
      error: error.message
    });
  }
};

// Upload chat image
const uploadChatImage = async (req, res) => {
  try {
    console.log('💬 Chat image upload - Request received');
    console.log('💬 Chat image upload - Authenticated user:', req.user?.userId);
    console.log('💬 Chat image upload - File:', req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file');
    
    if (!req.file) {
      console.error('💬 Chat image upload - No file in request');
      return res.status(400).json({
        success: false,
        message: 'Please upload an image file'
      });
    }

    // Get receiverId from request body (who will receive this image)
    const { receiverId } = req.body;
    console.log('💬 Chat image upload - Receiver ID:', receiverId);
    
    if (!receiverId) {
      // Delete the uploaded file if no receiver ID provided
      console.error('💬 Chat image upload - No receiverId provided, deleting file');
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Receiver ID is required'
      });
    }

    // Verify receiver exists
    const User = require('../models/userModel');
    const receiver = await User.findOne({ userId: receiverId });
    if (!receiver) {
      console.error('💬 Chat image upload - Receiver not found, deleting file');
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Return the chat image URL
    const imageUrl = `/uploads/chat-images/${req.file.filename}`;
    
    console.log('💬 Chat image upload - Image URL:', imageUrl);
    console.log('💬 Chat image upload - File saved successfully');

    res.status(200).json({
      success: true,
      data: {
        imageUrl: imageUrl,
        fileName: req.file.filename,
        fileSize: req.file.size,
        senderId: req.user.userId,
        receiverId: receiverId
      },
      message: 'Chat image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ Error uploading chat image:', error);
    // If there was an error and a file was uploaded, delete it
    if (req.file && fs.existsSync(req.file.path)) {
      console.log('💬 Cleaning up file due to error:', req.file.path);
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading chat image',
      error: error.message
    });
  }
};

// Upload chat file (documents, audio, video, etc.)
const uploadChatFile = async (req, res) => {
  try {
    console.log('📁 Chat file upload - Request received');
    console.log('📁 Chat file upload - Authenticated user:', req.user?.userId);
    console.log('📁 Chat file upload - File:', req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file');
    
    if (!req.file) {
      console.error('📁 Chat file upload - No file in request');
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    // Validate user authentication
    if (!req.user || !req.user.userId) {
      console.error('📁 Chat file upload - User not authenticated');
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get file info
    const relativePath = `/uploads/chat-files/${req.file.filename}`;
    
    // Construct full URL for client access
    const protocol = req.protocol; // http or https
    const host = req.get('host'); // includes port if present
    const fullUrl = `${protocol}://${host}${relativePath}`;
    
    const fileSize = req.file.size;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;
    
    console.log('📁 Chat file upload - Relative path:', relativePath);
    console.log('📁 Chat file upload - Full URL:', fullUrl);
    console.log('📁 Chat file upload - File saved successfully');

    // Return file information with full URL
    res.status(200).json({
      success: true,
      data: {
        fileUrl: fullUrl, // ✅ Return full URL instead of relative path
        fileName: originalName,
        fileSize: fileSize,
        mimeType: mimeType,
        uploadedBy: req.user.userId
      },
      message: 'Chat file uploaded successfully'
    });
  } catch (error) {
    console.error('❌ Error uploading chat file:', error);
    // If there was an error and a file was uploaded, delete it
    if (req.file && fs.existsSync(req.file.path)) {
      console.log('📁 Cleaning up file due to error:', req.file.path);
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading chat file',
      error: error.message
    });
  }
};

// Upload post media (photo or video)
const uploadPostMedia = async (req, res) => {
  try {
    console.log('📸 Post media upload - Request received');
    console.log('📸 Post media upload - Authenticated user:', req.user?.userId);
    console.log('📸 Post media upload - File:', req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file');
    
    if (!req.file) {
      console.error('📸 Post media upload - No file in request');
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    // Validate user authentication
    if (!req.user || !req.user.userId) {
      console.error('📸 Post media upload - User not authenticated');
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // 🔐 ENCRYPTION DISABLED - Serve files directly for better performance
    // const { getInstance: getMediaEncryption } = require('../utils/mediaFileEncryption');
    // const mediaEncryption = getMediaEncryption();
    // const encryptionResult = await mediaEncryption.encryptFile(req.file.path);
    
    // Determine if it's a photo or video
    const isVideo = req.file.mimetype.startsWith('video/');
    const filename = req.file.filename;
    const mediaUrl = `/uploads/post-media/${filename}`;
    
    console.log(`📸 Post media upload - ${isVideo ? 'Video' : 'Photo'} saved (encryption disabled)`);
    console.log('📸 Post media upload - URL:', mediaUrl);

    // Return the media URL without encryption
    res.status(200).json({
      success: true,
      data: {
        [isVideo ? 'videoUrl' : 'imageUrl']: mediaUrl,
        fileName: filename,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user.userId,
        encrypted: false
      },
      message: `Post ${isVideo ? 'video' : 'photo'} uploaded successfully`
    });
  } catch (error) {
    console.error('❌ Error uploading post media:', error);
    // If there was an error and a file was uploaded, delete it
    if (req.file && fs.existsSync(req.file.path)) {
      console.log('📸 Cleaning up file due to error:', req.file.path);
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error deleting post media file:', err);
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading post media',
      error: error.message
    });
  }
};

// ✅ Upload page profile image
const uploadPageProfileImage = async (req, res) => {
  try {
    console.log('📄 [PAGE UPLOAD] Profile image upload request received');
    console.log('📄 [PAGE UPLOAD] Authenticated user:', req.user?._id);
    console.log('📄 [PAGE UPLOAD] Request body:', req.body);
    console.log('📄 [PAGE UPLOAD] File:', req.file ? 'File uploaded' : 'No file');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    const { pageid } = req.body;
    console.log('📄 [PAGE UPLOAD] Page ID from body:', pageid);
    
    if (!pageid) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] No pageid provided in request body');
      return res.status(400).json({
        success: false,
        message: 'Page ID is required'
      });
    }

    // Import Page model
    const Page = require('../models/Page');
    
    // Find page by ID
    console.log('📄 [PAGE UPLOAD] Finding page with ID:', pageid);
    const page = await Page.findById(pageid);

    if (!page) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] Page not found with ID:', pageid);
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }
    
    console.log('📄 [PAGE UPLOAD] Page found:', page.name);

    // Check if user has permission to edit
    if (!page.isOwner(req.user._id) && !page.canEdit(req.user._id)) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] User does not have permission to edit page');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this page'
      });
    }

    // If page already has a profile image, delete the old one
    if (page.profileImage && page.profileImage.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, '..', page.profileImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
        console.log('📄 [PAGE UPLOAD] Deleted old profile image');
      }
    }

    // Update page profile with new image URL
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    page.profileImage = imageUrl;
    await page.save();

    console.log('✅ [PAGE UPLOAD] Page profile image updated successfully:', imageUrl);

    res.status(200).json({
      success: true,
      data: {
        profileImage: imageUrl
      },
      message: 'Page profile image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ [PAGE UPLOAD] Error uploading page profile image:', error);
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading page profile image',
      error: error.message
    });
  }
};

// ✅ Upload page cover image
const uploadPageCoverImage = async (req, res) => {
  try {
    console.log('📄 [PAGE UPLOAD] Cover image upload request received');
    console.log('📄 [PAGE UPLOAD] Authenticated user:', req.user?._id);
    console.log('📄 [PAGE UPLOAD] Request body:', req.body);
    console.log('📄 [PAGE UPLOAD] File:', req.file ? 'File uploaded' : 'No file');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    const { pageid } = req.body;
    console.log('📄 [PAGE UPLOAD] Page ID from body:', pageid);
    
    if (!pageid) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] No pageid provided in request body');
      return res.status(400).json({
        success: false,
        message: 'Page ID is required'
      });
    }

    // Import Page model
    const Page = require('../models/Page');
    
    // Find page by ID
    console.log('📄 [PAGE UPLOAD] Finding page with ID:', pageid);
    const page = await Page.findById(pageid);

    if (!page) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] Page not found with ID:', pageid);
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }
    
    console.log('📄 [PAGE UPLOAD] Page found:', page.name);

    // Check if user has permission to edit
    if (!page.isOwner(req.user._id) && !page.canEdit(req.user._id)) {
      fs.unlinkSync(req.file.path);
      console.error('📄 [PAGE UPLOAD] User does not have permission to edit page');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this page'
      });
    }

    // If page already has a cover image, delete the old one
    if (page.coverImage && page.coverImage.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, '..', page.coverImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
        console.log('📄 [PAGE UPLOAD] Deleted old cover image');
      }
    }

    // Update page cover with new image URL
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    page.coverImage = imageUrl;
    await page.save();

    console.log('✅ [PAGE UPLOAD] Page cover image updated successfully:', imageUrl);

    res.status(200).json({
      success: true,
      data: {
        coverImage: imageUrl
      },
      message: 'Page cover image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ [PAGE UPLOAD] Error uploading page cover image:', error);
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Error uploading page cover image',
      error: error.message
    });
  }
};

module.exports = {
  uploadProfileImage,
  uploadStoryImage,
  uploadChatImage,
  uploadChatFile,
  uploadPostMedia,
  uploadPageProfileImage,
  uploadPageCoverImage,
  profileUploadMiddleware: profileUpload.single('profileImage'),
  storyUploadMiddleware: storyUpload.single('storyImage'),
  chatUploadMiddleware: chatUpload.single('chatImage'),
  chatFileUploadMiddleware: chatFileUpload.single('file'),
  postMediaUploadMiddleware: postMediaUpload.single('media'),
  pageProfileUploadMiddleware: profileUpload.single('profileImage'),
  pageCoverUploadMiddleware: profileUpload.single('coverImage')
};
