// Background Job - Refresh Stale Places Automatically
const cron = require('node-cron');
const Place = require('../models/Place');
const PlaceCacheRegion = require('../models/PlaceCacheRegion');
const axios = require('axios');

class PlacesRefreshJob {
  constructor() {
    this.geoapifyApiKey = process.env.GEOAPIFY_API_KEY;
    this.geoapifyBaseUrl = 'https://api.geoapify.com/v2/places';
    this.isRunning = false;
    
    // Category-specific freshness rules (in hours)
    this.freshnessRules = {
      restaurants: 7 * 24,      // 7 days - menus/hours change
      hospitals: 90 * 24,       // 90 days - rarely change
      supermarkets: 30 * 24,    // 30 days
      gas_stations: 30 * 24,    // 30 days
      banks: 60 * 24,           // 60 days
      entertainment: 14 * 24,   // 14 days - events change
      hotels: 30 * 24,          // 30 days
      parks: 180 * 24,          // 6 months - very stable
      transport: 60 * 24,       // 60 days
      parking: 90 * 24          // 90 days
    };
  }

  /**
   * Start the background refresh job
   * Runs every 6 hours
   */
  start() {
    console.log('🔄 [PLACES REFRESH JOB] Starting background refresh job...');
    console.log('🔄 [PLACES REFRESH JOB] Schedule: Every 6 hours');
    
    // Run every 6 hours: 0 */6 * * *
    cron.schedule('0 */6 * * *', async () => {
      await this.refreshStalePlaces();
    });

    // Also run on startup (after 5 minutes)
    setTimeout(() => {
      this.refreshStalePlaces();
    }, 5 * 60 * 1000);

    console.log('✅ [PLACES REFRESH JOB] Job scheduled successfully');
  }

