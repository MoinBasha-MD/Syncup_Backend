const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const {
  createRipple,
  getRipple,
  updateRipple,
  publishRipple,
} = require('../controllers/rippleController');

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

// Opt-in gate: every Ripple endpoint requires OpenNetworkProfile.joined.
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
router.use(requireJoined);

// @route POST   /api/ripples          create (draft, or publish:true)
// @route GET    /api/ripples/:id      detail + viewer block
// @route PATCH  /api/ripples/:id      host/cohost edit
// @route POST   /api/ripples/:id/publish   draft -> active/scheduled
router.post('/', createRipple);
router.get('/:id', getRipple);
router.patch('/:id', updateRipple);
router.post('/:id/publish', publishRipple);

module.exports = router;
