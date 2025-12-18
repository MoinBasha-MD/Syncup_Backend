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

// Auto-complete hashtags (public)
router.get('/autocomplete', hashtagController.autocompleteHashtags);

// Follow/Unfollow hashtag (requires auth)
router.post('/:tag/follow', protect, hashtagController.followHashtag);
router.delete('/:tag/unfollow', protect, hashtagController.unfollowHashtag);

// Get user's followed hashtags (requires auth)
router.get('/following/list', protect, hashtagController.getFollowedHashtags);

// Check if user follows a hashtag (requires auth)
router.get('/:tag/is-following', protect, hashtagController.isFollowingHashtag);

module.exports = router;
