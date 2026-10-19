const mongoose = require('mongoose');

/**
 * Key/value system settings. Known keys:
 *   'maintenance' -> { enabled, message, until, allowUserIds: [] }
 *   'flags'       -> { [flagName]: boolean|string|number }
 */
const systemSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  updatedBy: String,
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

systemSettingSchema.statics.getValue = async function(key, fallback = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : fallback;
};

systemSettingSchema.statics.setValue = async function(key, value, updatedBy = null) {
  return this.findOneAndUpdate(
    { key },
    { $set: { value, updatedBy, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
