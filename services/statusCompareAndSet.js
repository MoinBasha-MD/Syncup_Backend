const User = require('../models/userModel');

const fields = [
  'status', 'customStatus', 'statusUpdatedAt', 'statusUntil', 'wasAutoApplied',
  'primaryTimeProfileId', 'mainStatus', 'mainDuration', 'mainDurationLabel',
  'mainStartTime', 'mainEndTime', 'subStatus', 'subDuration', 'subDurationLabel',
  'subStartTime', 'subEndTime', 'statusLocation', 'previousStatus', 'previousStatusEndTime',
];

module.exports = function saveStatusIfUnchanged(user, extraFilter = {}, now = new Date()) {
  const changes = Object.fromEntries(fields.filter(field => user[field] !== undefined).map(field => [field, user[field]]));
  changes.statusChangedAt = now;
  return User.findOneAndUpdate(
    { _id: user._id, statusChangedAt: user.statusChangedAt || null, ...extraFilter },
    { $set: changes },
    { new: true }
  );
};
