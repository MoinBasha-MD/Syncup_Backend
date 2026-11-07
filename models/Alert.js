const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning', index: true },
    source: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'resolved'],
      default: 'open',
      index: true,
    },
    ackedBy: { type: String, default: null },
    ackedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

alertSchema.index({ dedupeKey: 1, createdAt: -1 });
alertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
