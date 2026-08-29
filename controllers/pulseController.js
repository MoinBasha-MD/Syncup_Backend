const asyncHandler = require('express-async-handler');
const Pulse = require('../models/Pulse');
const PulseChain = require('../models/PulseChain');
const User = require('../models/userModel');
const Friend = require('../models/Friend');
const friendService = require('../services/friendService');
const { broadcastToUser } = require('../socketManager');
const { sanitizeUser } = require('../utils/logSanitizer');
const fcmNotificationService = require('../services/fcmNotificationService');

function buildChainId(a, b) {
  return [a, b].sort().join('_');
}

const mapUserToPulseUser = (user) => ({
  userId: user.userId,
  name: user.name,
  profileImage: user.profileImage || null
});

// ✅ FIX: `.lean()` queries return the `unseenCounts` Map field as a plain
// JS object (or, on some Mongoose versions, drops it to an array of pairs),
// not a real Map instance. Calling `.get()` on that silently returns
// undefined via optional chaining, so unseen badges always showed 0.
// This helper safely reads the count regardless of the underlying shape.
function getUnseenCount(chain, userId) {
  const counts = chain?.unseenCounts;
  if (!counts) return 0;
  if (typeof counts.get === 'function') return counts.get(userId) || 0;
  if (Array.isArray(counts)) {
    const pair = counts.find((entry) => Array.isArray(entry) && entry[0] === userId);
    return pair ? pair[1] || 0 : 0;
  }
  return counts[userId] || 0;
}

// ✅ FIX: Backend previously accepted any `content` shape regardless of the
// declared pulse `type`, allowing mismatched/garbage data (e.g. a "voice"
// pulse with a photo mediaUrl and no voiceUrl). Validate the minimal
// required fields per type before persisting.
const REQUIRED_CONTENT_FIELDS = {
  photo: ['mediaUrl'],
  video: ['mediaUrl'],
  voice: ['voiceUrl'],
  song: ['songTitle'],
  location: ['locationName'],
  reaction: ['reactionEmoji'],
  memory: ['memoryRefId'],
  text: []
};

// ✅ FIX: the client-supplied `content.waveform` array (and caption/moodTag
// strings) were persisted with no size limits. A malicious or buggy client
// could send an arbitrarily large waveform array or multi-MB strings on
// every pulse, bloating storage and slowing down chain reads with no
// server-side guard.
const MAX_WAVEFORM_SAMPLES = 200;
const MAX_CAPTION_LENGTH = 500;
const MAX_MOOD_TAG_LENGTH = 60;

function validatePulseContent(type, content) {
  const required = REQUIRED_CONTENT_FIELDS[type];
  if (required === undefined) {
    return `Invalid pulse type: ${type}`;
  }
  const safeContent = content || {};
  for (const field of required) {
    if (!safeContent[field]) {
      return `Missing required field "${field}" for pulse type "${type}"`;
    }
  }
  if (type === 'voice' && Array.isArray(safeContent.waveform) && safeContent.waveform.length > MAX_WAVEFORM_SAMPLES) {
    return `Waveform data exceeds max of ${MAX_WAVEFORM_SAMPLES} samples`;
  }
  return null;
}

// ✅ FIX: sendPulse previously allowed pulsing any userId with no friendship
// check, so strangers could pulse anyone. Verify friendship in either
// direction before allowing the pulse to be created.
async function areFriends(userIdA, userIdB) {
  const [a, b] = await Promise.all([
    Friend.areFriends(userIdA, userIdB),
    Friend.areFriends(userIdB, userIdA)
  ]);
  return a || b;
}

/**
 * GET /api/pulse/friends
 * Get accepted friends for current user
 */
