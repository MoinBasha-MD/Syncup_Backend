const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const locationSharingController = require('../controllers/locationSharingController');

/**
 * @route   GET /api/location-sharing/settings
 * @desc    Get user's location sharing settings
 * @access  Private
 */
router.get('/settings', protect, locationSharingController.getSettings);

/**
 * @route   PUT /api/location-sharing/mode
 * @desc    Update sharing mode (all_friends, selected_friends, off)
 * @access  Private
 */
router.put('/mode', protect, locationSharingController.updateSharingMode);

/**
 * @route   POST /api/location-sharing/start
 * @desc    Start sharing session with a friend (WhatsApp-style)
 * @access  Private
 */
router.post('/start', protect, locationSharingController.startSession);

/**
 * @route   POST /api/location-sharing/stop
 * @desc    Stop sharing session with a friend
 * @access  Private
 */
router.post('/stop', protect, locationSharingController.stopSession);

/**
 * @route   GET /api/location-sharing/active
 * @desc    Get all active sharing sessions
 * @access  Private
 */
router.get('/active', protect, locationSharingController.getActiveSessions);

/**
 * @route   GET /api/location-sharing/status/:friendId
 * @desc    Check if sharing with a specific friend
 * @access  Private
 */
router.get('/status/:friendId', protect, locationSharingController.checkSharingStatus);

/**
 * @route   GET /api/location-sharing/received
 * @desc    Get live locations shared with the current user
 * @access  Private
 */
router.get('/received', protect, locationSharingController.getReceivedShares);

/**
 * @route   PUT /api/location-sharing/preferences
 * @desc    Update sharing preferences
 * @access  Private
 */
router.put('/preferences', protect, locationSharingController.updatePreferences);

module.exports = router;
