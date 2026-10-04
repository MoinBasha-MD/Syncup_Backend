const Meetup = require('../models/Meetup');
const User = require('../models/userModel');
const Friend = require('../models/Friend');
const { dispatchNotification } = require('../services/notificationDispatcher');
// Lazy require to break circular dependency with socketManager
const getSocketManager = () => require('../socketManager');

const DEFAULT_EXPIRY_HOURS = 4;
const MAX_EXPIRY_HOURS = 12;
const MAX_PARTICIPANTS = 50;

const buildInviteLink = (meetup) => `syncup://meetup/${meetup.inviteToken}`;

// Works for both Mongoose docs and lean objects — `id` is always a string
// because the app keys every meetup on `meetup.id` (lean `_id` alone is not
// enough and silently becomes undefined client-side).
const serializeMeetup = (meetup) => ({
  id: String(meetup._id),
  hostId: meetup.hostId,
  hostName: meetup.hostName,
  destination: meetup.destination,
  participants: meetup.participants,
  status: meetup.status,
  inviteToken: meetup.inviteToken,
  inviteLink: buildInviteLink(meetup),
  expiresAt: meetup.expiresAt,
  createdAt: meetup.createdAt
});

// Push a meetup event to every participant (host is a participant too)
const broadcastToMeetup = (meetup, event, data) => {
  const { broadcastToUser } = getSocketManager();
  meetup.participants.forEach(p => {
    try {
      broadcastToUser(p.userId, event, {
        meetupId: meetup._id.toString(),
        ...data
      });
    } catch (error) {
      console.error(`❌ [MEETUP] Failed to emit ${event} to ${p.userId}:`, error);
    }
  });
};

