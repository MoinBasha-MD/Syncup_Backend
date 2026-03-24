const mongoose = require('mongoose');

/**
 * Public Status Cache Model
 * Stores public statuses for fast dial pad lookups without hitting main User collection
 * Only contains users who have enabled "Public Status" in privacy settings
 */
const publicStatusCacheSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Current status info (minimal, no PII)
    status: {
      type: String,
      default: 'Available',
    },
    customStatus: {
      type: String,
      default: '',
    },
    mainStatus: {
      type: String,
      default: null,
    },
    subStatus: {
      type: String,
      default: null,
    },
    statusUntil: {
      type: Date,
      default: null,
    },
    mainEndTime: {
      type: Date,
      default: null,
    },
    subEndTime: {
      type: Date,
      default: null,
    },
    // Metadata
    lastUpdated: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for performance
publicStatusCacheSchema.index({ phoneNumber: 1, isActive: 1 });
publicStatusCacheSchema.index({ userId: 1, isActive: 1 });
publicStatusCacheSchema.index({ statusUntil: 1 }); // For expiry cleanup

// Static method: Upsert user's public status
publicStatusCacheSchema.statics.upsertPublicStatus = async function(userId, phoneNumber, statusData) {
  try {
    const {
      status,
      customStatus,
      mainStatus,
      subStatus,
      statusUntil,
      mainEndTime,
      subEndTime,
    } = statusData;

    // Normalize phone number
    const normalizedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

    await this.findOneAndUpdate(
      { phoneNumber: normalizedPhone },
      {
        userId,
        phoneNumber: normalizedPhone,
        status: status || 'Available',
        customStatus: customStatus || '',
        mainStatus: mainStatus || null,
        subStatus: subStatus || null,
        statusUntil: statusUntil || null,
        mainEndTime: mainEndTime || null,
        subEndTime: subEndTime || null,
        lastUpdated: new Date(),
        isActive: true,
      },
      { upsert: true, new: true }
    );

    console.log(`✅ [PUBLIC STATUS CACHE] Updated cache for phone: ${normalizedPhone}`);
    return true;
  } catch (error) {
    console.error('❌ [PUBLIC STATUS CACHE] Error upserting:', error);
    return false;
  }
};

// Static method: Remove user from cache (when toggle disabled)
publicStatusCacheSchema.statics.removePublicStatus = async function(phoneNumber) {
  try {
    const normalizedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    await this.deleteOne({ phoneNumber: normalizedPhone });
    console.log(`✅ [PUBLIC STATUS CACHE] Removed cache for phone: ${normalizedPhone}`);
    return true;
  } catch (error) {
    console.error('❌ [PUBLIC STATUS CACHE] Error removing:', error);
    return false;
  }
};

// Static method: Get public status by phone number
publicStatusCacheSchema.statics.getPublicStatus = async function(phoneNumber) {
  try {
    const normalizedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    
    const cached = await this.findOne({ 
      phoneNumber: normalizedPhone,
      isActive: true,
    });

    if (!cached) {
      return null;
    }

    // Check if status expired
    const now = new Date();
    if (cached.statusUntil && new Date(cached.statusUntil) <= now) {
      // Status expired, return "Available"
      return {
        status: 'Available',
        customStatus: '',
        mainStatus: null,
        subStatus: null,
        isExpired: true,
      };
    }

    return {
      status: cached.status,
      customStatus: cached.customStatus,
      mainStatus: cached.mainStatus,
      subStatus: cached.subStatus,
      statusUntil: cached.statusUntil,
      mainEndTime: cached.mainEndTime,
      subEndTime: cached.subEndTime,
      lastUpdated: cached.lastUpdated,
      isExpired: false,
    };
  } catch (error) {
    console.error('❌ [PUBLIC STATUS CACHE] Error fetching:', error);
    return null;
  }
};

// Static method: Cleanup expired statuses (cron job)
publicStatusCacheSchema.statics.cleanupExpired = async function() {
  try {
    const now = new Date();
    const result = await this.deleteMany({
      statusUntil: { $lte: now },
    });
    
    if (result.deletedCount > 0) {
      console.log(`🧹 [PUBLIC STATUS CACHE] Cleaned up ${result.deletedCount} expired entries`);
    }
    
    return result.deletedCount;
  } catch (error) {
    console.error('❌ [PUBLIC STATUS CACHE] Error cleaning up:', error);
    return 0;
  }
};

const PublicStatusCache = mongoose.model('PublicStatusCache', publicStatusCacheSchema);

module.exports = PublicStatusCache;
