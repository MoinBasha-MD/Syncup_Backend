const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const DeviceLinkChallenge = require('../models/DeviceLinkChallenge');
const DeviceSession = require('../models/DeviceSession');
const { generateDeskToken, generateRefreshToken } = require('../utils/generateToken');
const rateLimit = require('express-rate-limit');

// Rate limiters
const createChallengeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Too many pairing attempts, please try again later',
});

const challengeActionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
});

const buildPairingUrl = (pairingId, secret) => {
  return `syncup-desk://link?pairingId=${encodeURIComponent(pairingId)}&secret=${encodeURIComponent(secret)}`;
};

// @desc    Create a new device-linking challenge from the browser
// @route   POST /api/devices/challenge
// @access  Public (rate-limited)
const createChallenge = async (req, res) => {
  try {
    const { browserInfo } = req.body || {};
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const challenge = await DeviceLinkChallenge.createChallenge(300, browserInfo);

    res.status(201).json({
      success: true,
      data: {
        pairingId: challenge.pairingId,
        shortCode: challenge.shortCode,
        pairingUrl: buildPairingUrl(challenge.pairingId, challenge.secret),
        browserKey: challenge.browserKey,
        expiresAt: challenge.expiresAt,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] createChallenge error:', error);
    res.status(500).json({ success: false, message: 'Failed to create pairing challenge' });
  }
};

// @desc    Inspect a challenge before approving (mobile)
// @route   POST /api/devices/challenge/inspect
// @access  Private
const inspectChallenge = async (req, res) => {
  try {
    const { shortCode, pairingId, secret } = req.body;
    const userId = req.user.userId;

    if (!shortCode && (!pairingId || !secret)) {
      return res.status(400).json({ success: false, message: 'shortCode (or pairingId+secret) is required' });
    }

    let challenge;
    if (shortCode) {
      // Normalize: uppercase and add dash if missing (e.g., "a7k9m2" → "A7K-9M2")
      const normalized = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const formatted = normalized.length === 6
        ? normalized.slice(0, 3) + '-' + normalized.slice(3)
        : normalized;

      challenge = await DeviceLinkChallenge.findOne({
        shortCode: formatted,
        status: { $in: ['pending', 'scanned'] },
        expiresAt: { $gt: new Date() },
      });
    } else {
      challenge = await DeviceLinkChallenge.findOne({
        pairingId,
        secret,
        status: { $in: ['pending', 'scanned'] },
        expiresAt: { $gt: new Date() },
      });
    }

    if (!challenge) {
      return res.status(404).json({ success: false, message: 'Invalid or expired pairing code' });
    }

    // Mark as scanned so the browser can show "Phone scanned — waiting for approval"
    if (challenge.status === 'pending') {
      challenge.status = 'scanned';
      await challenge.save();
    }

    console.log(`🔍 [INSPECT] User ${userId} inspected challenge ${challenge.pairingId} (code: ${challenge.shortCode})`);
    res.json({
      success: true,
      data: {
        pairingId: challenge.pairingId,
        status: challenge.status,
        browserInfo: challenge.browserInfo,
        expiresAt: challenge.expiresAt,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] inspectChallenge error:', error);
    res.status(500).json({ success: false, message: 'Failed to inspect challenge' });
  }
};

// @desc    Approve a device-linking challenge from the phone
// @route   POST /api/devices/challenge/approve
// @access  Private
const approveChallenge = async (req, res) => {
  try {
    const { shortCode, pairingId, secret } = req.body;
    const userId = req.user.userId;

    if (!shortCode && (!pairingId || !secret)) {
      return res.status(400).json({ success: false, message: 'shortCode (or pairingId+secret) is required' });
    }

    let challenge;
    if (shortCode) {
      const normalized = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const formatted = normalized.length === 6
        ? normalized.slice(0, 3) + '-' + normalized.slice(3)
        : normalized;

      challenge = await DeviceLinkChallenge.findOne({
        shortCode: formatted,
        status: { $in: ['pending', 'scanned'] },
        expiresAt: { $gt: new Date() },
      });
    } else {
      challenge = await DeviceLinkChallenge.findOne({
        pairingId,
        secret,
        status: { $in: ['pending', 'scanned'] },
        expiresAt: { $gt: new Date() },
      });
    }

    if (!challenge) {
      console.log(`❌ [APPROVE] Challenge not found or expired. shortCode: ${shortCode}`);
      return res.status(404).json({ success: false, message: 'Invalid or expired pairing code' });
    }

    const authCode = crypto.randomBytes(32).toString('base64url');
    const authCodeHash = crypto.createHash('sha256').update(authCode).digest('hex');

    challenge.status = 'approved';
    challenge.userId = userId;
    challenge.authCode = authCode;
    challenge.authCodeHash = authCodeHash;
    challenge.authCodeExpiresAt = new Date(Date.now() + 300 * 1000); // 5 minutes
    challenge.approvedAt = new Date();
    await challenge.save();

    console.log(`✅ [APPROVE] Challenge approved, authCode generated for user ${userId}`);
    res.json({
      success: true,
      data: {
        pairingId: challenge.pairingId,
        status: challenge.status,
        browserInfo: challenge.browserInfo,
        approvedAt: challenge.approvedAt,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] approveChallenge error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve challenge' });
  }
};

// @desc    Poll challenge status from the browser
// @route   GET /api/devices/challenge/:pairingId
// @access  Public (browser-key constrained)
const getChallengeStatus = async (req, res) => {
  try {
    const { pairingId } = req.params;
    const { browserKey } = req.query;

    // Never cache pairing status — the browser polls this every 2 seconds
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const challenge = await DeviceLinkChallenge.findOne({ pairingId });

    if (!challenge) {
      console.log(`📋 [CHALLENGE STATUS] ${pairingId} → not found`);
      return res.status(404).json({ success: false, message: 'Pairing not found' });
    }

    if (challenge.status !== 'approved' && challenge.expiresAt < new Date()) {
      challenge.status = 'expired';
      await challenge.save();
    }

    const response = {
      pairingId: challenge.pairingId,
      status: challenge.status,
      expiresAt: challenge.expiresAt,
    };

    if (challenge.status === 'approved' && browserKey && browserKey === challenge.browserKey) {
      if (challenge.authCodeExpiresAt && challenge.authCodeExpiresAt > new Date()) {
        response.authCode = challenge.authCode;
      } else {
        response.status = 'expired';
        console.log(`📋 [CHALLENGE STATUS] ${pairingId} → authCode expired`);
      }
    }

    console.log(`📋 [CHALLENGE STATUS] ${pairingId} → ${response.status}, authCode: ${response.authCode ? 'yes' : 'no'}`);
    res.json({ success: true, data: response });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] getChallengeStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to get challenge status' });
  }
};

// @desc    Activate a browser session with an auth code
// @route   POST /api/devices/activate
// @access  Public
const activateSession = async (req, res) => {
  try {
    const { authCode, deviceName = 'Browser', platform = 'web', metadata = null } = req.body;

    if (!authCode) {
      return res.status(400).json({ success: false, message: 'authCode is required' });
    }

    console.log(`🔑 [ACTIVATE] Attempting to consume authCode: ${authCode.slice(0, 12)}...`);
    const challenge = await DeviceLinkChallenge.consumeByAuthCode(authCode);

    if (!challenge) {
      console.log(`❌ [ACTIVATE] Invalid or expired authCode`);
      return res.status(400).json({ success: false, message: 'Invalid or expired auth code' });
    }

    console.log(`✅ [ACTIVATE] Challenge consumed for user ${challenge.userId}, creating session...`);
    const { session, refreshToken } = await DeviceSession.createSession(
      challenge.userId,
      deviceName,
      platform,
      metadata
    );

    const accessToken = generateDeskToken(
      session._id.toString(),
      session.userId,
      {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
      }
    );

    console.log(`✅ [ACTIVATE] Session created: ${session.sessionId} for user ${challenge.userId}`);
    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        userId: session.userId,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] activateSession error:', error);
    res.status(500).json({ success: false, message: 'Failed to activate session' });
  }
};

// @desc    Refresh desk access token
// @route   POST /api/devices/refresh
// @access  Public
const refreshSession = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'refreshToken is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    if (decoded.tokenType !== 'refresh' || !decoded.sessionId) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const session = await DeviceSession.findOne({
      sessionId: decoded.sessionId,
      status: 'active',
    });

    if (!session) {
      return res.status(401).json({ success: false, message: 'Session not found or revoked' });
    }

    // Rotate refresh token
    const newRefreshToken = crypto.randomBytes(32).toString('base64url');
    session.refreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    session.refreshTokenVersion += 1;
    session.lastSeenAt = new Date();
    await session.save();

    const newAccessToken = generateDeskToken(
      session._id.toString(),
      session.userId,
      {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
      }
    );

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        sessionId: session.sessionId,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] refreshSession error:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh session' });
  }
};

