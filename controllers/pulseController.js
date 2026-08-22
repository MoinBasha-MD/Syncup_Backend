const asyncHandler = require('express-async-handler');
const Pulse = require('../models/Pulse');
const PulseChain = require('../models/PulseChain');
const User = require('../models/userModel');
const friendService = require('../services/friendService');
const { sanitizeUser } = require('../utils/logSanitizer');

function buildChainId(a, b) {
  return [a, b].sort().join('_');
}

const mapUserToPulseUser = (user) => ({
  userId: user.userId,
  name: user.name,
  profileImage: user.profileImage || null
});

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
const getChains = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const chains = await PulseChain.find({
      'participants.userId': userId
    })
      .sort({ lastPulseAt: -1 })
      .lean();

    const data = chains.map((chain) => ({
      ...chain,
      unseenCount: chain.unseenCounts?.get?.(userId) || 0
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
const getChainMoments = asyncHandler(async (req, res) => {
  try {
    const { chainId } = req.params;
    const userId = req.user.userId;

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

      res.status(200).json({ success: true, data: [] });
      return;
    }

    if (!chain.participants.some((p) => p.userId === userId)) {
      res.status(403);
      throw new Error('Not authorized to view this chain');
    }

    const moments = await Pulse.find({ chainId })
      .sort({ createdAt: -1 })
      .lean();

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
    const chainDoc = await PulseChain.findOne({ chainId });
    if (chainDoc) {
      chainDoc.unseenCounts.set(userId, 0);
      await chainDoc.save();
    }

    res.status(200).json({ success: true, data: moments });
  } catch (error) {
    console.error('❌ [PULSE] Error getting chain moments:', error.message);
    res.status(500).json({ success: false, message: error.message });
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

    const [sender, receiver] = await Promise.all([
      User.findOne({ userId: senderId }).select('userId name profileImage').lean(),
      User.findOne({ userId: receiverId }).select('userId name profileImage').lean()
    ]);

    if (!sender || !receiver) {
      res.status(404);
      throw new Error('Sender or receiver not found');
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

    // Update or create chain summary
    const chainPayload = {
      chainId,
      participants: [mapUserToPulseUser(sender), mapUserToPulseUser(receiver)].sort(
        (a, b) => a.userId.localeCompare(b.userId)
      ),
      lastPulseAt: pulse.createdAt,
      lastPulse: {
        type,
        senderId,
        caption: caption || ''
      }
    };

    const existingChain = await PulseChain.findOne({ chainId });
    if (existingChain) {
      existingChain.lastPulseAt = pulse.createdAt;
      existingChain.lastPulse = chainPayload.lastPulse;
      existingChain.pulseCount = await Pulse.countDocuments({ chainId });
      existingChain.unseenCounts.set(
        receiverId,
        (existingChain.unseenCounts.get(receiverId) || 0) + 1
      );
      existingChain.participants = chainPayload.participants;
      await existingChain.save();
    } else {
      await PulseChain.create({
        ...chainPayload,
        pulseCount: 1,
        unseenCounts: new Map([[receiverId, 1]])
      });
    }

    res.status(201).json({
      success: true,
      data: { pulse, chain: await PulseChain.findOne({ chainId }).lean() }
    });
  } catch (error) {
    console.error('❌ [PULSE] Error sending pulse:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  getFriends,
  getChains,
  getChainMoments,
  sendPulse
};
