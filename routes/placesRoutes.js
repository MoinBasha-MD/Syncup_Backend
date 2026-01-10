// Places Routes - API endpoints for places caching
const express = require('express');
const router = express.Router();
const placesController = require('../controllers/placesController');

// GET /api/places/nearby - Get nearby places (DB cache or API)
router.get('/nearby', placesController.getNearbyPlaces);

// POST /api/places/cache - Manually cache places
router.post('/cache', placesController.cachePlaces);

// GET /api/places/cache-status - Check cache status
router.get('/cache-status', placesController.getCacheStatus);

// POST /api/places/cleanup - Cleanup expired cache (admin)
router.post('/cleanup', placesController.cleanupCache);

module.exports = router;
