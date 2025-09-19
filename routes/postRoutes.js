const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createPost,
  getUserPost,
  getContactsPosts,
  deletePost,
  cleanupExpiredPosts
} = require('../controllers/postController');

// @route   POST /api/posts
// @desc    Create a new post
// @access  Private
router.post('/', protect, createPost);

// @route   GET /api/posts/my-post
// @desc    Get user's current active post
// @access  Private
router.get('/my-post', protect, getUserPost);

// @route   GET /api/posts/contacts
// @desc    Get active posts from user's contacts
// @access  Private
router.get('/contacts', protect, getContactsPosts);

// @route   DELETE /api/posts/:postId
// @desc    Delete user's post
// @access  Private
router.delete('/:postId', protect, deletePost);

// @route   POST /api/posts/cleanup
// @desc    Cleanup expired posts (for scheduled jobs)
// @access  Private
router.post('/cleanup', protect, cleanupExpiredPosts);

module.exports = router;
