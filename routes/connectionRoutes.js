const express = require('express');
const router = express.Router();
const {
  sendConnectionRequest,
  getIncomingRequests,
  getOutgoingRequests,
  acceptConnectionRequest,
  declineConnectionRequest,
  cancelConnectionRequest,
  getMutualConnections,
  getConnections,
  checkConnection,
  checkMultipleConnections,
  removeConnection,
  getConnectionsHealth
} = require('../controllers/connectionController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected (require authentication)
router.use(protect);

// @route   POST /api/connections/request
// @desc    Send connection request
// @access  Private
router.post('/request', sendConnectionRequest);

// @route   GET /api/connections/requests/incoming
// @desc    Get incoming connection requests
// @access  Private
router.get('/requests/incoming', getIncomingRequests);

// @route   GET /api/connections/requests/outgoing
// @desc    Get outgoing connection requests
// @access  Private
router.get('/requests/outgoing', getOutgoingRequests);

// @route   PUT /api/connections/request/:requestId/accept
// @desc    Accept connection request
// @access  Private
router.put('/request/:requestId/accept', acceptConnectionRequest);

// @route   PUT /api/connections/request/:requestId/decline
// @desc    Decline connection request
// @access  Private
router.put('/request/:requestId/decline', declineConnectionRequest);

// @route   DELETE /api/connections/request/:requestId
// @desc    Cancel outgoing connection request
// @access  Private
router.delete('/request/:requestId', cancelConnectionRequest);

// @route   GET /api/connections/mutual/:userId
// @desc    Get mutual connections count
// @access  Private
router.get('/mutual/:userId', getMutualConnections);

// @route   GET /api/connections
// @desc    Get user's accepted connections
// @access  Private
router.get('/', getConnections);

// @route   GET /api/connections/check/:userId
// @desc    Check if connected with specific user
// @access  Private
router.get('/check/:userId', checkConnection);

// @route   POST /api/connections/check-multiple
// @desc    Check connection status with multiple users
// @access  Private
router.post('/check-multiple', checkMultipleConnections);

// @route   DELETE /api/connections/:userId
// @desc    Remove/unfriend a connection
// @access  Private
router.delete('/:userId', removeConnection);

// @route   GET /api/connections/health
// @desc    Health check for connections API
// @access  Private
router.get('/health', getConnectionsHealth);

module.exports = router;
