const mongoose = require('mongoose');

/**
 * Append-only, hash-chained audit log for admin actions.
 * `hash = sha256(prevHash + canonicalJSON(entry))` — see services/adminAudit.
 */
const adminAuditLogSchema = new mongoose.Schema({
  seq: {
    type: Number,
    required: true
  },
  at: {
    type: Date,
    required: true,
    default: Date.now
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId
  },
  adminUsername: String,
  adminRole: String,
  deviceId: String,
  ip: String,
  action: {
    type: String,
    required: true
  },
  targetType: String,
  targetId: String,
  reason: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  result: {
    type: String,
    enum: ['success', 'failure']
  },
  meta: mongoose.Schema.Types.Mixed,
  prevHash: String,
  hash: String
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

adminAuditLogSchema.index({ seq: 1 }, { unique: true });

// Append-only: every update/delete operation is refused
const appendOnlyError = () => new Error('AdminAuditLog is append-only');

adminAuditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndRemove', 'deleteMany', 'replaceOne'], function(next) {
  next(appendOnlyError());
});
adminAuditLogSchema.pre(['deleteOne', 'remove'], { document: true, query: true }, function(next) {
  next(appendOnlyError());
});

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
