const express = require('express');
const router = express.Router();
const hashtagController = require('../controllers/hashtagController');
const { protect } = require('../middleware/authMiddleware');

// Get trending hashtags (public)
router.get('/trending', hashtagController.getTrendingHashtags);

// Search posts by hashtag (requires auth)
router.get('/search/:tag', protect, hashtagController.searchByHashtag);

// Get related hashtags (public)
router.get('/related/:tag', hashtagController.getRelatedHashtags);

// Get hashtag statistics (public)
router.get('/stats/:tag', hashtagController.getHashtagStats);

module.exports = router;
