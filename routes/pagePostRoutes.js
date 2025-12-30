const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createPagePost,
  getPagePosts,
  getPagePost,
  updatePagePost,
  deletePagePost,
  toggleLikePagePost,
  addCommentToPagePost,
  deleteCommentFromPagePost,
  sharePagePost
} = require('../controllers/pagePostController');

// ✅ WEEK 2 FIX: Import validation middleware
const {
  validatePagePost,
  validatePageId,
  validatePostId,
  validateComment
} = require('../middleware/validatePagePost');

// ✅ WEEK 2 FIX: Import rate limiting middleware
const {
  postCreationLimiter,
  commentLimiter,
  likeLimiter
} = require('../middleware/rateLimiter');

// ✅ Post management routes (with validation + rate limiting)
router.post('/:pageId/posts', protect, postCreationLimiter, validatePageId, validatePagePost, createPagePost);
router.get('/:pageId/posts', validatePageId, getPagePosts);
router.get('/:pageId/posts/:postId', validatePageId, validatePostId, getPagePost);
router.put('/:pageId/posts/:postId', protect, validatePageId, validatePostId, validatePagePost, updatePagePost);
router.delete('/:pageId/posts/:postId', protect, validatePageId, validatePostId, deletePagePost);

// ✅ Post engagement routes (with validation + rate limiting)
router.post('/:pageId/posts/:postId/like', protect, likeLimiter, validatePageId, validatePostId, toggleLikePagePost);
router.post('/:pageId/posts/:postId/share', protect, validatePageId, validatePostId, sharePagePost);

// ✅ Comment routes (with validation + rate limiting)
router.post('/:pageId/posts/:postId/comments', protect, commentLimiter, validatePageId, validatePostId, validateComment, addCommentToPagePost);
router.delete('/:pageId/posts/:postId/comments/:commentId', protect, validatePageId, validatePostId, deleteCommentFromPagePost);

module.exports = router;
