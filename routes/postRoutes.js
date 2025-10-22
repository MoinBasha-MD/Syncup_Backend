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

const {
  createFeedPost,
  getFeedPosts,
  getPost,
  deletePost: deleteFeedPost,
  toggleLike,
  getUserPosts
} = require('../controllers/feedPostController');

// ===== OLD POST ROUTES (Simple status posts) =====
// @route   POST /api/posts/status
// @desc    Create a new status post
// @access  Private
router.post('/status', protect, createPost);

// @route   GET /api/posts/my-post
// @desc    Get user's current active post
// @access  Private
router.get('/my-post', protect, getUserPost);

// @route   GET /api/posts/contacts
// @desc    Get active posts from user's contacts
// @access  Private
router.get('/contacts', protect, getContactsPosts);

// @route   DELETE /api/posts/status/:postId
// @desc    Delete user's status post
// @access  Private
router.delete('/status/:postId', protect, deletePost);

// @route   POST /api/posts/cleanup
// @desc    Cleanup expired posts (for scheduled jobs)
// @access  Private
router.post('/cleanup', protect, cleanupExpiredPosts);

// ===== NEW FEED POST ROUTES (Photo/Video posts) =====
// @route   POST /api/posts/create
// @desc    Create a new feed post
// @access  Private
router.post('/create', protect, createFeedPost);

// @route   GET /api/posts/feed
// @desc    Get feed posts
// @access  Private
router.get('/feed', protect, getFeedPosts);

// @route   GET /api/posts/:postId
// @desc    Get single post
// @access  Private
router.get('/:postId', protect, getPost);

// @route   DELETE /api/posts/:postId
// @desc    Delete feed post
// @access  Private
router.delete('/:postId', protect, deleteFeedPost);

// @route   POST /api/posts/:postId/like
// @desc    Toggle like on post
// @access  Private
router.post('/:postId/like', protect, toggleLike);

// @route   GET /api/posts/user/:userId
// @desc    Get user's feed posts
// @access  Private
router.get('/user/:userId', protect, getUserPosts);

module.exports = router;
