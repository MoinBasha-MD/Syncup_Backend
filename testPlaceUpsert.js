// Test script to identify the exact MongoDB conflict
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/syncup';

// Sample data from your logs
const samplePlace = {
  "geoapifyPlaceId": "51016d61cc4c975340594498397936723140f00103f901f85f5b480200000092030742617269737461",
  "name": "Barista",
  "category": "restaurants",
  "categoryName": "Restaurants",
  "location": {
    "type": "Point",
    "coordinates": [78.36406239999998, 17.446143700181224]
  },
  "address": {
    "formatted": "Barista, Gachibowli - Miyapur Highway, Kothaguda, Hyderabad - 500032, Telangana, India"
  },
  "contact": {},
  "icon": "🍽️",
  "color": "#FF6B6B",
  "geoapifyCategories": ["catering", "catering.cafe"]
};

async function testUpsert() {
  try {
    console.log('🔍 Testing Place upsert with sample data...\n');
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Import Place model
    const Place = require('./models/Place');

    console.log('📦 Sample data to insert:');
    console.log(JSON.stringify(samplePlace, null, 2));
    console.log('\n');

    // Test the upsert
    console.log('💾 Attempting upsert...\n');
    const result = await Place.upsertPlace(samplePlace);
    
    console.log('✅ SUCCESS! Place saved:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('\n❌ ERROR during upsert:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error codeName:', error.codeName);
    console.error('\nFull error:', error);
    
    if (error.message.includes('categories')) {
      console.error('\n🔍 ANALYSIS: Error mentions "categories"');
      console.error('   - Sample data has "category" (string):', samplePlace.category);
      console.error('   - Sample data has "geoapifyCategories" (array):', samplePlace.geoapifyCategories);
      console.error('   - MongoDB might be seeing a conflict somewhere');
    }
  } finally {
    await mongoose.connection.close();
    console.log('\n📡 MongoDB connection closed');
  }
}

testUpsert();
