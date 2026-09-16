const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const {
  getMe,
  joinOpenNetwork,
  leaveOpenNetwork,
  updateSettings,
  getViewport,
  getNearby,
  getFeed,
} = require('../controllers/openNetworkController');

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

module.exports = router;
