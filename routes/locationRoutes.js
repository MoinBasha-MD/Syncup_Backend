const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const mapboxService = require('../services/mapboxService');
const locationService = require('../services/locationService');
const locationController = require('../controllers/locationController');

/**
 * @route   POST /api/location/geocode/reverse
 * @desc    Convert coordinates to address
 * @access  Private
 */
router.post('/geocode/reverse', protect, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Validate coordinates
    if (!locationService.validateCoordinates(latitude, longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const result = await mapboxService.reverseGeocode(latitude, longitude);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reverse geocode',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/location/geocode/forward
 * @desc    Convert address to coordinates
 * @access  Private
 */
router.post('/geocode/forward', protect, async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const results = await mapboxService.forwardGeocode(query, limit);

    res.json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Forward geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to forward geocode',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/location/search/nearby
 * @desc    Search places near a location
 * @access  Private
 */
router.post('/search/nearby', protect, async (req, res) => {
  try {
    const { query, latitude, longitude, limit = 5 } = req.body;

    if (!query || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Query, latitude, and longitude are required'
      });
    }

    // Validate coordinates
    if (!locationService.validateCoordinates(latitude, longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const results = await mapboxService.searchNearby(query, latitude, longitude, limit);

    res.json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Search nearby error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search nearby places',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/location/distance
 * @desc    Calculate distance between two points
 * @access  Private
 */
router.post('/distance', protect, async (req, res) => {
  try {
    const { lat1, lon1, lat2, lon2 } = req.body;

    if (!lat1 || !lon1 || !lat2 || !lon2) {
      return res.status(400).json({
        success: false,
        message: 'All coordinates are required (lat1, lon1, lat2, lon2)'
      });
    }

    // Validate coordinates
    if (!locationService.validateCoordinates(lat1, lon1) || 
        !locationService.validateCoordinates(lat2, lon2)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const distance = locationService.calculateDistance(lat1, lon1, lat2, lon2);

    res.json({
      success: true,
      distance: distance,
      unit: 'km',
      formatted: locationService.formatDistance(distance)
    });
  } catch (error) {
    console.error('Calculate distance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate distance',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/location/static-map
 * @desc    Get static map image URL
 * @access  Private
 */
router.get('/static-map', protect, async (req, res) => {
  try {
    const { latitude, longitude, zoom = 15, width = 300, height = 200 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Validate coordinates
    if (!locationService.validateCoordinates(lat, lon)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const url = mapboxService.getStaticMapUrl(
      lat,
      lon,
      parseInt(zoom),
      parseInt(width),
      parseInt(height)
    );

    res.json({
      success: true,
      url: url
    });
  } catch (error) {
    console.error('Get static map error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate static map URL',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/location/nearby-friends
 * @desc    Get nearby friends' locations
 * @access  Private
 */
router.get('/nearby-friends', protect, locationController.getNearbyFriends);

/**
 * @route   GET /api/location/friend/:friendId
 * @desc    Get specific friend's location
 * @access  Private
 */
router.get('/friend/:friendId', protect, locationController.getFriendLocation);

module.exports = router;
