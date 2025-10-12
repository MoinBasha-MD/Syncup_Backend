const mongoose = require('mongoose');

const storyViewSchema = new mongoose.Schema({
  storyId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  userName: {
    type: String,
    required: true,
  },
  userProfileImage: {
    type: String,
    default: null,
  },
  viewedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

// Compound index to prevent duplicate views and optimize queries
storyViewSchema.index({ storyId: 1, userId: 1 }, { unique: true });

// Index for cleanup queries
storyViewSchema.index({ viewedAt: 1 });

const StoryView = mongoose.model('StoryView', storyViewSchema);

module.exports = StoryView;
