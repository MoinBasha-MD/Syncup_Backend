// Place Model - For caching nearby places from Geoapify
const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema({
  // Unique identifiers
  geoapifyPlaceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Basic information
  name: {
    type: String,
    required: true,
    index: true
  },
  category: {
    type: String,
    required: true,
    index: true
  },
  categoryName: {
    type: String,
    required: true
  },
  
  // Location data
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: '2dsphere' // Geospatial index for nearby queries
    }
  },
  
  // Address information
  address: {
    formatted: String,
    street: String,
    houseNumber: String,
    city: String,
    state: String,
    country: String,
    postalCode: String
  },
  
  // Contact information
  contact: {
    phone: String,
    website: String,
    email: String
  },
  
  // Visual data
  icon: {
    type: String,
    default: '📍'
  },
  color: {
    type: String,
    default: '#999999'
  },
  
  // Geoapify specific data
  geoapifyCategories: [String],
  openingHours: mongoose.Schema.Types.Mixed,
  
  // Cache metadata
  cacheMetadata: {
    firstCachedAt: {
      type: Date,
      default: Date.now
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    },
    lastVerifiedAt: {
      type: Date,
      default: Date.now
    },
    updateCount: {
      type: Number,
      default: 0
    },
    source: {
      type: String,
      enum: ['geoapify', 'manual', 'user_contribution'],
      default: 'geoapify'
    }
  },
  
  // Quality metrics
  qualityScore: {
    type: Number,
    default: 1.0,
    min: 0,
    max: 1
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for performance
placeSchema.index({ 'location': '2dsphere' });
placeSchema.index({ category: 1, 'location': '2dsphere' });
placeSchema.index({ 'cacheMetadata.lastUpdatedAt': 1 });
placeSchema.index({ geoapifyPlaceId: 1 }, { unique: true });

// Methods
placeSchema.methods.isStale = function(maxAgeHours = 24) {
  const ageInHours = (Date.now() - this.cacheMetadata.lastUpdatedAt) / (1000 * 60 * 60);
  return ageInHours > maxAgeHours;
};

placeSchema.methods.updateCache = function() {
  this.cacheMetadata.lastUpdatedAt = new Date();
  this.cacheMetadata.updateCount += 1;
  return this.save();
};

// Static methods
placeSchema.statics.findNearby = function(longitude, latitude, radiusMeters = 3000, categories = []) {
  const query = {
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusMeters
      }
    }
  };
  
  if (categories && categories.length > 0) {
    query.category = { $in: categories };
  }
  
  return this.find(query).limit(100);
};

placeSchema.statics.findStale = function(maxAgeHours = 24) {
  const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  return this.find({
    'cacheMetadata.lastUpdatedAt': { $lt: cutoffDate }
  });
};

placeSchema.statics.upsertPlace = async function(placeData) {
  const filter = { geoapifyPlaceId: placeData.geoapifyPlaceId };
  
  // Separate the data to avoid conflicts
  // Remove any fields that might conflict with $inc or $setOnInsert
  const dataToSet = { ...placeData };
  delete dataToSet.cacheMetadata; // Don't set this directly, handle it separately
  
  const update = {
    $set: {
      ...dataToSet,
      'cacheMetadata.lastUpdatedAt': new Date(),
      'cacheMetadata.lastVerifiedAt': new Date()
    },
    $inc: { 'cacheMetadata.updateCount': 1 },
    $setOnInsert: { 
      'cacheMetadata.firstCachedAt': new Date(),
      'cacheMetadata.source': 'geoapify'
    }
  };
  
  const options = { 
    upsert: true, 
    new: true, 
    setDefaultsOnInsert: true,
    // Force write concern to ensure data persistence (w:1 for standalone MongoDB)
    writeConcern: { w: 1, j: true }
  };
  
  return this.findOneAndUpdate(filter, update, options);
};

const Place = mongoose.model('Place', placeSchema);

module.exports = Place;
