const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const { getReputation } = require('../controllers/rippleTrustController');
const {
  getMe,
  joinOpenNetwork,
  leaveOpenNetwork,
  updateSettings,
  getViewport,
  getNearby,
  getFeed,
  resolvePlaceQuery,
} = require('../controllers/openNetworkController');
const {
  startLive,
  listLive,
  joinLive,
  leaveLive,
  endLive,
  getLiveMessages,
  postLiveMessage,
  addLiveReactions,
} = require('../controllers/liveSessionController');

// Feature flag: unset/anything except the literal string 'false' = enabled.
const openNetworkEnabled = (req, res, next) => {
  if (process.env.OPEN_NETWORK_ENABLED === 'false') {
    return res.status(503).json({
      success: false,
      code: 'OPEN_NETWORK_DISABLED',
      message: 'Open Network is currently disabled',
    });
  }
  next();
};

// Opt-in gate: everything below it requires OpenNetworkProfile.joined.
const requireJoined = async (req, res, next) => {
  try {
    const profile = await OpenNetworkProfile.getOrCreate(req.user.userId);
    if (!profile.joined) {
      return res.status(403).json({
        success: false,
        code: 'OPEN_NETWORK_NOT_JOINED',
        message: 'Join Open Network to use this feature',
      });
    }
    req.openNetworkProfile = profile;
    next();
  } catch (err) {
    next(err);
  }
};

router.use(openNetworkEnabled);
router.use(protect);

// Ungated-by-join endpoints (must stay ABOVE requireJoined).
router.get('/me', getMe);
router.post('/join', joinOpenNetwork);

router.use(requireJoined);

router.post('/leave', leaveOpenNetwork);
router.patch('/settings', updateSettings);
router.get('/viewport', getViewport);
router.get('/nearby', getNearby);
router.get('/feed', getFeed);
router.get('/resolve-place', resolvePlaceQuery);

// Live broadcasts (LiveKit-backed one-to-many video)
router.get('/live', listLive);
router.post('/live', startLive);
router.post('/live/:id/join', joinLive);
router.post('/live/:id/leave', leaveLive);
router.post('/live/:id/end', endLive);
router.get('/live/:id/messages', getLiveMessages);
router.post('/live/:id/messages', postLiveMessage);
router.post('/live/:id/react', addLiveReactions);

// Trust — public host score (suppressed below the minimum sample) and a
// reliability band that is only returned to the subject or to a host.
router.get('/users/:userId/reputation', getReputation);

module.exports = router;
