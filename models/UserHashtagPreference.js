/**
 * UserHashtagPreference Model
 * Learns and stores user's hashtag interests based on interactions
 */

const mongoose = require('mongoose');

const userHashtagPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  hashtag: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  score: {
    type: Number,
    default: 0,
    index: true
  },
  interactionCount: {
    type: Number,
    default: 0
  },
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  decayFactor: {
    type: Number,
    default: 1.0,
    min: 0,
    max: 1
  },
  isCoreInterest: {
    type: Boolean,
    default: false,
    index: true
  },
  firstInteraction: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound indexes
userHashtagPreferenceSchema.index({ userId: 1, score: -1 });
userHashtagPreferenceSchema.index({ userId: 1, hashtag: 1 }, { unique: true });
userHashtagPreferenceSchema.index({ hashtag: 1, score: -1 });

// Apply time decay to score (30-day half-life)
// ENHANCED: Core interests don't decay
userHashtagPreferenceSchema.methods.applyDecay = function() {
  // Skip decay for core interests
  if (this.isCoreInterest) {
    console.log(`🔒 [HASHTAG PREF] Skipping decay for core interest: ${this.hashtag}`);
    return Promise.resolve(this);
  }
  
  const daysSinceLastInteraction = (Date.now() - this.lastInteraction) / (1000 * 60 * 60 * 24);
  const halfLifeDays = 30;
  
  // Exponential decay: score * (0.5 ^ (days / halfLife))
  this.decayFactor = Math.pow(0.5, daysSinceLastInteraction / halfLifeDays);
  this.score = this.score * this.decayFactor;
  
  return this.save();
};

// Add interaction to hashtag preference
// ENHANCED: Auto-promote to core interest if strong engagement
userHashtagPreferenceSchema.methods.addInteraction = function(engagementScore) {
  this.score += engagementScore;
  this.interactionCount += 1;
  this.lastInteraction = new Date();
  this.decayFactor = 1.0; // Reset decay on new interaction
  
  // Auto-promote to core interest if:
  // - Score > 100 (lots of engagement)
  // - OR 10+ interactions
  // - OR consistent engagement over 7+ days
  const daysSinceFirst = (Date.now() - this.firstInteraction) / (1000 * 60 * 60 * 24);
  
  if (!this.isCoreInterest) {
    if (this.score > 100 || this.interactionCount >= 10 || (daysSinceFirst >= 7 && this.interactionCount >= 5)) {
      this.isCoreInterest = true;
      console.log(`⭐ [HASHTAG PREF] Promoted to core interest: ${this.hashtag} (score: ${this.score}, interactions: ${this.interactionCount})`);
    }
  }
  
  return this.save();
};

// Static method to get user's top hashtags
userHashtagPreferenceSchema.statics.getTopHashtags = function(userId, limit = 50) {
  return this.find({ userId })
    .sort({ score: -1 })
    .limit(limit)
    .lean();
};

// Static method to get or create hashtag preference
userHashtagPreferenceSchema.statics.getOrCreate = async function(userId, hashtag) {
  let preference = await this.findOne({ userId, hashtag });
  
  if (!preference) {
    preference = await this.create({
      userId,
      hashtag,
      score: 0,
      interactionCount: 0
    });
  }
  
  return preference;
};

// Static method to update preferences from interaction
userHashtagPreferenceSchema.statics.updateFromInteraction = async function(userId, hashtags, engagementScore) {
  if (!hashtags || hashtags.length === 0) return;
  
  const updates = hashtags.map(async (hashtag) => {
    const preference = await this.getOrCreate(userId, hashtag);
    return preference.addInteraction(engagementScore);
  });
  
  return Promise.all(updates);
};

// Static method to apply decay to all user preferences
userHashtagPreferenceSchema.statics.applyDecayToUser = async function(userId) {
  const preferences = await this.find({ userId });
  
  const updates = preferences.map(pref => pref.applyDecay());
  
  return Promise.all(updates);
};

// Static method to get hashtag match score for user
userHashtagPreferenceSchema.statics.calculateHashtagMatchScore = async function(userId, postHashtags) {
  if (!postHashtags || postHashtags.length === 0) return 0;
  
  const userPreferences = await this.getTopHashtags(userId, 50);
  
  if (userPreferences.length === 0) return 0;
  
  let matchScore = 0;
  
  postHashtags.forEach(hashtag => {
    const index = userPreferences.findIndex(pref => pref.hashtag === hashtag.toLowerCase());
    
    if (index !== -1) {
      // Top 10: 20 points, Top 20: 10 points, Top 50: 5 points
      if (index < 10) matchScore += 20;
      else if (index < 20) matchScore += 10;
      else matchScore += 5;
    }
  });
  
  // Cap at 100
  return Math.min(matchScore, 100);
};

// Static method to get trending hashtags globally
userHashtagPreferenceSchema.statics.getTrendingHashtags = async function(limit = 20, days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const trending = await this.aggregate([
    {
      $match: {
        lastInteraction: { $gte: cutoffDate }
      }
    },
    {
      $group: {
        _id: '$hashtag',
        totalScore: { $sum: '$score' },
        userCount: { $sum: 1 }
      }
    },
    {
      $sort: { totalScore: -1 }
    },
    {
      $limit: limit
    }
  ]);
  
  return trending.map(t => ({
    hashtag: t._id,
    score: t.totalScore,
    userCount: t.userCount
  }));
};

module.exports = mongoose.model('UserHashtagPreference', userHashtagPreferenceSchema);
