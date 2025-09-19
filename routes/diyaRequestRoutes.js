const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createAvailabilityRequest,
  respondToRequest,
  getPendingRequests,
  getRequestHistory,
  cleanupExpiredRequests
} = require('../controllers/diyaRequestController');
const { testAuth } = require('../controllers/authTestController');

// @desc    Create a new cross-user availability request
// @route   POST /api/diya/requests
// @access  Private
router.post('/requests', protect, createAvailabilityRequest);

// @desc    Respond to a cross-user availability request
// @route   PUT /api/diya/requests/:requestId/respond
// @access  Private
router.put('/requests/:requestId/respond', protect, respondToRequest);

// @desc    Get pending requests for the authenticated user
// @route   GET /api/diya/requests/pending
// @access  Private
router.get('/requests/pending', protect, getPendingRequests);

// @desc    Get request history for the authenticated user
// @route   GET /api/diya/requests/history
// @access  Private
router.get('/requests/history', protect, getRequestHistory);

// @desc    Cleanup expired requests (admin/cron job)
// @route   POST /api/diya/requests/cleanup
// @access  Private
router.post('/requests/cleanup', protect, cleanupExpiredRequests);

// @desc    Test authentication (debugging)
// @route   GET /api/diya/auth/test
// @access  Private
router.get('/auth/test', protect, testAuth);

module.exports = router;
