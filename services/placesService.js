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
        console.log('📅 [PLACES SERVICE] Cached at:', cachedRegion.cachedAt);
        console.log('⏰ [PLACES SERVICE] Expires at:', cachedRegion.expiresAt);
        console.log('🔄 [PLACES SERVICE] Is expired?', cachedRegion.isExpired());
        
        // Fetch places from DB
        const places = await Place.findNearby(longitude, latitude, radiusMeters, categories);
        console.log(`📦 [PLACES SERVICE] Found ${places.length} places in DB`);
        
        const result = {
          success: true,
          source: 'database',
          places: this.formatPlaces(places),
          count: places.length,
          cached: true,
          cachedAt: cachedRegion.cachedAt,
          expiresAt: cachedRegion.expiresAt
        };
        
        console.log('✅ [PLACES SERVICE] Returning cached data:', {
          success: result.success,
          source: result.source,
          count: result.count,
          cached: result.cached
        });
        
        return result;
      }

      // No cache found or expired - return empty, frontend will call API
      if (cachedRegion) {
        console.log('⚠️ [PLACES SERVICE] Cache found but EXPIRED');
        console.log('📅 [PLACES SERVICE] Cached at:', cachedRegion.cachedAt);
        console.log('⏰ [PLACES SERVICE] Expired at:', cachedRegion.expiresAt);
      } else {
        console.log('⚠️ [PLACES SERVICE] No cache found in DB');
      }
      
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
   * Save places to database - ROBUST VERSION
   * Handles errors gracefully, saves places one by one if batch fails
   */
  async savePlacesToDB(places, longitude, latitude, radiusMeters, categories) {
    try {
      console.log('\n' + '='.repeat(80));
      console.log(`💾 [PLACES SERVICE] Starting robust save operation...`);
      console.log(`📍 [PLACES SERVICE] Location: ${latitude}, ${longitude}`);
      console.log(`📏 [PLACES SERVICE] Radius: ${radiusMeters}m`);
      console.log(`🏷️ [PLACES SERVICE] Categories: ${categories.join(', ')}`);
      console.log(`📦 [PLACES SERVICE] Total places to save: ${places.length}`);
      console.log('='.repeat(80) + '\n');

      if (!places || places.length === 0) {
        console.warn('⚠️ [PLACES SERVICE] No places to save');
        return;
      }

      const now = new Date();
      let successCount = 0;
      let updateCount = 0;
      let errorCount = 0;
      const errors = [];

      // Strategy 1: Try batch insert first (fastest)
      console.log('🚀 [PLACES SERVICE] Attempting batch insert...');
      try {
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

        const result = await Place.insertMany(placesWithMetadata, { 
          ordered: false, // Continue on errors
          writeConcern: { w: 1, j: true }
        });
        
        successCount = result.length;
        console.log(`✅ [PLACES SERVICE] Batch insert successful: ${successCount} places`);
      } catch (error) {
        if (error.code === 11000 || error.name === 'BulkWriteError') {
          // Some places inserted, some duplicates
          const insertedCount = error.insertedDocs ? error.insertedDocs.length : 0;
          successCount = insertedCount;
          console.log(`✅ [PLACES SERVICE] Batch insert partial success: ${insertedCount} new places`);
          console.log(`ℹ️  [PLACES SERVICE] Some places already exist (duplicates)`);
        } else {
          console.error('❌ [PLACES SERVICE] Batch insert failed:', error.message);
          console.log('🔄 [PLACES SERVICE] Falling back to individual saves...');
        }
      }

      // Strategy 2: Save/Update places individually (more robust)
      console.log('\n🔄 [PLACES SERVICE] Processing places individually...');
      
      for (let i = 0; i < places.length; i++) {
        const place = places[i];
        
        try {
          // Use upsert to handle both insert and update
          const result = await Place.findOneAndUpdate(
            { geoapifyPlaceId: place.geoapifyPlaceId },
            {
              $set: {
                name: place.name,
                category: place.category,
                categoryName: place.categoryName,
                location: place.location,
                address: place.address,
                contact: place.contact,
                icon: place.icon,
                color: place.color,
                geoapifyCategories: place.geoapifyCategories,
                openingHours: place.openingHours,
                'cacheMetadata.lastUpdatedAt': now,
                'cacheMetadata.lastVerifiedAt': now,
                updatedAt: now
              },
              $setOnInsert: {
                'cacheMetadata.firstCachedAt': now,
                'cacheMetadata.source': 'geoapify',
                createdAt: now,
                verified: false,
                qualityScore: 1
              },
              $inc: { 'cacheMetadata.updateCount': 1 }
            },
            { 
              upsert: true, 
              new: true,
              setDefaultsOnInsert: true,
              writeConcern: { w: 1, j: true }
            }
          );

          if (result) {
            updateCount++;
            if ((i + 1) % 10 === 0) {
              console.log(`📊 [PLACES SERVICE] Progress: ${i + 1}/${places.length} places processed`);
            }
          }
        } catch (placeError) {
          errorCount++;
          errors.push({
            place: place.name,
            id: place.geoapifyPlaceId,
            error: placeError.message
          });
          console.error(`❌ [PLACES SERVICE] Failed to save place: ${place.name}`, placeError.message);
          // Continue with next place - don't stop on error
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('📊 [PLACES SERVICE] Save operation summary:');
      console.log(`   ✅ New places inserted: ${successCount}`);
      console.log(`   🔄 Places updated/upserted: ${updateCount}`);
      console.log(`   ❌ Failed: ${errorCount}`);
      console.log(`   📦 Total processed: ${places.length}`);
      console.log(`   ✨ Success rate: ${((successCount + updateCount) / places.length * 100).toFixed(1)}%`);
      console.log('='.repeat(80) + '\n');

      if (errors.length > 0 && errors.length <= 5) {
        console.log('⚠️ [PLACES SERVICE] Error details:');
        errors.forEach((err, idx) => {
          console.log(`   ${idx + 1}. ${err.place}: ${err.error}`);
        });
      }

      // Create/update cache region (even if some places failed)
      const totalSaved = successCount + updateCount;
      if (totalSaved > 0) {
        console.log(`🗺️ [PLACES SERVICE] Creating/updating cache region...`);
        
        try {
          const region = await PlaceCacheRegion.findOneAndUpdate(
            {
              'location.coordinates': [longitude, latitude],
              radiusMeters: radiusMeters
            },
            {
              $set: {
                location: {
                  type: 'Point',
                  coordinates: [longitude, latitude]
                },
                radiusMeters,
                categories,
                placeCount: totalSaved,
                expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                lastRefreshedAt: now,
                status: 'active'
              },
              $inc: { refreshCount: 1 },
              $setOnInsert: { cachedAt: now }
            },
            { 
              upsert: true, 
              new: true,
              setDefaultsOnInsert: true,
              writeConcern: { w: 1, j: true }
            }
          );

          console.log(`✅ [PLACES SERVICE] Cache region saved: ${region._id}`);
        } catch (regionError) {
          console.error('❌ [PLACES SERVICE] Failed to save cache region:', regionError.message);
          // Don't throw - places are saved, region is just metadata
        }
      }

      console.log('✅ [PLACES SERVICE] Save operation completed\n');
      
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Critical error in savePlacesToDB:', error.message);
      console.error('❌ [PLACES SERVICE] Stack:', error.stack);
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

  /**
   * Get popular places to show on map load (without category selection)
   * Returns: 3 restaurants, 2 hospitals, 1 supermarket, 1 gas station, 1 bank
   */
  async getPopularPlaces(latitude, longitude, radiusMeters = 5000) {
    try {
      console.log('⭐ [PLACES SERVICE] Fetching popular places...');
      console.log('📍 Location:', latitude, longitude);
      console.log('📏 Radius:', radiusMeters, 'meters');

      const popularPlaces = [];

      // Define what to fetch: [category, count] - UPDATED FOR INDIA
      const categoriesToFetch = [
        ['restaurants', 3],
        ['hospitals', 2],
        ['malls', 1],
        ['supermarkets', 1],
        ['petrol_pumps', 1],
        ['banks', 1]
      ];

      for (const [category, count] of categoriesToFetch) {
        const places = await Place.find({
          category: category,
          location: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [longitude, latitude]
              },
              $maxDistance: radiusMeters
            }
          }
        }).limit(count);

        if (places.length > 0) {
          console.log(`✅ [PLACES SERVICE] Found ${places.length} ${category}`);
          popularPlaces.push(...this.formatPlaces(places));
        } else {
          console.log(`⚠️ [PLACES SERVICE] No ${category} found in cache`);
        }
      }

      console.log(`✅ [PLACES SERVICE] Total popular places: ${popularPlaces.length}`);

      return {
        success: true,
        source: 'database',
        places: popularPlaces,
        count: popularPlaces.length,
        cached: true
      };
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error fetching popular places:', error);
      return {
        success: false,
        source: 'none',
        places: [],
        count: 0,
        cached: false,
        error: error.message
      };
    }
  }
}

module.exports = new PlacesService();
