/**
 * MayaRequest — Maya-to-Maya requests (invites, location-share asks).
 * The friend always decides — nothing is ever accepted on their behalf.
 */
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');

const recipientSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'suggested', 'expired'],
    default: 'pending',
  },
  reply: { type: String, maxlength: 280 },
  suggestedTime: { type: Date },
  suggestedTimeText: { type: String, maxlength: 60 },
  respondedAt: { type: Date },
  nudgedAt: { type: Date },
}, { _id: false });

const mayaRequestSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, default: () => randomUUID() },
  fromUserId: { type: String, required: true, index: true },
  kind: {
    type: String,
    enum: ['invite', 'location_share'],
    required: true,
  },
  activity: {
    type: String,
    enum: ['coffee', 'lunch', 'dinner', 'movie', 'call', 'meet', 'custom'],
  },
  title: { type: String, maxlength: 80 },
  note: { type: String, maxlength: 280 },
  proposedTime: { type: Date },
  timeText: { type: String, maxlength: 60 },
  place: {
    label: { type: String, maxlength: 120 },
    lat: { type: Number },
    lng: { type: Number },
  },
  recipients: {
    type: [recipientSchema],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length >= 1 && arr.length <= 10,
      message: 'Recipients must contain between 1 and 10 entries',
    },
  },
  status: {
    type: String,
    enum: ['open', 'confirmed', 'cancelled', 'expired'],
    default: 'open',
  },
  confirmedTime: { type: Date },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

mayaRequestSchema.index({ fromUserId: 1, createdAt: -1 });
mayaRequestSchema.index({ 'recipients.userId': 1, status: 1, createdAt: -1 });
// TTL: keep the doc for 30 days after expiry, then let Mongo remove it.
mayaRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('MayaRequest', mayaRequestSchema);
