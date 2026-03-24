const fs = require('fs');
const path = require('path');

/**
 * Middleware to validate profile image existence and return fallback for missing files
 * This prevents 404 errors when database has stale image paths
 */
const validateProfileImage = (req, res, next) => {
  // Only validate profile-images requests
  if (!req.path.includes('/profile-images/')) {
    return next();
  }

  const filePath = path.join(__dirname, '..', req.path);
  
  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File doesn't exist - log and return 404 with helpful message
      console.log(`⚠️  [PROFILE IMAGE] File not found: ${req.path}`);
      console.log(`📁 [PROFILE IMAGE] Full path: ${filePath}`);
      
      return res.status(404).json({
        success: false,
        message: 'Profile image not found',
        path: req.path,
        suggestion: 'This image may have been deleted. Please re-upload your profile picture.'
      });
    }
    
    // File exists, continue to static file serving
    next();
  });
};

module.exports = { validateProfileImage };
