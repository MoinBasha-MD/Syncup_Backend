const mongoose = require('mongoose');

const statusScheduleSchema = mongoose.Schema(
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
    status: {
      type: String,
      required: true,
    },
    customStatus: {
      type: String,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    repeat: {
      type: String,
      enum: ['none', 'daily', 'weekdays', 'weekends', 'weekly', 'biweekly', 'monthly', 'custom_days', 'work_schedule'],
      default: 'none',
    },
    active: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: null,
    },
    
    // 🆕 Enhanced Recurring Patterns
    recurrenceConfig: {
      daysOfWeek: [Number], // [0,1,2,3,4,5,6] Sunday=0
      interval: { type: Number, default: 1 }, // Every N days/weeks/months
      endDate: Date,
      maxOccurrences: Number,
      exceptions: [Date] // Skip these specific dates
    },
    
    // 🆕 Calendar Integration
    calendarEventId: String,
    calendarSource: { 
      type: String, 
      enum: ['manual', 'google', 'outlook', 'apple', 'system'],
      default: 'manual'
    },
    autoCreatedFromCalendar: { type: Boolean, default: false },
    
    // 🆕 Template System
    templateId: String,
    templateName: String,
    isTemplate: { type: Boolean, default: false },
    templateCategory: {
      type: String,
      enum: ['work', 'personal', 'health', 'travel', 'emergency', 'custom'],
      default: 'custom'
    },
    
    // 🆕 Analytics & Tracking
    actualStartTime: Date, // When status was actually applied
    actualEndTime: Date, // When status actually ended
    wasAutoApplied: { type: Boolean, default: false },
    appliedBy: {
      type: String,
      enum: ['user', 'calendar', 'location', 'ai_suggestion', 'template'],
      default: 'user'
    },
    
    // 🆕 Smart Features
    priority: { type: Number, default: 0 }, // Higher number = higher priority for conflicts
    tags: [String], // For categorization and search
    color: String, // For UI customization
    
    // 🆕 Usage Statistics
    usageCount: { type: Number, default: 0 },
    lastUsed: Date,
    averageDuration: Number, // In minutes
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
statusScheduleSchema.index({ user: 1 }); // For user-based queries using MongoDB ObjectId
statusScheduleSchema.index({ userId: 1 }); // For user-based queries using UUID
statusScheduleSchema.index({ active: 1 }); // For active/inactive queries
statusScheduleSchema.index({ startTime: 1 }); // For time-based queries
statusScheduleSchema.index({ userId: 1, active: 1 }); // For user's active schedules
statusScheduleSchema.index({ userId: 1, active: 1, startTime: 1 }); // For user's active schedules sorted by time
statusScheduleSchema.index({ repeat: 1 }); // For recurring schedule queries

// 🆕 Enhanced indexes for new features
statusScheduleSchema.index({ isTemplate: 1, templateCategory: 1 }); // For template queries
statusScheduleSchema.index({ calendarEventId: 1 }); // For calendar integration
statusScheduleSchema.index({ tags: 1 }); // For tag-based searches
statusScheduleSchema.index({ userId: 1, templateCategory: 1 }); // For user's templates by category
statusScheduleSchema.index({ userId: 1, usageCount: -1 }); // For popular templates
statusScheduleSchema.index({ appliedBy: 1, createdAt: -1 }); // For analytics

const StatusSchedule = mongoose.model('StatusSchedule', statusScheduleSchema);

module.exports = StatusSchedule;
