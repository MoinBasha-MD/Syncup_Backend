/**
 * Profile Routes
 * Routes for public profile, friend profile, and follow/unfollow
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPublicProfile,
  getFriendProfile,
  followUser,
  unfollowUser
} = require('../controllers/profileController');

// Public profile (for strangers/non-friends)
router.get('/users/public-profile/:userId', protect, getPublicProfile);

// Friend profile (for friends only)
router.get('/friends/:userId/profile', protect, getFriendProfile);

// Follow/Unfollow
router.post('/users/:userId/follow', protect, followUser);
router.post('/users/:userId/unfollow', protect, unfollowUser);

module.exports = router;
