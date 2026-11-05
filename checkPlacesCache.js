// Diagnostic Script - Check Places Cache in MongoDB
// Run this script: node checkPlacesCache.js

const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup';

// Import models
const Place = require('./models/Place');
const PlaceCacheRegion = require('./models/PlaceCacheRegion');

async function checkPlacesCache() {
  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 PLACES CACHE DIAGNOSTIC SCRIPT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    console.log('   URI:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully!');
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // 1. CHECK PLACE COLLECTION
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📍 CHECKING PLACE COLLECTION');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const totalPlaces = await Place.countDocuments();
    console.log(`📊 Total Places Saved: ${totalPlaces}`);
    console.log('');

    if (totalPlaces === 0) {
      console.log('❌ NO PLACES FOUND IN DATABASE!');
      console.log('   This means the caching system is NOT working.');
      console.log('   Places are not being saved to the database.');
      console.log('');
    } else {
      console.log('✅ Places are being saved to the database!');
      console.log('');

      // Get breakdown by category
      console.log('📊 BREAKDOWN BY CATEGORY:');
      console.log('─────────────────────────────────────────────────────────');
      const categoryBreakdown = await Place.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      if (categoryBreakdown.length > 0) {
        categoryBreakdown.forEach(cat => {
          const icon = getCategoryIcon(cat._id);
          console.log(`   ${icon} ${cat._id.padEnd(20)} : ${cat.count} places`);
        });
      } else {
        console.log('   No category data available');
      }
      console.log('');

      // Get sample places (first 10)
      console.log('📍 SAMPLE PLACES (First 10):');
      console.log('─────────────────────────────────────────────────────────');
      const samplePlaces = await Place.find().limit(10).lean();
      
      samplePlaces.forEach((place, index) => {
        console.log(`   ${index + 1}. ${place.icon} ${place.name}`);
        console.log(`      Category: ${place.category} (${place.categoryName})`);
        console.log(`      Location: ${place.location.coordinates[1]}, ${place.location.coordinates[0]}`);
        console.log(`      Address: ${place.address?.formatted || 'N/A'}`);
        console.log(`      Cached: ${new Date(place.cacheMetadata?.firstCachedAt).toLocaleString()}`);
        console.log(`      Last Updated: ${new Date(place.cacheMetadata?.lastUpdatedAt).toLocaleString()}`);
        console.log(`      Update Count: ${place.cacheMetadata?.updateCount || 0}`);
        console.log('');
      });

      // Check for stale places (>24 hours old)
      const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const stalePlaces = await Place.countDocuments({
        'cacheMetadata.lastUpdatedAt': { $lt: staleCutoff }
      });
      
      console.log('⏰ CACHE FRESHNESS:');
      console.log('─────────────────────────────────────────────────────────');
      console.log(`   Fresh Places (<24hrs): ${totalPlaces - stalePlaces}`);
      console.log(`   Stale Places (>24hrs): ${stalePlaces}`);
      console.log('');
    }

    // ═══════════════════════════════════════════════════════════
    // 2. CHECK PLACE CACHE REGION COLLECTION
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🗺️  CHECKING PLACE CACHE REGION COLLECTION');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const totalRegions = await PlaceCacheRegion.countDocuments();
    console.log(`📊 Total Cached Regions: ${totalRegions}`);
    console.log('');

    if (totalRegions === 0) {
      console.log('❌ NO CACHED REGIONS FOUND!');
      console.log('   This means no regions have been cached yet.');
      console.log('   The system should create regions when places are saved.');
      console.log('');
    } else {
      console.log('✅ Cached regions exist!');
      console.log('');

      // Get active vs expired regions
      const activeRegions = await PlaceCacheRegion.countDocuments({ status: 'active' });
      const expiredRegions = await PlaceCacheRegion.countDocuments({ status: 'expired' });
      
      console.log('📊 REGION STATUS:');
      console.log('─────────────────────────────────────────────────────────');
      console.log(`   Active Regions:  ${activeRegions}`);
      console.log(`   Expired Regions: ${expiredRegions}`);
      console.log('');

      // Show sample regions
      console.log('🗺️  SAMPLE CACHED REGIONS (First 5):');
      console.log('─────────────────────────────────────────────────────────');
      const sampleRegions = await PlaceCacheRegion.find().limit(5).lean();
      
      sampleRegions.forEach((region, index) => {
        const isExpired = new Date(region.expiresAt) < new Date();
        const statusIcon = isExpired ? '❌' : '✅';
        
        console.log(`   ${index + 1}. ${statusIcon} Region at [${region.location.coordinates[1]}, ${region.location.coordinates[0]}]`);
        console.log(`      Radius: ${region.radiusMeters}m (${(region.radiusMeters / 1000).toFixed(1)}km)`);
        console.log(`      Categories: ${region.categories.join(', ')}`);
        console.log(`      Place Count: ${region.placeCount}`);
        console.log(`      Status: ${region.status}`);
        console.log(`      Cached At: ${new Date(region.cachedAt).toLocaleString()}`);
        console.log(`      Expires At: ${new Date(region.expiresAt).toLocaleString()}`);
        console.log(`      Refresh Count: ${region.refreshCount}`);
        console.log('');
      });
    }

    // ═══════════════════════════════════════════════════════════
    // 3. CHECK GEOSPATIAL INDEXES
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 CHECKING GEOSPATIAL INDEXES');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const placeIndexes = await Place.collection.getIndexes();
    const regionIndexes = await PlaceCacheRegion.collection.getIndexes();

    console.log('📍 Place Collection Indexes:');
    console.log('─────────────────────────────────────────────────────────');
    Object.keys(placeIndexes).forEach(indexName => {
      const indexDef = placeIndexes[indexName];
      console.log(`   ${indexName}:`, JSON.stringify(indexDef));
    });
    console.log('');

    console.log('🗺️  PlaceCacheRegion Collection Indexes:');
    console.log('─────────────────────────────────────────────────────────');
    Object.keys(regionIndexes).forEach(indexName => {
      const indexDef = regionIndexes[indexName];
      console.log(`   ${indexName}:`, JSON.stringify(indexDef));
    });
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // 4. SUMMARY & RECOMMENDATIONS
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 SUMMARY & RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (totalPlaces === 0 && totalRegions === 0) {
      console.log('❌ CACHING SYSTEM IS NOT WORKING!');
      console.log('');
      console.log('   Possible Issues:');
      console.log('   1. Frontend is not calling the backend cache endpoint');
      console.log('   2. Backend /api/places/cache endpoint is not working');
      console.log('   3. Geoapify API key is missing or invalid');
      console.log('   4. Network issues between frontend and backend');
      console.log('');
      console.log('   Next Steps:');
      console.log('   1. Check backend logs for errors');
      console.log('   2. Verify GEOAPIFY_API_KEY in .env file');
      console.log('   3. Test frontend API calls manually');
      console.log('   4. Check if /api/places/cache route is registered');
      console.log('');
    } else if (totalPlaces > 0 && totalRegions === 0) {
      console.log('⚠️  PARTIAL ISSUE: Places saved but no regions tracked');
      console.log('');
      console.log('   This means places are being saved but the region tracking');
      console.log('   is not working properly. This affects cache efficiency.');
      console.log('');
    } else if (totalPlaces === 0 && totalRegions > 0) {
      console.log('⚠️  UNUSUAL: Regions exist but no places saved');
      console.log('');
      console.log('   This is unusual. Places may have been deleted manually.');
      console.log('');
    } else {
      console.log('✅ CACHING SYSTEM IS WORKING!');
      console.log('');
      console.log(`   📊 ${totalPlaces} places cached across ${totalRegions} regions`);
      console.log('');
      
      if (stalePlaces > 0) {
        console.log(`   ⚠️  ${stalePlaces} stale places need refresh (>24hrs old)`);
        console.log('   Consider setting up a cron job for auto-refresh');
        console.log('');
      }
      
      if (expiredRegions > 0) {
        console.log(`   ⚠️  ${expiredRegions} expired regions need cleanup`);
        console.log('   Run: POST /api/places/cleanup');
        console.log('');
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ DIAGNOSTIC COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ ERROR RUNNING DIAGNOSTIC');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('');
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('📡 MongoDB connection closed');
    console.log('');
  }
}

// Helper function to get category icon
function getCategoryIcon(category) {
  const icons = {
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
  return icons[category] || '📍';
}

// Run the diagnostic
checkPlacesCache()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
