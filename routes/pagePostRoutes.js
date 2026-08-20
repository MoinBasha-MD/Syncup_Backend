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
  getPagePostComments,
  addReplyToPagePost,
  togglePagePostCommentLike,
  togglePagePostReplyLike,
  deletePagePostReply,
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
router.get('/:pageId/posts', protect, validatePageId, getPagePosts);
router.get('/:pageId/posts/:postId', protect, validatePageId, validatePostId, getPagePost);
router.put('/:pageId/posts/:postId', protect, validatePageId, validatePostId, validatePagePost, updatePagePost);
router.delete('/:pageId/posts/:postId', protect, validatePageId, validatePostId, deletePagePost);

// ✅ Post engagement routes (with validation + rate limiting)
router.post('/:pageId/posts/:postId/like', protect, likeLimiter, validatePageId, validatePostId, toggleLikePagePost);
router.post('/:pageId/posts/:postId/share', protect, validatePageId, validatePostId, sharePagePost);

// ✅ Comment routes (with validation + rate limiting)
router.get('/:pageId/posts/:postId/comments', protect, validatePageId, validatePostId, getPagePostComments);
router.post('/:pageId/posts/:postId/comments', protect, commentLimiter, validatePageId, validatePostId, validateComment, addCommentToPagePost);
router.post('/:pageId/posts/:postId/comments/:commentId/like', protect, likeLimiter, validatePageId, validatePostId, togglePagePostCommentLike);
router.post('/:pageId/posts/:postId/comments/:commentId/reply', protect, commentLimiter, validatePageId, validatePostId, addReplyToPagePost);
router.post('/:pageId/posts/:postId/comments/:commentId/replies/:replyId/like', protect, likeLimiter, validatePageId, validatePostId, togglePagePostReplyLike);
router.delete('/:pageId/posts/:postId/comments/:commentId/replies/:replyId', protect, validatePageId, validatePostId, deletePagePostReply);
router.delete('/:pageId/posts/:postId/comments/:commentId', protect, validatePageId, validatePostId, deleteCommentFromPagePost);

module.exports = router;
