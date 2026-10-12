const mongoose = require('mongoose');

/**
 * Group call — LiveKit SFU room + per-participant invite lifecycle.
 * Media is E2EE: every invitee's sealed call key lives on their participant
 * row (e2eeEnvelope + callNonce) so a rejoin/resume re-serves it.
 */
const groupCallParticipantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: String,
  avatar: String,
  status: {
    type: String,
    enum: ['invited', 'joined', 'left', 'declined', 'missed'],
    default: 'invited',
  },
  invitedBy: String,
  invitedAt: { type: Date, default: Date.now },
  joinedAt: Date,
  leftAt: Date,
  // E2EE v2 envelope sealing the shared call key for THIS user, plus the
  // nonce binding it — per-invitee so only they can unwrap.
  e2eeEnvelope: { type: mongoose.Schema.Types.Mixed },
  callNonce: String,
}, { _id: false });

const groupCallSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true, index: true },
  roomName: { type: String, required: true },
  callType: { type: String, enum: ['voice', 'video'], required: true },
  hostId: { type: String, required: true, index: true },
  /** Optional chat-group the call belongs to. */
  groupId: { type: String, default: null, index: true },
  status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
  participants: [groupCallParticipantSchema],
  endedAt: Date,
}, { timestamps: true });

groupCallSchema.index({ 'participants.userId': 1, 'participants.status': 1 });
groupCallSchema.index({ status: 1, groupId: 1 });

module.exports = mongoose.model('GroupCall', groupCallSchema);
