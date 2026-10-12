const mongoose = require('mongoose');

const externalCalendarEventSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CalendarAccount',
      default: null,
    },
    // e.g. 'google', 'google-email', 'microsoft', 'microsoft-email', 'imap', 'device'
    source: {
      type: String,
      required: true,
    },
    externalId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String, default: '' },
    description: { type: String, default: '' },
    recurrenceRule: { type: String, default: null },
    origin: {
      type: String,
      enum: ['calendar', 'email', 'device'],
      default: 'calendar',
    },
    cancelled: { type: Boolean, default: false },
    mappedStatus: {
      status: String,
      customStatus: String,
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StatusSchedule',
      default: null,
    },
  },
  { timestamps: true }
);

externalCalendarEventSchema.index({ userId: 1, source: 1, externalId: 1 }, { unique: true });
externalCalendarEventSchema.index({ userId: 1, start: 1, end: 1 });
externalCalendarEventSchema.index({ accountId: 1 });

module.exports = mongoose.model('ExternalCalendarEvent', externalCalendarEventSchema);
