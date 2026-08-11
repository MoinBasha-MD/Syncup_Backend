const express = require('express');
const router = express.Router();
const blinkController = require('../controllers/blinkController');
const { protect } = require('../middleware/authMiddleware');

// Apply auth middleware to all blink routes
router.use(protect);

// POST /api/blinks - Create a new blink
router.post('/', blinkController.createBlink);

// GET /api/blinks/contacts - Get active blinks from user's contacts
router.get('/contacts', blinkController.getContactsBlinks);

// POST /api/blinks/contacts - Get active blinks with contacts array from frontend
router.post('/contacts', blinkController.getContactsBlinks);

// POST /api/blinks/seen - Mark blink as seen
router.post('/seen', blinkController.markBlinkSeen);

// POST /api/blinks/:id/like - Toggle like on a blink
router.post('/:id/like', blinkController.toggleBlinkLike);

// DELETE /api/blinks/:id - Delete a blink
router.delete('/:id', blinkController.deleteBlink);

// POST /api/blinks/:id/capture - Report a screenshot or screen recording
router.post('/:id/capture', blinkController.reportBlinkCapture);

// Cleanup is handled automatically by the Mongo TTL index.
// Exposing this endpoint to all authenticated users is a DoS/storage-leak risk.
// router.post('/cleanup', blinkController.cleanupBlinks);

module.exports = router;