// Socket event + v2 envelope notification for a meetup invite. Fire-and-
// forget — never block the HTTP response on notification delivery.
const notifyInvite = (meetup, invitee, hostProfileImage) => {
  const meetupId = meetup._id.toString();
  const action = {
    screen: 'Home',
    params: { screen: 'Map', params: { meetupInviteId: meetupId, inviteToken: meetup.inviteToken } }
  };

  try {
    const { broadcastToUser } = getSocketManager();
    broadcastToUser(invitee.userId, 'meetup:invite', {
      meetup: serializeMeetup(meetup),
      type: 'meetup_invite',
      meetupId,
      inviteToken: meetup.inviteToken,
      destinationName: meetup.destination.name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ [MEETUP] Invite socket emit failed:', error);
  }

  dispatchNotification({
    toUserId: invitee.userId,
    fromUserId: meetup.hostId,
    type: 'meetup_invite',
    category: 'social',
    title: `${meetup.hostName} invited you to a meetup`,
    body: `Meet at ${meetup.destination.name} — tap to accept and share your live location`,
    avatar: hostProfileImage && hostProfileImage.startsWith('http') ? hostProfileImage : undefined,
    groupKey: `meetup:${meetupId}`,
    cta: 'View',
    action,
    data: {
      meetupId,
      inviteToken: meetup.inviteToken,
      destinationName: meetup.destination.name
    }
  }).catch(err => console.error('❌ [MEETUP] Invite notification dispatch failed:', err.message));
};

// Tell the host when an invitee answers — accept is visible, decline is
// quiet (persisted but no push).
const notifyHostOfResponse = (meetup, participant, kind) => {
  if (participant.userId === meetup.hostId) return;
  const meetupId = meetup._id.toString();
  const isAccept = kind === 'accepted';
  dispatchNotification({
    toUserId: meetup.hostId,
    fromUserId: participant.userId,
    type: isAccept ? 'meetup_accepted' : 'meetup_declined',
    category: 'social',
    title: isAccept
      ? `${participant.name || 'Someone'} accepted your meetup`
      : `${participant.name || 'Someone'} declined your meetup`,
    body: isAccept
      ? `On the way to ${meetup.destination.name}`
      : `Can't make it to ${meetup.destination.name}`,
    avatar: participant.profileImage && participant.profileImage.startsWith('http')
      ? participant.profileImage : undefined,
    groupKey: `meetup:${meetupId}`,
    action: {
      screen: 'Home',
      params: { screen: 'Map', params: { meetupInviteId: meetupId } }
    },
    push: isAccept,
    data: { meetupId, destinationName: meetup.destination.name }
  }).catch(err => console.error(`❌ [MEETUP] Host ${kind} notification failed:`, err.message));
};

/**
 * Create a meetup: host picks a destination + invites friends.
 * POST /api/meetups  { destination, inviteeIds?, durationHours? }
 */
exports.createMeetup = async (req, res) => {
  try {
    const hostId = req.user.userId;
    const { destination, inviteeIds, durationHours } = req.body;

    if (!destination || typeof destination.latitude !== 'number' || typeof destination.longitude !== 'number'
      || Math.abs(destination.latitude) > 90 || Math.abs(destination.longitude) > 180
      || !destination.name) {
      return res.status(400).json({
        success: false,
        message: 'destination with name, latitude and longitude is required'
      });
    }

    const host = await User.findOne({ userId: hostId }).select('userId name profileImage');
    if (!host) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Only friends can be invited in-app (shareable link is the open path)
    const uniqueInvitees = [...new Set((inviteeIds || []).filter(id => id && id !== hostId))].slice(0, MAX_PARTICIPANTS);
    const friendChecks = await Promise.all(uniqueInvitees.map(id => Friend.areFriends(hostId, id)));
    const validInviteeIds = uniqueInvitees.filter((_, i) => friendChecks[i]);

    const inviteeUsers = await User.find({ userId: { $in: validInviteeIds } })
      .select('userId name profileImage')
      .lean();

    const hours = Math.min(Math.max(Number(durationHours) || DEFAULT_EXPIRY_HOURS, 0.5), MAX_EXPIRY_HOURS);

    const meetup = await Meetup.create({
      hostId,
      hostName: host.name || 'Someone',
      destination: {
        name: destination.name,
        address: destination.address || '',
        latitude: destination.latitude,
        longitude: destination.longitude,
        placeId: destination.placeId || null
      },
      participants: [
        { userId: hostId, name: host.name, profileImage: host.profileImage, status: 'accepted', respondedAt: new Date() },
        ...inviteeUsers.map(u => ({ userId: u.userId, name: u.name, profileImage: u.profileImage, status: 'invited' }))
      ],
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000)
    });

    meetup.participants.filter(p => p.status === 'invited').forEach(p => notifyInvite(meetup, p, host.profileImage));

    console.log(`✅ [MEETUP] Created ${meetup._id} by ${hostId} → "${destination.name}", ${inviteeUsers.length} invitee(s)`);

    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error creating meetup:', error);
    res.status(500).json({ success: false, message: 'Error creating meetup', error: error.message });
  }
};

/**
 * Meetups I'm hosting or invited to / participating in.
 * GET /api/meetups/mine
 */
exports.listMyMeetups = async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();

    // Safety-net expiry sweep for this user's meetups
    await Meetup.updateMany(
      { status: 'active', expiresAt: { $lte: now }, 'participants.userId': userId },
      { $set: { status: 'ended', endedAt: now } }
    );

    const meetups = await Meetup.find({
      status: 'active',
      'participants.userId': userId
    }).sort({ createdAt: -1 }).lean();

    res.json({ success: true, meetups: meetups.map(serializeMeetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error listing meetups:', error);
    res.status(500).json({ success: false, message: 'Error listing meetups', error: error.message });
  }
};

/**
 * Get a single meetup (must be host or participant).
 * GET /api/meetups/:id
 */
exports.getMeetup = async (req, res) => {
  try {
    const meetup = await Meetup.findById(req.params.id).lean();
    if (!meetup) {
      return res.status(404).json({ success: false, message: 'Meetup not found' });
    }

    const isMember = meetup.hostId === req.user.userId
      || meetup.participants.some(p => p.userId === req.user.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Not a meetup participant' });
    }

    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error getting meetup:', error);
    res.status(500).json({ success: false, message: 'Error getting meetup', error: error.message });
  }
};

/**
 * Update my participant status. Accept / decline / leave / arrived.
 * POST /api/meetups/:id/respond  { action: 'accept'|'decline'|'leave' }
 */
exports.respondToMeetup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { action } = req.body;
    const statusMap = { accept: 'accepted', decline: 'declined', leave: 'left' };
    const newStatus = statusMap[action];
    if (!newStatus) {
      return res.status(400).json({ success: false, message: 'action must be accept, decline or leave' });
    }

    const meetup = await Meetup.findOne({
      _id: req.params.id,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });
    if (!meetup) {
      return res.status(404).json({ success: false, message: 'Meetup not found or already ended' });
    }

    const participant = meetup.findParticipant(userId);
    if (!participant) {
      return res.status(403).json({ success: false, message: 'Not a meetup participant' });
    }

    if (meetup.isHost(userId) && (action === 'leave' || action === 'decline')) {
      return res.status(400).json({ success: false, message: 'The host must end the meetup instead' });
    }

    if (participant.status === 'arrived' && action === 'accept') {
      return res.json({ success: true, meetup: serializeMeetup(meetup) });
    }

    participant.status = newStatus;
    participant.respondedAt = new Date();
    await meetup.save();

    broadcastToMeetup(meetup, 'meetup:status', {
      userId,
      name: participant.name,
      participantStatus: newStatus,
      meetup: serializeMeetup(meetup)
    });

    if (newStatus === 'accepted' || newStatus === 'declined') {
      notifyHostOfResponse(meetup, participant, newStatus);
    }

    console.log(`✅ [MEETUP] ${userId} ${action}ed meetup ${meetup._id}`);
    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error responding to meetup:', error);
    res.status(500).json({ success: false, message: 'Error responding to meetup', error: error.message });
  }
};

