const express = require('express');
const router = express.Router();
const { uploadProfileImage, uploadStoryImage, profileUploadMiddleware, storyUploadMiddleware } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

// Route for uploading profile image
router.post('/profile-image', protect, profileUploadMiddleware, uploadProfileImage);

// Route for uploading story image
router.post('/story-image', protect, storyUploadMiddleware, uploadStoryImage);

module.exports = router;
