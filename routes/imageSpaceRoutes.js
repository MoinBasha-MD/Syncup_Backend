const express = require('express');
const router = express.Router();
const imageSpaceController = require('../controllers/imageSpaceController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Upload image to Image Space
router.post('/upload', imageSpaceController.uploadImage);

// Get all images for a chat
router.get('/:contactId', imageSpaceController.getImages);

// Get image count for a chat (for badge)
router.get('/:contactId/count', imageSpaceController.getImageCount);

// Delete specific image
router.delete('/:contactId/:imageId', imageSpaceController.deleteImage);

module.exports = router;
