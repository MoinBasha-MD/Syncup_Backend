// Places Service - Smart caching logic for nearby places
const Place = require('../models/Place');
const PlaceCacheRegion = require('../models/PlaceCacheRegion');
const axios = require('axios');

class PlacesService {
  constructor() {
    this.geoapifyApiKey = process.env.GEOAPIFY_API_KEY;
    this.geoapifyBaseUrl = 'https://api.geoapify.com/v2/places';
    this.cacheExpiryHours = 24; // 24 hours cache
    
    // Log API key status for debugging
    if (!this.geoapifyApiKey) {
      console.error('❌ [PLACES SERVICE] GEOAPIFY_API_KEY not found in environment variables!');
      console.error('❌ [PLACES SERVICE] Available env vars:', Object.keys(process.env).filter(k => k.includes('GEO')));
    } else {
      console.log('✅ [PLACES SERVICE] Geoapify API key loaded successfully');
    }
  }

  /**
   * Get nearby places - DB CACHE ONLY
   * Backend only returns cached data from DB
   * Frontend handles Geoapify API calls directly
   */
  async getNearbyPlaces(latitude, longitude, radiusMeters = 3000, categories = []) {
    try {
      console.log('🔍 [PLACES SERVICE] Checking DB cache...');
      console.log('📍 Location:', latitude, longitude);
      console.log('📏 Radius:', radiusMeters, 'meters');
      console.log('🏷️ Categories:', categories);

      // Check if this region is cached
      const cachedRegion = await PlaceCacheRegion.findCachedRegion(
        longitude,
        latitude,
        radiusMeters,
        categories
      );

      if (cachedRegion && !cachedRegion.isExpired()) {
        console.log('✅ [PLACES SERVICE] Found cached region in DB');
        
        // Fetch places from DB
        const places = await Place.findNearby(longitude, latitude, radiusMeters, categories);
        
        return {
          success: true,
          source: 'database',
          places: this.formatPlaces(places),
          count: places.length,
          cached: true,
          cachedAt: cachedRegion.cachedAt,
          expiresAt: cachedRegion.expiresAt
        };
      }

      // No cache found - return empty, frontend will call API
      console.log('⚠️ [PLACES SERVICE] No cache found in DB');
      return {
        success: false,
        source: 'none',
        places: [],
        count: 0,
        cached: false,
        message: 'No cached data available. Frontend should call Geoapify API directly.'
      };
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error:', error);
      throw error;
    }
  }

  // Geoapify API fetching and parsing removed - frontend handles this directly

