const express = require('express');
const router = express.Router();
const { uploadProfileImage, uploadStoryImage, uploadChatImage, uploadChatFile, profileUploadMiddleware, storyUploadMiddleware, chatUploadMiddleware, chatFileUploadMiddleware } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

// Route for uploading profile image
router.post('/profile-image', protect, profileUploadMiddleware, uploadProfileImage);

// Route for uploading story image
router.post('/story-image', protect, storyUploadMiddleware, uploadStoryImage);

// Route for uploading chat image
router.post('/chat-image', protect, chatUploadMiddleware, uploadChatImage);

// Route for uploading chat files (documents, audio, video, etc.)
router.post('/chat-file', protect, chatFileUploadMiddleware, uploadChatFile);

module.exports = router;
