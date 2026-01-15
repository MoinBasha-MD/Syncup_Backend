const express = require('express');
const router = express.Router();
const intentNotificationController = require('../controllers/intentNotificationController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Send intent notification
router.post('/send', intentNotificationController.sendIntentNotification);

// Get pending intents for current user (received)
router.get('/pending', intentNotificationController.getPendingIntents);

// Get sent intents by current user (for sender-side persistence)
router.get('/sent', intentNotificationController.getSentIntents);

// Mark all intents as read
router.post('/mark-all-read', intentNotificationController.markAllAsRead);

// Clear specific intent
router.delete('/:intentId', intentNotificationController.clearIntent);

// Check status expiry and auto-clear intents
router.post('/check-expiry', intentNotificationController.checkStatusExpiry);

module.exports = router;
