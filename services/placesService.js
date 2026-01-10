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
   * Get nearby places - Smart caching strategy
   * 1. Check if region is cached and fresh
   * 2. If yes, return from DB
   * 3. If no, fetch from Geoapify API
   * 4. Save to DB and return
   */
  async getNearbyPlaces(latitude, longitude, radiusMeters = 3000, categories = []) {
    try {
      console.log('🔍 [PLACES SERVICE] Getting nearby places...');
      console.log('📍 Location:', latitude, longitude);
      console.log('📏 Radius:', radiusMeters, 'meters');
      console.log('🏷️ Categories:', categories);

      // Step 1: Check if this region is cached
      const cachedRegion = await PlaceCacheRegion.findCachedRegion(
        longitude,
        latitude,
        radiusMeters,
        categories
      );

      if (cachedRegion && !cachedRegion.isExpired()) {
        console.log('✅ [PLACES SERVICE] Found cached region, fetching from DB');
        
        // Fetch places from DB
        const places = await Place.findNearby(longitude, latitude, radiusMeters, categories);
        
        // Check if any places are stale (> 24 hours old)
        const stalePlaces = places.filter(p => p.isStale(this.cacheExpiryHours));
        
        if (stalePlaces.length > 0) {
          console.log(`⚠️ [PLACES SERVICE] ${stalePlaces.length} places are stale, will refresh in background`);
          // Refresh stale places in background (don't wait)
          this.refreshStalePlaces(stalePlaces).catch(err => {
            console.error('❌ [PLACES SERVICE] Background refresh failed:', err);
          });
        }
        
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

      console.log('🌐 [PLACES SERVICE] No valid cache, fetching from Geoapify API');
      
      // Step 2: Fetch from Geoapify API
      const apiPlaces = await this.fetchFromGeoapifyAPI(
        latitude,
        longitude,
        radiusMeters,
        categories
      );

      // Step 3: Save to database
      await this.savePlacesToDB(apiPlaces, longitude, latitude, radiusMeters, categories);

      return {
        success: true,
        source: 'api',
        places: apiPlaces,
        count: apiPlaces.length,
        cached: false
      };
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error:', error);
      throw error;
    }
  }

  /**
   * Fetch places from Geoapify API
   */
  async fetchFromGeoapifyAPI(latitude, longitude, radiusMeters, categories) {
    try {
      console.log('🌐 [PLACES SERVICE] Calling Geoapify API...');

      // Build category filter
      const categoryFilter = categories.length > 0 
        ? categories.join(',')
        : 'catering,healthcare,service';

      const url = `${this.geoapifyBaseUrl}?` +
        `categories=${categoryFilter}` +
        `&filter=circle:${longitude},${latitude},${radiusMeters}` +
        `&limit=100` +
        `&apiKey=${this.geoapifyApiKey}`;

      const response = await axios.get(url, {
        timeout: 10000 // 10 second timeout
      });

      if (!response.data || !response.data.features) {
        console.warn('⚠️ [PLACES SERVICE] No features in API response');
        return [];
      }

      const places = this.parseGeoapifyResponse(response.data);
      console.log(`✅ [PLACES SERVICE] Fetched ${places.length} places from API`);

      return places;
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Geoapify API error:', error.message);
      throw new Error('Failed to fetch places from Geoapify API');
    }
  }

  /**
   * Parse Geoapify API response
   */
  parseGeoapifyResponse(data) {
    return data.features.map(feature => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;

      return {
        geoapifyPlaceId: props.place_id,
        name: props.name || props.address_line1 || 'Unknown Place',
        category: this.extractMainCategory(props.categories),
        categoryName: this.getCategoryName(props.categories),
        location: {
          type: 'Point',
          coordinates: coords // [longitude, latitude]
        },
        address: {
          formatted: props.formatted || props.address_line1,
          street: props.street,
          houseNumber: props.housenumber,
          city: props.city,
          state: props.state,
          country: props.country,
          postalCode: props.postcode
        },
        contact: {
          phone: props.contact?.phone,
          website: props.website,
          email: props.contact?.email
        },
        icon: this.getCategoryIcon(props.categories),
        color: this.getCategoryColor(props.categories),
        geoapifyCategories: props.categories || [],
        openingHours: props.opening_hours,
        cacheMetadata: {
          firstCachedAt: new Date(),
          lastUpdatedAt: new Date(),
          lastVerifiedAt: new Date(),
          updateCount: 0,
          source: 'geoapify'
        }
      };
    });
  }

  /**
   * Save places to database
   */
  async savePlacesToDB(places, longitude, latitude, radiusMeters, categories) {
    try {
      console.log(`💾 [PLACES SERVICE] Saving ${places.length} places to DB...`);

      // Upsert each place
      const savePromises = places.map(place => 
        Place.upsertPlace(place)
      );

      await Promise.all(savePromises);

      // Create/update cache region
      await PlaceCacheRegion.createOrUpdate(
        longitude,
        latitude,
        radiusMeters,
        categories,
        places.length
      );

      console.log('✅ [PLACES SERVICE] Places saved to DB successfully');
    } catch (error) {
      console.error('❌ [PLACES SERVICE] Error saving to DB:', error);
      // Don't throw - caching failure shouldn't break the request
    }
  }

  /**
   * Refresh stale places in background
   */
  async refreshStalePlaces(stalePlaces) {
    console.log(`🔄 [PLACES SERVICE] Refreshing ${stalePlaces.length} stale places...`);
    
    for (const place of stalePlaces) {
      try {
        // Mark as updated
        await place.updateCache();
      } catch (error) {
        console.error(`❌ [PLACES SERVICE] Failed to refresh place ${place.name}:`, error);
      }
    }
  }

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

  /**
   * Extract main category from Geoapify categories
   */
  extractMainCategory(categories) {
    if (!categories || categories.length === 0) return 'other';
    
    const categoryMap = {
      'catering.restaurant': 'restaurants',
      'catering.cafe': 'cafes',
      'catering.fast_food': 'restaurants',
      'healthcare.hospital': 'hospitals',
      'healthcare.clinic': 'hospitals',
      'service.fuel': 'gas_stations',
      'service.charging_station': 'gas_stations',
      'service.financial.bank': 'banks',
      'service.financial.atm': 'banks'
    };

    for (const cat of categories) {
      if (categoryMap[cat]) {
        return categoryMap[cat];
      }
    }

    return 'other';
  }

  /**
   * Get category display name
   */
  getCategoryName(categories) {
    const mainCat = this.extractMainCategory(categories);
    const nameMap = {
      'restaurants': 'Restaurant',
      'cafes': 'Cafe',
      'hospitals': 'Hospital',
      'gas_stations': 'Gas Station',
      'banks': 'Bank',
      'other': 'Place'
    };
    return nameMap[mainCat] || 'Place';
  }

  /**
   * Get category icon
   */
  getCategoryIcon(categories) {
    const mainCat = this.extractMainCategory(categories);
    const iconMap = {
      'restaurants': '🍽️',
      'cafes': '☕',
      'hospitals': '🏥',
      'gas_stations': '⛽',
      'banks': '🏦',
      'other': '📍'
    };
    return iconMap[mainCat] || '📍';
  }

  /**
   * Get category color
   */
  getCategoryColor(categories) {
    const mainCat = this.extractMainCategory(categories);
    const colorMap = {
      'restaurants': '#FF6B6B',
      'cafes': '#F38181',
      'hospitals': '#4ECDC4',
      'gas_stations': '#10b981',
      'banks': '#AA96DA',
      'other': '#999999'
    };
    return colorMap[mainCat] || '#999999';
  }

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
