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

// ✅ Post management routes
router.post('/:pageId/posts', protect, createPagePost);
router.get('/:pageId/posts', getPagePosts);
router.get('/:pageId/posts/:postId', getPagePost);
router.put('/:pageId/posts/:postId', protect, updatePagePost);
router.delete('/:pageId/posts/:postId', protect, deletePagePost);

// ✅ Post engagement routes
router.post('/:pageId/posts/:postId/like', protect, toggleLikePagePost);
router.post('/:pageId/posts/:postId/share', protect, sharePagePost);

// ✅ Comment routes
router.post('/:pageId/posts/:postId/comments', protect, addCommentToPagePost);
router.delete('/:pageId/posts/:postId/comments/:commentId', protect, deleteCommentFromPagePost);

module.exports = router;
