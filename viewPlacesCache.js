// POI Cache Visualization Script
// Run this script to see what places are cached in your database
// Usage: node viewPlacesCache.js

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup';

// Import models
const Place = require('./models/Place');
const PlaceCacheRegion = require('./models/PlaceCacheRegion');

// Category icons for better visualization
const CATEGORY_ICONS = {
  'restaurants': '🍽️',
  'hospitals': '🏥',
  'supermarkets': '🏪',
  'gas_stations': '⛽',
  'banks': '🏦',
  'entertainment': '🎭',
  'hotels': '🏨',
  'parks': '🌳',
  'transport': '🚇',
  'parking': '🅿️'
};

async function viewPlacesCache() {
  try {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📍 POI CACHE VISUALIZATION DASHBOARD');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected successfully!\n');

    // ═══════════════════════════════════════════════════════════
    // 1. OVERALL STATISTICS
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 OVERALL STATISTICS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const totalPlaces = await Place.countDocuments();
    const totalRegions = await PlaceCacheRegion.countDocuments();
    const activeRegions = await PlaceCacheRegion.countDocuments({ status: 'active' });
    const expiredRegions = await PlaceCacheRegion.countDocuments({ status: 'expired' });

    console.log(`📍 Total Places Cached: ${totalPlaces}`);
    console.log(`🗺️  Total Regions: ${totalRegions}`);
    console.log(`✅ Active Regions: ${activeRegions}`);
    console.log(`❌ Expired Regions: ${expiredRegions}\n`);

    if (totalPlaces === 0) {
      console.log('⚠️  No places found in cache. Start using the app to populate the cache!\n');
      await mongoose.connection.close();
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. PLACES BY CATEGORY
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📂 PLACES BY CATEGORY');
    console.log('═══════════════════════════════════════════════════════════\n');

    const categoryStats = await Place.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    for (const cat of categoryStats) {
      const icon = CATEGORY_ICONS[cat._id] || '📍';
      console.log(`${icon} ${cat._id.padEnd(20)} : ${cat.count} places`);
    }
    console.log('\n');

    // ═══════════════════════════════════════════════════════════
    // 3. DETAILED PLACES BY CATEGORY
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 DETAILED PLACES BY CATEGORY');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const cat of categoryStats) {
      const icon = CATEGORY_ICONS[cat._id] || '📍';
      console.log(`\n${icon} ${cat._id.toUpperCase()} (${cat.count} places)`);
      console.log('─────────────────────────────────────────────────────────');

      const places = await Place.find({ category: cat._id })
        .sort({ 'cacheMetadata.lastUpdatedAt': -1 })
        .limit(10)
        .lean();

      places.forEach((place, index) => {
        const coords = `${place.location.coordinates[1].toFixed(4)}, ${place.location.coordinates[0].toFixed(4)}`;
        const cachedAt = new Date(place.cacheMetadata.lastUpdatedAt).toLocaleString();
        console.log(`   ${index + 1}. ${place.name}`);
        console.log(`      📍 Location: ${coords}`);
        console.log(`      📍 Address: ${place.address?.formatted || 'N/A'}`);
        console.log(`      🕒 Last Updated: ${cachedAt}`);
        if (place.contact?.phone) console.log(`      📞 Phone: ${place.contact.phone}`);
        if (place.contact?.website) console.log(`      🌐 Website: ${place.contact.website}`);
        console.log('');
      });

      if (cat.count > 10) {
        console.log(`   ... and ${cat.count - 10} more places\n`);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. GEOGRAPHIC COVERAGE (CACHED REGIONS)
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🗺️  GEOGRAPHIC COVERAGE (CACHED REGIONS)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const regions = await PlaceCacheRegion.find()
      .sort({ cachedAt: -1 })
      .lean();

    if (regions.length === 0) {
      console.log('⚠️  No regions cached yet\n');
    } else {
      regions.forEach((region, index) => {
        const coords = region.location.coordinates;
        const lat = coords[1].toFixed(4);
        const lng = coords[0].toFixed(4);
        const radiusKm = (region.radiusMeters / 1000).toFixed(1);
        const isExpired = new Date(region.expiresAt) < new Date();
        const statusIcon = isExpired ? '❌' : '✅';
        
        console.log(`${index + 1}. ${statusIcon} Region at [${lat}, ${lng}]`);
        console.log(`   📏 Radius: ${radiusKm} km (${region.radiusMeters}m)`);
        console.log(`   📂 Categories: ${region.categories.join(', ')}`);
        console.log(`   📊 Places: ${region.placeCount}`);
        console.log(`   🕒 Cached: ${new Date(region.cachedAt).toLocaleString()}`);
        console.log(`   ⏰ Expires: ${new Date(region.expiresAt).toLocaleString()}`);
        console.log(`   🔄 Refreshed: ${region.refreshCount} times`);
        console.log(`   📍 Status: ${region.status}`);
        console.log('');
      });
    }

    // ═══════════════════════════════════════════════════════════
    // 5. CACHE FRESHNESS ANALYSIS
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('⏰ CACHE FRESHNESS ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const fresh = await Place.countDocuments({
      'cacheMetadata.lastUpdatedAt': { $gte: oneDayAgo }
    });

    const recent = await Place.countDocuments({
      'cacheMetadata.lastUpdatedAt': { $gte: oneWeekAgo, $lt: oneDayAgo }
    });

    const stale = await Place.countDocuments({
      'cacheMetadata.lastUpdatedAt': { $lt: oneWeekAgo }
    });

    console.log(`✅ Fresh (<24 hours):     ${fresh} places`);
    console.log(`⚠️  Recent (1-7 days):     ${recent} places`);
    console.log(`❌ Stale (>7 days):       ${stale} places\n`);

    // ═══════════════════════════════════════════════════════════
    // 6. TOP LOCATIONS BY PLACE DENSITY
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔥 TOP LOCATIONS BY PLACE DENSITY');
    console.log('═══════════════════════════════════════════════════════════\n');

    const topRegions = await PlaceCacheRegion.find()
      .sort({ placeCount: -1 })
      .limit(5)
      .lean();

    topRegions.forEach((region, index) => {
      const coords = region.location.coordinates;
      const lat = coords[1].toFixed(4);
      const lng = coords[0].toFixed(4);
      
      console.log(`${index + 1}. 📍 [${lat}, ${lng}]`);
      console.log(`   Places: ${region.placeCount}`);
      console.log(`   Categories: ${region.categories.join(', ')}`);
      console.log('');
    });

    // ═══════════════════════════════════════════════════════════
    // 7. RECENT ACTIVITY
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🕒 RECENT ACTIVITY (Last 10 Places Added/Updated)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const recentPlaces = await Place.find()
      .sort({ 'cacheMetadata.lastUpdatedAt': -1 })
      .limit(10)
      .lean();

    recentPlaces.forEach((place, index) => {
      const icon = CATEGORY_ICONS[place.category] || '📍';
      const time = new Date(place.cacheMetadata.lastUpdatedAt).toLocaleString();
      
      console.log(`${index + 1}. ${icon} ${place.name}`);
      console.log(`   Category: ${place.category}`);
      console.log(`   Updated: ${time}`);
      console.log(`   Updates: ${place.cacheMetadata.updateCount} times`);
      console.log('');
    });

    // ═══════════════════════════════════════════════════════════
    // 8. GEOAPIFY CATEGORIES BREAKDOWN
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🏷️  GEOAPIFY CATEGORIES BREAKDOWN');
    console.log('═══════════════════════════════════════════════════════════\n');

    const geoapifyCats = await Place.aggregate([
      { $unwind: '$geoapifyCategories' },
      { $group: { _id: '$geoapifyCategories', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    geoapifyCats.forEach((cat, index) => {
      console.log(`${index + 1}. ${cat._id.padEnd(30)} : ${cat.count} places`);
    });
    console.log('\n');

    // ═══════════════════════════════════════════════════════════
    // 9. SUMMARY
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`✅ Total Places: ${totalPlaces}`);
    console.log(`✅ Total Categories: ${categoryStats.length}`);
    console.log(`✅ Total Regions: ${totalRegions}`);
    console.log(`✅ Active Regions: ${activeRegions}`);
    console.log(`✅ Fresh Places (<24h): ${fresh}`);
    console.log(`✅ Cache Hit Rate: Enabled for ${activeRegions} regions\n`);

    if (stale > 0) {
      console.log(`⚠️  WARNING: ${stale} places are stale (>7 days old)`);
      console.log(`   Consider setting up a cron job to refresh old data\n`);
    }

    if (expiredRegions > 0) {
      console.log(`⚠️  WARNING: ${expiredRegions} regions have expired`);
      console.log(`   Run: POST /api/places/cleanup to clean them up\n`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ VISUALIZATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('📡 MongoDB connection closed\n');
  }
}

// Run the visualization
viewPlacesCache();
