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
      enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'],
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

const StatusSchedule = mongoose.model('StatusSchedule', statusScheduleSchema);

module.exports = StatusSchedule;