  /**
   * Refresh stale places based on category-specific rules
   */
  async refreshStalePlaces() {
    if (this.isRunning) {
      console.log('⚠️ [PLACES REFRESH JOB] Job already running, skipping...');
      return;
    }

    try {
      this.isRunning = true;
      console.log('\n' + '='.repeat(80));
      console.log('🔄 [PLACES REFRESH JOB] Starting refresh cycle...');
      console.log('🕐 [PLACES REFRESH JOB] Time:', new Date().toISOString());
      console.log('='.repeat(80) + '\n');

      // Find expired regions
      const expiredRegions = await PlaceCacheRegion.find({
        status: 'active',
        expiresAt: { $lt: new Date() }
      }).limit(10); // Process 10 regions at a time

      if (expiredRegions.length === 0) {
        console.log('✅ [PLACES REFRESH JOB] No expired regions found');
        return;
      }

      console.log(`📍 [PLACES REFRESH JOB] Found ${expiredRegions.length} expired regions`);

      for (const region of expiredRegions) {
        await this.refreshRegion(region);
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ [PLACES REFRESH JOB] Refresh cycle completed');
      console.log('='.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ [PLACES REFRESH JOB] Error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Refresh a specific region
   */
  async refreshRegion(region) {
    try {
      console.log(`\n🔄 [PLACES REFRESH JOB] Refreshing region ${region._id}`);
      console.log(`📍 Location: [${region.location.coordinates[1]}, ${region.location.coordinates[0]}]`);
      console.log(`📏 Radius: ${region.radiusMeters}m`);
      console.log(`🏷️ Categories: ${region.categories.join(', ')}`);

      // Mark as refreshing
      region.status = 'refreshing';
      await region.save();

      // Fetch fresh data from Geoapify
      const [longitude, latitude] = region.location.coordinates;
      const categoriesParam = this.mapCategoriesToGeoapify(region.categories).join(',');
      
      const url = `${this.geoapifyBaseUrl}?` +
        `categories=${encodeURIComponent(categoriesParam)}` +
        `&filter=circle:${longitude},${latitude},${region.radiusMeters}` +
        `&bias=proximity:${longitude},${latitude}` +
        `&limit=100` +
        `&apiKey=${this.geoapifyApiKey}`;

      console.log('🌐 [PLACES REFRESH JOB] Fetching from Geoapify API...');
      const response = await axios.get(url);

      if (!response.data || !response.data.features) {
        console.warn('⚠️ [PLACES REFRESH JOB] No data received from API');
        region.status = 'active';
        await region.save();
        return;
      }

      const places = response.data.features;
      console.log(`✅ [PLACES REFRESH JOB] Received ${places.length} places from API`);

      // Update places in DB
      let updatedCount = 0;
      for (const feature of places) {
        const placeData = this.convertGeoapifyPlace(feature, region.categories[0]);
        
        await Place.updateOne(
          { geoapifyPlaceId: placeData.geoapifyPlaceId },
          {
            $set: {
              ...placeData,
              'cacheMetadata.lastUpdatedAt': new Date(),
              'cacheMetadata.lastVerifiedAt': new Date()
            },
            $inc: { 'cacheMetadata.updateCount': 1 }
          },
          { upsert: true }
        );
        updatedCount++;
      }

      console.log(`✅ [PLACES REFRESH JOB] Updated ${updatedCount} places`);

      // Update region with new expiry based on category
      const categoryExpiry = this.getCategoryExpiry(region.categories[0]);
      region.status = 'active';
      region.placeCount = places.length;
      region.lastRefreshedAt = new Date();
      region.expiresAt = new Date(Date.now() + categoryExpiry);
      region.refreshCount += 1;
      await region.save();

      console.log(`✅ [PLACES REFRESH JOB] Region refreshed successfully`);
      console.log(`⏰ [PLACES REFRESH JOB] Next refresh: ${region.expiresAt.toISOString()}`);

    } catch (error) {
      console.error(`❌ [PLACES REFRESH JOB] Error refreshing region ${region._id}:`, error.message);
      
      // Mark region as active even on error (will retry next cycle)
      region.status = 'active';
      await region.save();
    }
  }

  /**
   * Get expiry time for a category (in milliseconds)
   */
  getCategoryExpiry(category) {
    const hours = this.freshnessRules[category] || 24; // Default 24 hours
    return hours * 60 * 60 * 1000;
  }

  /**
   * Map our category IDs to Geoapify categories - UPDATED FOR INDIA
   */
  mapCategoriesToGeoapify(categories) {
    const mapping = {
      restaurants: ['catering.restaurant', 'catering.cafe', 'catering.fast_food', 'catering'],
      hospitals: ['healthcare.hospital', 'healthcare.clinic', 'healthcare.doctor', 'healthcare.pharmacy', 'healthcare'],
      malls: ['commercial.shopping_mall', 'commercial.department_store', 'commercial.marketplace'],
      supermarkets: ['commercial.supermarket', 'commercial.convenience', 'commercial.food'],
      petrol_pumps: ['service.fuel', 'commercial.gas', 'service.vehicle'],
      banks: ['commercial.bank', 'commercial.atm', 'service.financial'],
      restaurants_cafes: ['catering.cafe', 'catering.bakery', 'catering.ice_cream'],
      entertainment: ['entertainment.cinema', 'entertainment.culture', 'entertainment.activity', 'tourism.attraction'],
      hotels: ['accommodation.hotel', 'accommodation'],
      parks: ['leisure.park', 'natural.park', 'leisure.garden'],
      transport: ['public_transport.station', 'public_transport'],
      parking: ['parking']
    };

    const geoapifyCategories = [];
    for (const category of categories) {
      if (mapping[category]) {
        geoapifyCategories.push(...mapping[category]);
      }
    }

    return geoapifyCategories;
  }

  /**
   * Convert Geoapify place to our format
   */
  convertGeoapifyPlace(feature, category) {
    const props = feature.properties;
    const [longitude, latitude] = feature.geometry.coordinates;

    const categoryIcons = {
      restaurants: '🍴',
      hospitals: '🏥',
      malls: '🛍️',
      supermarkets: '🏪',
      petrol_pumps: '⛽',
      banks: '🏦',
      restaurants_cafes: '☕',
      entertainment: '🎬',
      hotels: '🏨',
      parks: '🌳',
      transport: '🚉',
      parking: '🅿️'
    };

    const categoryColors = {
      restaurants: '#FF6B6B',
      hospitals: '#FF4757',
      malls: '#5F27CD',
      supermarkets: '#48DBfB',
      petrol_pumps: '#FFA502',
      banks: '#1E90FF',
      restaurants_cafes: '#A0522D',
      entertainment: '#E84393',
      hotels: '#FD79A8',
      parks: '#00B894',
      transport: '#636E72',
      parking: '#B2BEC3'
    };

    return {
      geoapifyPlaceId: props.place_id,
      name: props.name || 'Unknown Place',
      category: category,
      categoryName: category.charAt(0).toUpperCase() + category.slice(1),
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      address: {
        formatted: props.formatted || props.address_line1 || 'Address not available'
      },
      contact: {
        phone: props.contact?.phone,
        website: props.contact?.website
      },
      icon: categoryIcons[category] || '📍',
      color: categoryColors[category] || '#999999',
      geoapifyCategories: props.categories || [],
      openingHours: props.opening_hours
    };
  }

  /**
   * Manually trigger refresh (for testing)
   */
  async triggerManualRefresh() {
    console.log('🔄 [PLACES REFRESH JOB] Manual refresh triggered');
    await this.refreshStalePlaces();
  }
}

module.exports = new PlacesRefreshJob();