// @desc    List linked devices/sessions for the current user
// @route   GET /api/devices
// @access  Private
const getDevices = async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessions = await DeviceSession.find({ userId }).sort({ lastSeenAt: -1 });

    res.json({
      success: true,
      data: sessions.map((s) => ({
        sessionId: s.sessionId,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
        platform: s.platform,
        status: s.status,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] getDevices error:', error);
    res.status(500).json({ success: false, message: 'Failed to get devices' });
  }
};

// @desc    Revoke a specific device session
// @route   POST /api/devices/revoke
// @access  Private
const revokeDevice = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.userId;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const session = await DeviceSession.revokeBySessionId(sessionId, userId);

    if (!session) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    res.json({ success: true, message: 'Device revoked' });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] revokeDevice error:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke device' });
  }
};

// @desc    Revoke all web desk sessions for the user
// @route   POST /api/devices/revoke-all
// @access  Private
const revokeAllDevices = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;

    await DeviceSession.updateMany(
      { userId, status: 'active', ...(currentSessionId ? { sessionId: { $ne: currentSessionId } } : {}) },
      { status: 'revoked', revokedAt: new Date() }
    );

    res.json({ success: true, message: 'All linked devices revoked' });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] revokeAllDevices error:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke devices' });
  }
};

// @desc    Verify a browser session is still active (called by the browser)
// @route   GET /api/devices/session/verify
// @access  Public (session-scoped via sessionId in query)
const verifySession = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const sessionId = req.query.sessionId || (req.headers['x-session-id']);
    if (!sessionId) {
      return res.status(400).json({ success: false, active: false, message: 'sessionId is required' });
    }

    const session = await DeviceSession.findOne({ sessionId });

    if (!session) {
      return res.json({ success: true, active: false, reason: 'not_found' });
    }

    if (session.status !== 'active') {
      console.log(`🚪 [VERIFY SESSION] ${sessionId} → ${session.status}`);
      return res.json({ success: true, active: false, reason: session.status });
    }

    // Update lastSeenAt
    session.lastSeenAt = new Date();
    await session.save();

    return res.json({
      success: true,
      active: true,
      data: {
        sessionId: session.sessionId,
        userId: session.userId,
        deviceName: session.deviceName,
      },
    });
  } catch (error) {
    console.error('❌ [DEVICE CONTROLLER] verifySession error:', error);
    res.status(500).json({ success: false, active: false, message: 'Failed to verify session' });
  }
};

module.exports = {
  createChallengeLimiter,
  challengeActionLimiter,
  createChallenge,
  inspectChallenge,
  approveChallenge,
  getChallengeStatus,
  activateSession,
  refreshSession,
  verifySession,
  getDevices,
  revokeDevice,
  revokeAllDevices,
};
