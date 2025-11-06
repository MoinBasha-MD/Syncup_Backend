const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createPost: createStatusPost,
  getUserPost,
  getContactsPosts,
  deletePost: deleteStatusPost,
  cleanupExpiredPosts
} = require('../controllers/postController');

const {
  createPost: createFeedPost,
  getFeedPosts,
  getPostById,
  updatePost,
  deletePost: deleteFeedPost,
  repostPost,
  toggleLike,
  toggleBookmark,
  getSavedPosts,
  getUserPosts,
  getLikedPosts,
  getCommentedPosts,
  getPostViewStats,
  getPagePosts
} = require('../controllers/feedPostController');

const {
  createComment,
  getComments,
  updateComment,
  deleteComment,
  toggleCommentLike,
  addReply,
  toggleReplyLike,
  deleteReply
} = require('../controllers/commentController');

// ===== OLD POST ROUTES (Simple status posts) =====
// @route   POST /api/posts/status
// @desc    Create a new status post
// @access  Private
router.post('/status', protect, createStatusPost);

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
router.delete('/status/:postId', protect, deleteStatusPost);

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

// @route   GET /api/posts/saved
// @desc    Get user's saved/bookmarked posts
// @access  Private
router.get('/saved', protect, getSavedPosts);

// @route   GET /api/posts/liked
// @desc    Get posts user has liked
// @access  Private
router.get('/liked', protect, getLikedPosts);

// @route   GET /api/posts/commented
// @desc    Get posts user has commented on
// @access  Private
router.get('/commented', protect, getCommentedPosts);

// @route   GET /api/posts/views/stats
// @desc    Get view statistics for user's posts
// @access  Private
router.get('/views/stats', protect, getPostViewStats);

// @route   GET /api/posts/user/:userId
// @desc    Get user's feed posts
// @access  Private
router.get('/user/:userId', protect, getUserPosts);

// @route   GET /api/posts/page/:pageId
// @desc    Get page's posts (Phase 2)
// @access  Private
router.get('/page/:pageId', protect, getPagePosts);

// @route   GET /api/posts/:postId
// @desc    Get single post
// @access  Private
router.get('/:postId', protect, getPostById);

// @route   PUT /api/posts/:postId
// @desc    Update/Edit feed post
// @access  Private
router.put('/:postId', protect, updatePost);

// @route   DELETE /api/posts/:postId
// @desc    Delete feed post
// @access  Private
router.delete('/:postId', protect, deleteFeedPost);

// @route   POST /api/posts/:postId/repost
// @desc    Repost a feed post
// @access  Private
router.post('/:postId/repost', protect, repostPost);

// @route   POST /api/posts/:postId/like
// @desc    Toggle like on post
// @access  Private
router.post('/:postId/like', protect, toggleLike);

// @route   POST /api/posts/:postId/bookmark
// @desc    Toggle bookmark on post
// @access  Private
router.post('/:postId/bookmark', protect, toggleBookmark);

// ===== COMMENT ROUTES =====
// @route   POST /api/posts/:postId/comments
// @desc    Create a comment on a post
// @access  Private
router.post('/:postId/comments', protect, createComment);

// @route   GET /api/posts/:postId/comments
// @desc    Get comments for a post
// @access  Private
router.get('/:postId/comments', protect, getComments);

// @route   PUT /api/comments/:commentId
// @desc    Update/Edit comment
// @access  Private
router.put('/comments/:commentId', protect, updateComment);

// @route   DELETE /api/comments/:commentId
// @desc    Delete comment
// @access  Private
router.delete('/comments/:commentId', protect, deleteComment);

// @route   POST /api/comments/:commentId/like
// @desc    Toggle like on comment
// @access  Private
router.post('/comments/:commentId/like', protect, toggleCommentLike);

// @route   POST /api/comments/:commentId/reply
// @desc    Add reply to comment
// @access  Private
router.post('/comments/:commentId/reply', protect, addReply);

// @route   POST /api/comments/:commentId/replies/:replyId/like
// @desc    Toggle like on reply
// @access  Private
router.post('/comments/:commentId/replies/:replyId/like', protect, toggleReplyLike);

// @route   DELETE /api/comments/:commentId/replies/:replyId
// @desc    Delete reply
// @access  Private
router.delete('/comments/:commentId/replies/:replyId', protect, deleteReply);

module.exports = router;
