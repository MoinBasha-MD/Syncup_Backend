/**
 * Meetup Model
 *
 * A shared destination with a group of friends who mutually live-track
 * each other until the host ends the meetup ("let's all meet at X",
 * Uber-style convergence).
 *
 * userId fields are the app's public UUID strings (User.userId), matching
 * what socketManager keys userSockets by and what the frontend sends.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const ARRIVAL_RADIUS_METERS = 100;

const meetupParticipantSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  name: { type: String, default: '' },
  profileImage: { type: String, default: null },
  status: {
    type: String,
    enum: ['invited', 'accepted', 'declined', 'arrived', 'left'],
    default: 'invited'
  },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
  arrivedAt: { type: Date },
  lastLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    timestamp: { type: Number },
    speed: { type: Number },
    updatedAt: { type: Date }
  }
}, { _id: false });

const meetupSchema = new mongoose.Schema({
  hostId: {
    type: String,
    required: true,
    index: true
  },
  hostName: { type: String, default: '' },
  destination: {
    name: { type: String, required: true },
    address: { type: String, default: '' },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    placeId: { type: String, default: null }
  },
  participants: [meetupParticipantSchema],
  status: {
    type: String,
    enum: ['active', 'ended'],
    default: 'active',
    index: true
  },
  // Token embedded in syncup://meetup/<token> share links — joiners are
  // accepted implicitly since possessing the link is the invite.
  inviteToken: {
    type: String,
    required: true,
    unique: true,
    default: () => crypto.randomBytes(16).toString('hex')
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  endedAt: { type: Date }
}, {
  timestamps: true
});

meetupSchema.index({ 'participants.userId': 1, status: 1 });

meetupSchema.methods.findParticipant = function (userId) {
  return this.participants.find(p => p.userId === userId);
};

meetupSchema.methods.isHost = function (userId) {
  return this.hostId === userId;
};

// Participants whose live location is currently being shared with the group
meetupSchema.methods.trackedUserIds = function () {
  return this.participants
    .filter(p => p.status === 'accepted' || p.status === 'arrived')
    .map(p => p.userId);
};

const Meetup = mongoose.model('Meetup', meetupSchema);

module.exports = Meetup;
module.exports.ARRIVAL_RADIUS_METERS = ARRIVAL_RADIUS_METERS;
