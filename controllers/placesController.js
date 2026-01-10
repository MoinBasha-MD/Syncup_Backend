// Places Controller - Handle API requests for places
const placesService = require('../services/placesService');

class PlacesController {
  /**
   * GET /api/places/nearby
   * Get nearby places (from DB cache or API)
   */
  async getNearbyPlaces(req, res) {
    try {
      const { lat, lng, radius, categories } = req.query;

      // Validation
      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: lat, lng'
        });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radiusMeters = parseInt(radius) || 3000;
      const categoryList = categories ? categories.split(',') : [];

      // Validate coordinates
      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid coordinates'
        });
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({
          success: false,
          error: 'Coordinates out of range'
        });
      }

      console.log('📍 [PLACES API] GET /api/places/nearby');
      console.log('   Location:', latitude, longitude);
      console.log('   Radius:', radiusMeters);
      console.log('   Categories:', categoryList);

      // Get places from service
      const result = await placesService.getNearbyPlaces(
        latitude,
        longitude,
        radiusMeters,
        categoryList
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('❌ [PLACES API] Error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch nearby places',
        message: error.message
      });
    }
  }

  /**
   * POST /api/places/cache
   * Manually cache places (called after API fetch on frontend)
   */
  async cachePlaces(req, res) {
    try {
      const { places, region } = req.body;

      if (!places || !region) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: places, region'
        });
      }

      const { lat, lng, radius, categories } = region;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          error: 'Missing region coordinates'
        });
      }

      console.log('💾 [PLACES API] POST /api/places/cache');
      console.log('   Places count:', places.length);
      console.log('   Region:', lat, lng, radius);

      // Save to database
      await placesService.savePlacesToDB(
        places,
        parseFloat(lng),
        parseFloat(lat),
        parseInt(radius) || 3000,
        categories || []
      );

      return res.status(200).json({
        success: true,
        message: 'Places cached successfully',
        count: places.length
      });
    } catch (error) {
      console.error('❌ [PLACES API] Cache error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to cache places',
        message: error.message
      });
    }
  }

  /**
   * GET /api/places/cache-status
   * Check if a region is cached
   */
  async getCacheStatus(req, res) {
    try {
      const { lat, lng, radius, categories } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: lat, lng'
        });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radiusMeters = parseInt(radius) || 3000;
      const categoryList = categories ? categories.split(',') : [];

      console.log('🔍 [PLACES API] GET /api/places/cache-status');

      const status = await placesService.checkCacheStatus(
        latitude,
        longitude,
        radiusMeters,
        categoryList
      );

      return res.status(200).json({
        success: true,
        ...status
      });
    } catch (error) {
      console.error('❌ [PLACES API] Cache status error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to check cache status',
        message: error.message
      });
    }
  }

  /**
   * POST /api/places/cleanup
   * Cleanup expired cache (admin endpoint)
   */
  async cleanupCache(req, res) {
    try {
      console.log('🧹 [PLACES API] POST /api/places/cleanup');

      const result = await placesService.cleanupExpiredCache();

      return res.status(200).json({
        success: true,
        message: 'Cache cleanup completed',
        result
      });
    } catch (error) {
      console.error('❌ [PLACES API] Cleanup error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to cleanup cache',
        message: error.message
      });
    }
  }
}

module.exports = new PlacesController();
