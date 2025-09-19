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

    // Update user profile with new image URL
    // Store the path relative to the server root
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    user.profileImage = imageUrl;
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        profileImage: imageUrl
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

    // Return the story image URL
    const imageUrl = `/uploads/story-images/${req.file.filename}`;
    
    console.log('📸 Story upload - Image URL:', imageUrl);
    console.log('📸 Story upload - Full file path:', path.join(__dirname, '..', imageUrl));

    res.status(200).json({
      success: true,
      data: {
        imageUrl: imageUrl,
        fileName: req.file.filename,
        filePath: req.file.path,
        fileSize: req.file.size
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

module.exports = {
  uploadProfileImage,
  uploadStoryImage,
  profileUploadMiddleware: profileUpload.single('profileImage'),
  storyUploadMiddleware: storyUpload.single('storyImage')
};
