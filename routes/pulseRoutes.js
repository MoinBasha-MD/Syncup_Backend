const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getFriends,
  getChains,
  getChainMoments,
  sendPulse
} = require('../controllers/pulseController');

// All Pulse routes require authentication
router.use(protect);

// @route   GET /api/pulse/friends
// @desc    Get friends to send pulses to
// @access  Private
router.get('/friends', getFriends);

// @route   GET /api/pulse/chains
// @desc    Get all pulse chains for current user
// @access  Private
router.get('/chains', getChains);

// @route   GET /api/pulse/chains/:chainId
// @desc    Get moments for a specific chain
// @access  Private
router.get('/chains/:chainId', getChainMoments);

// @route   POST /api/pulse
// @desc    Send a pulse to a friend
// @access  Private
router.post('/', sendPulse);

module.exports = router;