const getFriends = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const friends = await friendService.getFriends(userId, { status: 'accepted' });

    res.status(200).json({
      success: true,
      data: friends.map((friend) => ({
        userId: friend.friendUserId,
        name: friend.name,
        profileImage: friend.profileImage || null
      }))
    });
  } catch (error) {
    console.error('❌ [PULSE] Error getting friends:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/pulse/chains
 * Get all pulse chains for current user
 */
// ✅ FIX: previously fetched every chain the user has ever participated in
// with no limit. Active users can accumulate hundreds of chains over time;
// cap the list to the most recently active ones to keep this fast.
const MAX_CHAINS_RETURNED = 200;

const getChains = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const chains = await PulseChain.find({
      'participants.userId': userId
    })
      .sort({ lastPulseAt: -1 })
      .limit(MAX_CHAINS_RETURNED)
      .lean();

    const data = chains.map((chain) => ({
      ...chain,
      unseenCount: getUnseenCount(chain, userId)
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ [PULSE] Error getting chains:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/pulse/chains/:chainId
 * Get all moments in a pulse chain
 */
const DEFAULT_MOMENTS_PAGE_SIZE = 30;
const MAX_MOMENTS_PAGE_SIZE = 100;

const getChainMoments = asyncHandler(async (req, res) => {
  try {
    const { chainId } = req.params;
    const userId = req.user.userId;

    // ✅ FIX: getChainMoments previously fetched ALL moments for a chain
    // with no limit, which does not scale for long-running chains.
    // Support cursor-based pagination via `?before=<ISO timestamp>&limit=N`
    // while keeping the response shape backward compatible for callers
    // that don't pass these params (defaults to the most recent page).
    const limit = Math.min(
      MAX_MOMENTS_PAGE_SIZE,
      Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_MOMENTS_PAGE_SIZE)
    );
    const before = req.query.before ? new Date(req.query.before) : null;

    const chain = await PulseChain.findOne({ chainId }).lean();

    if (!chain) {
      // No pulses have been exchanged yet for this pair, so the chain
      // document doesn't exist in the DB. This is a valid state (not an
      // error) as long as the requesting user is actually one of the two
      // participants encoded in the chainId (buildChainId output).
      const memberIds = chainId.split('_');
      if (!memberIds.includes(userId)) {
        res.status(403);
        throw new Error('Not authorized to view this chain');
      }

      res.status(200).json({ success: true, data: [], hasMore: false });
      return;
    }

    if (!chain.participants.some((p) => p.userId === userId)) {
      res.status(403);
      throw new Error('Not authorized to view this chain');
    }

    const momentsQuery = { chainId };
    if (before && !isNaN(before.getTime())) {
      momentsQuery.createdAt = { $lt: before };
    }

    const moments = await Pulse.find(momentsQuery)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = moments.length > limit;
    if (hasMore) moments.pop();

    // Mark unseen as seen for current user
    await Pulse.updateMany(
      {
        chainId,
        receiverId: userId,
        status: { $ne: 'seen' }
      },
      { $set: { status: 'seen', seenAt: new Date() } }
    );

    // Clear unseen count for this user
    await PulseChain.updateOne(
      { chainId },
      { $set: { [`unseenCounts.${userId}`]: 0 } }
    );

    res.status(200).json({ success: true, data: moments, hasMore });
  } catch (error) {
    console.error('❌ [PULSE] Error getting chain moments:', error.message);
    // ✅ FIX: previously always responded 500 even when a specific status
    // (e.g. 403 Not authorized) had already been set above, hiding the
    // real error type from the client.
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/pulse
 * Send a new pulse
 */
const sendPulse = asyncHandler(async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, type, content, caption, moodTag } = req.body;

    if (!receiverId || !type) {
      res.status(400);
      throw new Error('receiverId and type are required');
    }

    if (receiverId === senderId) {
      res.status(400);
      throw new Error('Cannot send a pulse to yourself');
    }

    if (typeof caption === 'string' && caption.length > MAX_CAPTION_LENGTH) {
      res.status(400);
      throw new Error(`Caption exceeds max length of ${MAX_CAPTION_LENGTH} characters`);
    }

    if (typeof moodTag === 'string' && moodTag.length > MAX_MOOD_TAG_LENGTH) {
      res.status(400);
      throw new Error(`Mood tag exceeds max length of ${MAX_MOOD_TAG_LENGTH} characters`);
    }

    // ✅ FIX: validate content matches the declared pulse type before
    // persisting anything (previously any content shape was accepted).
    const contentError = validatePulseContent(type, content);
    if (contentError) {
      res.status(400);
      throw new Error(contentError);
    }

    const [sender, receiver] = await Promise.all([
      User.findOne({ userId: senderId }).select('userId name profileImage').lean(),
      User.findOne({ userId: receiverId }).select('userId name profileImage').lean()
    ]);

    if (!sender || !receiver) {
      res.status(404);
      throw new Error('Sender or receiver not found');
    }

    // ✅ FIX: previously anyone could pulse any userId with no relationship
    // check, letting strangers send pulses. Require an accepted friendship.
    const friends = await areFriends(senderId, receiverId);
    if (!friends) {
      res.status(403);
      throw new Error('You can only send pulses to friends');
    }

    const chainId = buildChainId(senderId, receiverId);

    const pulse = await Pulse.create({
      chainId,
      senderId,
      receiverId,
      type,
      content: content || {},
      caption: caption || '',
      moodTag: moodTag || '',
      status: 'sent'
    });

    const participants = [mapUserToPulseUser(sender), mapUserToPulseUser(receiver)].sort(
      (a, b) => a.userId.localeCompare(b.userId)
    );
    const lastPulse = { type, senderId, caption: caption || '' };

    // ✅ FIX: chain summary was previously updated via a
    // findOne -> mutate -> save pattern, which is not atomic. Two pulses
    // sent in quick succession could race: both read the same
    // `existingChain`/`unseenCounts` snapshot, then both write back stale
    // data, silently dropping a pulseCount increment or unseen-count bump,
    // and concurrent first-pulses could even attempt duplicate creates
    // against the unique `chainId` index. `findOneAndUpdate` with `upsert`
    // and atomic operators ($inc/$set) makes this race-free.
    const updatedChain = await PulseChain.findOneAndUpdate(
      { chainId },
      {
        $setOnInsert: { chainId },
        $set: {
          participants,
          lastPulseAt: pulse.createdAt,
          lastPulse
        },
        $inc: {
          pulseCount: 1,
          [`unseenCounts.${receiverId}`]: 1
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // Real-time: notify the receiver via socket
    try {
      broadcastToUser(receiverId, 'pulse:new', {
        pulse: {
          id: pulse._id.toString(),
          chainId,
          senderId,
          receiverId,
          type,
          caption: caption || '',
          content: content || {},
          createdAt: pulse.createdAt,
        },
        chain: updatedChain,
        from: mapUserToPulseUser(sender),
      });
      console.log(`💗 [PULSE] Socket emit to ${receiverId}: pulse:new`);
    } catch (socketErr) {
      console.warn('⚠️ [PULSE] Socket emit failed:', socketErr.message);
    }

    // ✅ FIX: Send FCM push notification in the background (fire-and-forget).
    // Previously this was `await`ed, which blocked the HTTP response. When the
    // server had transient DNS issues (EAI_AGAIN for fcm.googleapis.com), the
    // DNS resolution hung for 30+ seconds, causing nginx to return 502 Bad
    // Gateway to the client — even though the pulse was already saved to the
    // DB. The client never received the success response.
    // Now we respond immediately and let FCM happen asynchronously.
    fcmNotificationService.sendVisibleNotification(receiverId, {
      title: sender.name || 'New Pulse',
      body: caption?.trim() || `Sent you a ${type} Pulse`,
      channelId: 'pulse_notifications',
      data: {
        type: 'pulse',
        pulseId: pulse._id,
        chainId,
        senderId,
        senderName: sender.name,
        senderProfileImage: sender.profileImage || '',
        pulseType: type
      }
    }).catch((fcmErr) => {
      console.warn('⚠️ [PULSE] FCM notification failed:', fcmErr.message);
    });

    res.status(201).json({
      success: true,
      data: { pulse, chain: updatedChain }
    });
  } catch (error) {
    console.error('❌ [PULSE] Error sending pulse:', error.message);
    // ✅ FIX: previously always responded 500 even when a specific status
    // (400/403/404) had already been set above, hiding the real error type.
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
});

module.exports = {
  getFriends,
  getChains,
  getChainMoments,
  sendPulse
};