/**
 * Join via shareable invite link token. Possessing the link is the invite —
 * joiners land directly as accepted participants.
 * POST /api/meetups/join/:inviteToken
 */
exports.joinByToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const meetup = await Meetup.findOne({
      inviteToken: req.params.inviteToken,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });

    if (!meetup) {
      return res.status(404).json({ success: false, message: 'Meetup not found or already ended' });
    }

    let participant = meetup.findParticipant(userId);
    if (participant) {
      if (participant.status === 'declined' || participant.status === 'left') {
        participant.status = 'accepted';
        participant.respondedAt = new Date();
        await meetup.save();
        broadcastToMeetup(meetup, 'meetup:status', {
          userId, name: participant.name, participantStatus: 'accepted',
          meetup: serializeMeetup(meetup)
        });
      }
    } else {
      const user = await User.findOne({ userId }).select('userId name profileImage').lean();
      meetup.participants.push({
        userId,
        name: user?.name || 'User',
        profileImage: user?.profileImage || null,
        status: 'accepted',
        respondedAt: new Date()
      });
      await meetup.save();
      broadcastToMeetup(meetup, 'meetup:status', {
        userId, name: user?.name || 'User', participantStatus: 'accepted',
        meetup: serializeMeetup(meetup)
      });
    }

    console.log(`✅ [MEETUP] ${userId} joined meetup ${meetup._id} via link`);
    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error joining meetup:', error);
    res.status(500).json({ success: false, message: 'Error joining meetup', error: error.message });
  }
};

/**
 * Invite additional friends to an existing meetup (host or accepted participant).
 * POST /api/meetups/:id/invite  { inviteeIds: [] }
 */
exports.inviteMore = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { inviteeIds } = req.body;
    const meetup = await Meetup.findOne({
      _id: req.params.id,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });
    if (!meetup) {
      return res.status(404).json({ success: false, message: 'Meetup not found or already ended' });
    }

    const me = meetup.findParticipant(userId);
    const canInvite = meetup.isHost(userId) || (me && (me.status === 'accepted' || me.status === 'arrived'));
    if (!canInvite) {
      return res.status(403).json({ success: false, message: 'Only the host or accepted/arrived participants can invite' });
    }

    const candidates = [...new Set((inviteeIds || [])
      .filter(id => id && id !== userId && !meetup.findParticipant(id)))]
      .slice(0, MAX_PARTICIPANTS - meetup.participants.length);

    const friendChecks = await Promise.all(candidates.map(id => Friend.areFriends(userId, id)));
    const validIds = candidates.filter((_, i) => friendChecks[i]);
    const users = await User.find({ userId: { $in: validIds } }).select('userId name profileImage').lean();

    users.forEach(u => meetup.participants.push({
      userId: u.userId, name: u.name, profileImage: u.profileImage, status: 'invited'
    }));
    await meetup.save();

    const hostUser = await User.findOne({ userId: meetup.hostId }).select('profileImage').lean();
    users.forEach(u => notifyInvite(meetup, { userId: u.userId }, hostUser?.profileImage));
    broadcastToMeetup(meetup, 'meetup:status', { meetup: serializeMeetup(meetup) });

    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error inviting to meetup:', error);
    res.status(500).json({ success: false, message: 'Error inviting to meetup', error: error.message });
  }
};

/**
 * End the meetup (host only).
 * POST /api/meetups/:id/end
 */
exports.endMeetup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const meetup = await Meetup.findOne({ _id: req.params.id, status: 'active' });
    if (!meetup) {
      return res.status(404).json({ success: false, message: 'Meetup not found or already ended' });
    }
    if (!meetup.isHost(userId)) {
      return res.status(403).json({ success: false, message: 'Only the host can end the meetup' });
    }

    meetup.status = 'ended';
    meetup.endedAt = new Date();
    await meetup.save();

    broadcastToMeetup(meetup, 'meetup:ended', { meetupId: meetup._id.toString() });
    console.log(`✅ [MEETUP] Host ${userId} ended meetup ${meetup._id}`);

    res.json({ success: true, meetup: serializeMeetup(meetup) });
  } catch (error) {
    console.error('❌ [MEETUP] Error ending meetup:', error);
    res.status(500).json({ success: false, message: 'Error ending meetup', error: error.message });
  }
};

exports.serializeMeetup = serializeMeetup;
