const mongoose = require('mongoose');

const jobRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['success', 'failure', 'running'], default: null },
    lastError: { type: String, default: null },
    lastDurationMs: { type: Number, default: null },
  },
  { versionKey: false },
);

module.exports = mongoose.model('JobRun', jobRunSchema);
