const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friendController');
const { protect } = require('../middleware/authMiddleware');

/**
 * Friend Routes - Following the same pattern as storyRoutes
 * All routes require authentication
 */

// Apply auth middleware to all friend routes
router.use(protect);

// ===== FRIEND MANAGEMENT ROUTES =====

// @route   GET /api/friends
// @desc    Get all friends for authenticated user
// @access  Private
// @query   status (accepted|pending|blocked), includeDeviceContacts, includeAppConnections, limit, skip
router.get('/', friendController.getFriends);

// @route   GET /api/friends/requests
// @desc    Get friend requests (pending friendships)
// @access  Private
// @query   type (received|sent)
router.get('/requests', friendController.getFriendRequests);

// @route   GET /api/friends/search
// @desc    Search for users to add as friends
// @access  Private
// @query   query (username, name, or phone), limit
router.get('/search', friendController.searchUsers);

// @route   GET /api/friends/mutual/:userId
// @desc    Get mutual friends with another user
// @access  Private
router.get('/mutual/:userId', friendController.getMutualFriends);

// @route   GET /api/friends/status/:targetUserId
// @desc    Check friendship status with a specific user
// @access  Private
router.get('/status/:targetUserId', friendController.checkFriendshipStatus);

// @route   POST /api/friends/add
// @desc    Send a friend request
// @access  Private
// @body    friendUserId OR username OR phoneNumber, message (optional), source (optional)
router.post('/add', friendController.sendFriendRequest);

// @route   POST /api/friends/accept/:requestId
// @desc    Accept a friend request
// @access  Private
router.post('/accept/:requestId', friendController.acceptFriendRequest);

// @route   POST /api/friends/reject/:requestId
// @desc    Reject a friend request
// @access  Private
router.post('/reject/:requestId', friendController.rejectFriendRequest);

// @route   POST /api/friends/sync-contacts
// @desc    Sync device contacts to create friendships
// @access  Private
// @body    phoneNumbers (array of phone numbers)
router.post('/sync-contacts', friendController.syncDeviceContacts);

// @route   POST /api/friends/block/:userId
// @desc    Block a user
// @access  Private
router.post('/block/:userId', friendController.blockUser);

// @route   POST /api/friends/unblock/:userId
// @desc    Unblock a user
// @access  Private
router.post('/unblock/:userId', friendController.unblockUser);

// @route   POST /api/friends/refresh-cache
// @desc    Refresh cached friend data
// @access  Private
router.post('/refresh-cache', friendController.refreshFriendCache);

// @route   PUT /api/friends/:friendUserId/settings
// @desc    Update friend-specific settings
// @access  Private
// @body    settings object (showOnlineStatus, showStories, showPosts, showLocation, muteNotifications)
router.put('/:friendUserId/settings', friendController.updateFriendSettings);

// @route   DELETE /api/friends/:friendUserId
// @desc    Remove a friend
// @access  Private
router.delete('/:friendUserId', friendController.removeFriend);

module.exports = router;
