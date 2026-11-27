const mongoose = require('mongoose');
const { activeWindow, isValidTimezone } = require('../utils/primaryTimeClock');

const primaryTimeProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    required: true,
    trim: true,
  },
  days: {
    type: [Number],
    required: true,
    validate: {
      validator: function(days) {
        return days.every(day => day >= 0 && day <= 6);
      },
      message: 'Days must be between 0 (Sunday) and 6 (Saturday)',
    },
  },
  startTime: {
    type: String,
    required: true,
    validate: {
      validator: function(time) {
        return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
      },
      message: 'Start time must be in HH:MM format',
    },
  },
  endTime: {
    type: String,
    required: true,
    validate: {
      validator: function(time) {
        return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
      },
      message: 'End time must be in HH:MM format',
    },
  },
  location: {
    placeName: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    address: String,
  },
  timezoneOffset: {
    type: Number,
    default: 0, // Minutes offset from UTC (e.g., -330 for IST/UTC+05:30)
  },
  timezone: {
    type: String,
    default: null,
    validate: { validator: value => value == null || isValidTimezone(value), message: 'Invalid timezone' },
  },
  isEnabled: {
    type: Boolean,
    default: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  notifications: {
    beforeStart: {
      type: Boolean,
      default: true,
    },
    onStart: {
      type: Boolean,
      default: true,
    },
    onEnd: {
      type: Boolean,
      default: true,
    },
  },
  recurrence: {
    type: {
      type: String,
      enum: ['weekly', 'date_range'],
      default: 'weekly',
    },
    startDate: Date,
    endDate: Date,
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10,
  },
  // 'calendar-sync' marks profiles upserted by calendar recurrence
  // detection — only those are safe to overwrite on later syncs.
  // 'autobot' marks routines the on-device Autobot learned and owns.
  source: {
    type: String,
    enum: ['manual', 'calendar-sync', 'autobot'],
    default: 'manual',
    index: true,
  },
  // Start of the window the owner was last warned about (one warning per window).
  headsUpFor: {
    type: Date,
    default: null,
  },
  // The scheduler ignores the profile until this instant ("skip this time").
  skipUntil: {
    type: Date,
    default: null,
  },
  // Autobot only: window starts already handled, so each happens once per window.
  precheckFor: { type: Date, default: null }, // phone asked to check "away" before the warning
  deferredFor: { type: Date, default: null }, // told the user Autobot waits for a running status
  // Autobot only: when the user's own status that interrupted the routine runs out.
  resumeAfter: { type: Date, default: null },
  patternKey: {
    type: String,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
primaryTimeProfileSchema.index({ userId: 1, isActive: 1 });
primaryTimeProfileSchema.index({ userId: 1, isEnabled: 1 });
primaryTimeProfileSchema.index({ userId: 1, days: 1 });

// Method to check if profile should be active at a given time
primaryTimeProfileSchema.methods.shouldBeActive = function(date = new Date()) {
  // Convert UTC to the profile's local time, accounting for timezone transitions.
  // Check date range if applicable.
  // Overnight windows are associated with the day on which they start.
  return Boolean(activeWindow(this, date));
};

const PrimaryTimeProfile = mongoose.model('PrimaryTimeProfile', primaryTimeProfileSchema);

module.exports = PrimaryTimeProfile;
