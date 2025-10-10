const mongoose = require('mongoose');

const statusTemplateSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    customStatus: {
      type: String,
    },
    duration: {
      type: Number, // Duration in minutes
      required: true,
    },
    
    // 🆕 Enhanced Template Features
    category: {
      type: String,
      enum: ['work', 'personal', 'health', 'travel', 'emergency', 'custom'],
      default: 'custom'
    },
    icon: String, // Icon name for UI
    color: String, // Color code for UI
    description: String,
    tags: [String], // For categorization and search
    
    // 🆕 Quick Schedule Options
    quickSchedule: {
      todayAt: String, // "14:00"
      tomorrowAt: String, // "09:00"
      nextWeekdays: String, // "09:00-17:00"
      defaultDays: [Number] // [1,2,3,4,5] for weekdays
    },
    
    // 🆕 Usage Statistics
    usageCount: { type: Number, default: 0 },
    lastUsed: Date,
    isSystemTemplate: { type: Boolean, default: false }, // Pre-built templates
    isPublic: { type: Boolean, default: false }, // Can be shared with other users
    
    // 🆕 Smart Features
    autoTriggers: {
      calendarKeywords: [String], // Auto-apply when calendar event contains these words
      timePatterns: [String], // Auto-suggest at certain times
      locationTriggers: [String] // Auto-apply at certain locations
    }
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
statusTemplateSchema.index({ user: 1 }); // For user-based queries using MongoDB ObjectId
statusTemplateSchema.index({ userId: 1 }); // For user-based queries using UUID
statusTemplateSchema.index({ userId: 1, name: 1 }); // For user's templates with specific names
statusTemplateSchema.index({ userId: 1, status: 1 }); // For user's templates with specific status

// 🆕 Enhanced indexes for new features
statusTemplateSchema.index({ category: 1 }); // For category-based queries
statusTemplateSchema.index({ isSystemTemplate: 1, category: 1 }); // For system templates
statusTemplateSchema.index({ userId: 1, category: 1 }); // For user's templates by category
statusTemplateSchema.index({ userId: 1, usageCount: -1 }); // For popular templates
statusTemplateSchema.index({ tags: 1 }); // For tag-based searches
statusTemplateSchema.index({ isPublic: 1, usageCount: -1 }); // For public popular templates

const StatusTemplate = mongoose.model('StatusTemplate', statusTemplateSchema);

module.exports = StatusTemplate;
