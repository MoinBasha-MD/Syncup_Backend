// Place Cache Region Model - Track which areas have been cached
const mongoose = require('mongoose');

const placeCacheRegionSchema = new mongoose.Schema({
  // Region center point
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
      index: '2dsphere'
    }
  },
  
  // Region parameters
  radiusMeters: {
    type: Number,
    required: true,
    default: 3000
  },
  
  // Categories cached in this region
  categories: {
    type: [String],
    required: true,
    index: true
  },
  
  // Cache statistics
  placeCount: {
    type: Number,
    default: 0
  },
  
  // Cache timing
  cachedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  
  // Update tracking
  lastRefreshedAt: {
    type: Date,
    default: Date.now
  },
  refreshCount: {
    type: Number,
    default: 0
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'expired', 'refreshing'],
    default: 'active',
    index: true
  },
  
  // Source tracking
  source: {
    type: String,
    enum: ['geoapify', 'manual'],
    default: 'geoapify'
  }
}, {
  timestamps: true
});

// Indexes
placeCacheRegionSchema.index({ 'location': '2dsphere' });
placeCacheRegionSchema.index({ categories: 1, status: 1 });
placeCacheRegionSchema.index({ expiresAt: 1 });

// Methods
placeCacheRegionSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt;
};

placeCacheRegionSchema.methods.refresh = async function() {
  this.status = 'refreshing';
  await this.save();
};

placeCacheRegionSchema.methods.markComplete = async function(placeCount) {
  this.status = 'active';
  this.placeCount = placeCount;
  this.lastRefreshedAt = new Date();
  this.refreshCount += 1;
  this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await this.save();
};

// Static methods
placeCacheRegionSchema.statics.findCachedRegion = function(longitude, latitude, radiusMeters, categories) {
  const maxDistance = radiusMeters * 1.5; // Allow 50% overlap
  
  return this.findOne({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    radiusMeters: { $gte: radiusMeters * 0.8, $lte: radiusMeters * 1.2 },
    categories: { $all: categories },
    status: 'active',
    expiresAt: { $gt: new Date() }
  });
};

placeCacheRegionSchema.statics.createOrUpdate = async function(longitude, latitude, radiusMeters, categories, placeCount) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  const filter = {
    'location.coordinates': [longitude, latitude],
    radiusMeters: radiusMeters,
    categories: { $all: categories, $size: categories.length }
  };
  
  const update = {
    $set: {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      radiusMeters,
      categories,
      placeCount,
      expiresAt,
      lastRefreshedAt: new Date(),
      status: 'active'
    },
    $inc: { refreshCount: 1 },
    $setOnInsert: { cachedAt: new Date() }
  };
  
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  
  return this.findOneAndUpdate(filter, update, options);
};

placeCacheRegionSchema.statics.cleanupExpired = function() {
  return this.updateMany(
    { expiresAt: { $lt: new Date() }, status: 'active' },
    { $set: { status: 'expired' } }
  );
};

const PlaceCacheRegion = mongoose.model('PlaceCacheRegion', placeCacheRegionSchema);

module.exports = PlaceCacheRegion;
