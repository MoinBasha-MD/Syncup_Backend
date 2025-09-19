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

const StatusTemplate = mongoose.model('StatusTemplate', statusTemplateSchema);

module.exports = StatusTemplate;
