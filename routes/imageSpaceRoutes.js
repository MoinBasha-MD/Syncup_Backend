const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  uploadImage,
  saveText,
  getImages,
  deleteImage,
  getImageCount,
  getUnreadCount,
  markAsRead,
} = require('../controllers/imageSpaceController');

// All routes require authentication
router.use(protect);

// Upload image to Your Space
router.post('/upload', uploadImage);

// Save text message to Your Space
router.post('/save-text', saveText);

// Get all items (images and text) for a chat
router.get('/:contactId', getImages);

// Delete specific item
router.delete('/:contactId/:imageId', deleteImage);

// Get item count
router.get('/:contactId/count', getImageCount);

// Get unread count
router.get('/:contactId/unread', getUnreadCount);

// Mark as read
router.post('/:contactId/mark-read', markAsRead);

module.exports = router;
