const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getMusicLibrary,
  getTrendingTracks,
  streamMusic,
  getTrackById,
  incrementUsage,
  getCategories,
  forceSync
} = require('../controllers/musicController');

// Public routes (streaming doesn't require auth for caching/CDN compatibility)
router.get('/stream/:filename', streamMusic);

// Protected routes
router.get('/library', protect, getMusicLibrary);
router.get('/trending', protect, getTrendingTracks);
router.get('/categories', protect, getCategories);
router.post('/sync', protect, forceSync); // Force re-scan music folder
router.get('/:trackId', protect, getTrackById);
router.post('/increment-usage/:trackId', protect, incrementUsage);

module.exports = router;