  /**
   * Save places to database
   */
  async savePlacesToDB(places, longitude, latitude, radiusMeters, categories) {
    try {
      console.log(`💾 [PLACES SERVICE] Saving ${places.length} places to DB...`);
      console.log(`📍 [PLACES SERVICE] Location: ${latitude}, ${longitude}`);
      console.log(`📏 [PLACES SERVICE] Radius: ${radiusMeters}m`);
      console.log(`🏷️ [PLACES SERVICE] Categories: ${categories.join(', ')}`);

      // Prepare places with metadata
      const now = new Date();
      const placesWithMetadata = places.map(place => ({
        ...place,
        cacheMetadata: {
          firstCachedAt: now,
          lastUpdatedAt: now,
          lastVerifiedAt: now,
          source: 'geoapify',
          updateCount: 1
        },
        createdAt: now,
        updatedAt: now,
        verified: false,
        qualityScore: 1
      }));

      console.log(`🔄 [PLACES SERVICE] Inserting ${placesWithMetadata.length} places...`);
      
      // Use insertMany with ordered:false to continue on duplicate key errors
      let successCount = 0;
      let duplicateCount = 0;
      
      try {
        const result = await Place.insertMany(placesWithMetadata, { 
          ordered: false,
          writeConcern: { w: 1, j: true }
        });
        successCount = result.length;
        console.log(`✅ [PLACES SERVICE] Inserted ${successCount} new places`);
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate key errors - some places already exist
          successCount = error.insertedDocs ? error.insertedDocs.length : 0;
          duplicateCount = places.length - successCount;
          console.log(`✅ [PLACES SERVICE] Inserted ${successCount} new places`);
          console.log(`ℹ️  [PLACES SERVICE] Skipped ${duplicateCount} duplicates`);
        } else {
          throw error;
        }
      }

      // Update existing places
      if (duplicateCount > 0) {
        console.log(`🔄 [PLACES SERVICE] Updating ${duplicateCount} existing places...`);
        const updatePromises = places.map(place => 
          Place.updateOne(
            { geoapifyPlaceId: place.geoapifyPlaceId },
            { 
              $set: {
                ...place,
                'cacheMetadata.lastUpdatedAt': now,
                'cacheMetadata.lastVerifiedAt': now,
                updatedAt: now
              },
              $inc: { 'cacheMetadata.updateCount': 1 }
            },
            { writeConcern: { w: 1, j: true } }
          )
        );
        await Promise.all(updatePromises);
        console.log(`✅ [PLACES SERVICE] Updated ${duplicateCount} existing places`);
      }

      const totalSaved = successCount + duplicateCount;
      console.log(`✅ [PLACES SERVICE] Total places saved: ${totalSaved}/${places.length}`);

      // Create/update cache region
      console.log(`🗺️ [PLACES SERVICE] Creating/updating cache region...`);
      
      const regionData = {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        radiusMeters,
        categories,
        placeCount: totalSaved,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        lastRefreshedAt: now,
        refreshCount: 1,
        status: 'active'
      };

      const region = await PlaceCacheRegion.create(regionData);
      console.log(`✅ [PLACES SERVICE] Cache region saved: ${region._id}`);
      console.log(`✅ [PLACES SERVICE] All operations completed successfully`);
      
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error saving to DB:', error.message);
      console.error('❌ [PLACES SERVICE] Error stack:', error.stack);
      // Don't throw - caching failure shouldn't break the request
    }
  }

  // Stale place refresh removed - frontend handles API calls

  /**
   * Format places for frontend
   */
  formatPlaces(places) {
    return places.map(place => ({
      id: place._id.toString(),
      geoapifyPlaceId: place.geoapifyPlaceId,
      name: place.name,
      category: place.category,
      categoryName: place.categoryName,
      latitude: place.location.coordinates[1],
      longitude: place.location.coordinates[0],
      address: place.address.formatted,
      icon: place.icon,
      color: place.color,
      distance: 0, // Will be calculated on frontend
      phone: place.contact?.phone,
      website: place.contact?.website
    }));
  }

  // Category helper methods removed - frontend handles all Geoapify API processing

  /**
   * Check cache status for a region
   */
  async checkCacheStatus(latitude, longitude, radiusMeters, categories) {
    try {
      const cachedRegion = await PlaceCacheRegion.findCachedRegion(
        longitude,
        latitude,
        radiusMeters,
        categories
      );

      if (!cachedRegion) {
        return {
          cached: false,
          placeCount: 0
        };
      }

      return {
        cached: !cachedRegion.isExpired(),
        placeCount: cachedRegion.placeCount,
        cachedAt: cachedRegion.cachedAt,
        expiresAt: cachedRegion.expiresAt,
        expired: cachedRegion.isExpired()
      };
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error checking cache status:', error);
      return { cached: false, placeCount: 0 };
    }
  }

  /**
   * Cleanup expired cache regions (run periodically)
   */
  async cleanupExpiredCache() {
    try {
      console.log('🧹 [PLACES SERVICE] Cleaning up expired cache...');
      const result = await PlaceCacheRegion.cleanupExpired();
      console.log(`✅ [PLACES SERVICE] Cleaned up ${result.modifiedCount} expired regions`);
      return result;
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Cleanup error:', error);
    }
  }
}

module.exports = new PlacesService();
