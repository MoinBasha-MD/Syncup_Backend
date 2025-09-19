const mongoose = require('mongoose');

const statusHistorySchema = mongoose.Schema(
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
    duration: {
      type: Number, // Duration in minutes
      required: true,
    },
    // Location data for status history
    statusLocation: {
      placeName: {
        type: String,
        default: ''
      },
      coordinates: {
        latitude: {
          type: Number,
          min: -90,
          max: 90
        },
        longitude: {
          type: Number,
          min: -180,
          max: 180
        }
      },
      address: {
        type: String,
        default: ''
      },
      shareWithContacts: {
        type: Boolean,
        default: false
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
statusHistorySchema.index({ user: 1 }); // For user-based queries using MongoDB ObjectId
statusHistorySchema.index({ userId: 1 }); // For user-based queries using UUID
statusHistorySchema.index({ status: 1 }); // For status-based queries
statusHistorySchema.index({ startTime: -1 }); // For time-based queries, sorted by newest first
statusHistorySchema.index({ userId: 1, startTime: -1 }); // For user's history sorted by time
statusHistorySchema.index({ userId: 1, status: 1 }); // For user's history filtered by status

const StatusHistory = mongoose.model('StatusHistory', statusHistorySchema);

module.exports = StatusHistory;
