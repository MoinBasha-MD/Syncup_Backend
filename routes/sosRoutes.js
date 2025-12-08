const express = require('express');
const router = express.Router();
const sosController = require('../controllers/sosController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Send SOS alert
router.post('/alert', sosController.sendSOSAlert);

// Send location update
router.post('/location-update', sosController.sendLocationUpdate);

// Stop SOS
router.post('/stop', sosController.stopSOS);

// Get SOS history
router.get('/history', sosController.getSOSHistory);

module.exports = router;
