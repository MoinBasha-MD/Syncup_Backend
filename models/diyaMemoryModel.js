const mongoose = require('mongoose');

const MemoryEntrySchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    entities: { type: Object },
    intent: { type: String },
    tone: { type: Object },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const DiyaMemorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    summary: { type: String, default: '' },
    entries: { type: [MemoryEntrySchema], default: [] },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

DiyaMemorySchema.index({ userId: 1, conversationId: 1 }, { unique: true });

module.exports = mongoose.model('DiyaMemory', DiyaMemorySchema);
