const mongoose = require('mongoose');

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
}, {
  timestamps: true,
});

// Index for efficient queries
primaryTimeProfileSchema.index({ userId: 1, isActive: 1 });
primaryTimeProfileSchema.index({ userId: 1, days: 1 });

// Method to check if profile should be active at a given time
primaryTimeProfileSchema.methods.shouldBeActive = function(date = new Date()) {
  const currentDay = date.getDay();
  const currentTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  // Check if today is in the days array
  if (!this.days.includes(currentDay)) {
    return false;
  }

  // Check date range if applicable
  if (this.recurrence.type === 'date_range') {
    if (this.recurrence.startDate && date < this.recurrence.startDate) {
      return false;
    }
    if (this.recurrence.endDate && date > this.recurrence.endDate) {
      return false;
    }
  }

  // Check time range
  return currentTime >= this.startTime && currentTime < this.endTime;
};

const PrimaryTimeProfile = mongoose.model('PrimaryTimeProfile', primaryTimeProfileSchema);

module.exports = PrimaryTimeProfile;
