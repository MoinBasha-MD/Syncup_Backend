const express = require('express');
const router = express.Router();
const {
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlockStatus,
  checkMultipleBlockStatus,
  getBlocksHealth
} = require('../controllers/blockController');
const { protect } = require('../middleware/authMiddleware');

// All routes are protected (require authentication)
router.use(protect);

// @route   POST /api/blocks
// @desc    Block a user
// @access  Private
router.post('/', blockUser);

// @route   DELETE /api/blocks/:userId
// @desc    Unblock a user
// @access  Private
router.delete('/:userId', unblockUser);

// @route   GET /api/blocks
// @desc    Get list of blocked users
// @access  Private
router.get('/', getBlockedUsers);

// @route   GET /api/blocks/check/:userId
// @desc    Check if a user is blocked
// @access  Private
router.get('/check/:userId', checkBlockStatus);

// @route   POST /api/blocks/check-multiple
// @desc    Check multiple users' block status
// @access  Private
router.post('/check-multiple', checkMultipleBlockStatus);

// @route   GET /api/blocks/health
// @desc    Health check for blocks API
// @access  Private
router.get('/health', getBlocksHealth);

module.exports = router;
