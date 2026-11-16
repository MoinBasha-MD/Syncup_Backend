// Places Routes - API endpoints for places caching
const express = require('express');
const router = express.Router();
const placesController = require('../controllers/placesController');
const { verifyToken: adminVerifyToken } = require('./adminAuthRoutes');
const { protect } = require('../middleware/authMiddleware');

// GET /api/places/nearby - Get nearby places (DB cache or API)
router.get('/nearby', protect, placesController.getNearbyPlaces);

// GET /api/places/popular - Get popular places on map load (3 restaurants, 2 hospitals, etc.)
router.get('/popular', protect, placesController.getPopularPlaces);

// POST /api/places/cache - Manually cache places (admin only)
router.post('/cache', adminVerifyToken, placesController.cachePlaces);

// GET /api/places/cache-status - Check cache status
router.get('/cache-status', protect, placesController.getCacheStatus);

// POST /api/places/cleanup - Cleanup expired cache (admin only)
router.post('/cleanup', adminVerifyToken, placesController.cleanupCache);

module.exports = router;
