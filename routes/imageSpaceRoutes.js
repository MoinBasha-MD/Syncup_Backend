const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  uploadImage,
  getImages,
  deleteImage,
  getImageCount,
  getUnreadCount,
  markAsRead,
} = require('../controllers/imageSpaceController');

// All routes require authentication
router.use(protect);

// Upload image to Image Space
router.post('/upload', uploadImage);

// Get all images for a chat
router.get('/:contactId', getImages);

// Delete specific image
router.delete('/:contactId/:imageId', deleteImage);

// Get image count
router.get('/:contactId/count', getImageCount);

// Get unread count
router.get('/:contactId/unread', getUnreadCount);

// Mark as read
router.post('/:contactId/mark-read', markAsRead);

module.exports = router;
