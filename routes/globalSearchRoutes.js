const express = require('express');
const router = express.Router();
const {
  searchUsers,
  checkUsernameAvailability,
  getSearchSuggestions,
  refreshSearchUsers,
  testExclusionLogic,
  debugUserConnections
} = require('../controllers/globalSearchController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected (require authentication)
router.use(protect);

// @route   POST /api/search/users
// @desc    Search for public users globally
// @access  Private
router.post('/users', searchUsers);

// @route   POST /api/search/users/refresh
// @desc    Force refresh search results without cache
// @access  Private
router.post('/users/refresh', refreshSearchUsers);

// @route   GET /api/search/username-available/:username
// @desc    Check if username is available
// @access  Private
router.get('/username-available/:username', checkUsernameAvailability);

// @route   POST /api/search/suggestions
// @desc    Get search suggestions based on partial input
// @access  Private
router.post('/suggestions', getSearchSuggestions);

// @route   GET /api/search/debug/exclusion-test
// @desc    Test exclusion logic specifically
// @access  Private
router.get('/debug/exclusion-test', testExclusionLogic);

// @route   GET /api/search/debug/connections
// @desc    Debug user connections data
// @access  Private
router.get('/debug/connections', debugUserConnections);

module.exports = router;
