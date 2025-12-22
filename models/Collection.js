/**
 * Collection Model
 * Represents a collection of saved vibes
 */

const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  vibeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }],
  coverImage: {
    type: String,
    default: null
  },
  isPrivate: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for user collections
collectionSchema.index({ userId: 1, createdAt: -1 });

// Index for name search
collectionSchema.index({ userId: 1, name: 1 });

// Update updatedAt on save
collectionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Collection', collectionSchema);
