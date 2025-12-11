const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  requestMoreAccess,
  getPendingRequests,
  approveRequest,
  denyRequest
} = require('../controllers/docSpaceAccessRequestController');

/**
 * @route   POST /api/doc-space-access-requests/request
 * @desc    Request more access to a document
 * @access  Private
 */
router.post('/request', protect, requestMoreAccess);

/**
 * @route   GET /api/doc-space-access-requests/pending
 * @desc    Get pending access requests (for document owner)
 * @access  Private
 */
router.get('/pending', protect, getPendingRequests);

/**
 * @route   POST /api/doc-space-access-requests/approve
 * @desc    Approve an access request
 * @access  Private
 */
router.post('/approve', protect, approveRequest);

/**
 * @route   POST /api/doc-space-access-requests/deny
 * @desc    Deny an access request
 * @access  Private
 */
router.post('/deny', protect, denyRequest);

module.exports = router;
