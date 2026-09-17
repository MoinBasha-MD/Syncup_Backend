const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const {
  createRipple,
  getRipple,
  updateRipple,
  publishRipple,
  endRipple,
  cancelRipple,
  deleteRipple,
  getRippleArcs,
} = require('../controllers/rippleController');
const {
  createEvent,
  listEvents,
  deleteEvent,
  reactToEvent,
  pinEvent,
} = require('../controllers/rippleEventController');
const {
  rateRipple,
  getRippleRating,
  getMyRating,
  markAttendance,
  reportRipple,
} = require('../controllers/rippleTrustController');
const {
  joinRipple,
  leaveRipple,
  followRipple,
  unfollowRipple,
  getMembers,
  getRequests,
  approveRequest,
  rejectRequest,
  removeMember,
  promoteMember,
  demoteMember,
  getOrCreateRippleChat,
} = require('../controllers/rippleParticipationController');

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
// @route DELETE /api/ripples/:id      delete a draft
router.post('/', createRipple);
router.get('/:id', getRipple);
router.patch('/:id', updateRipple);
router.delete('/:id', deleteRipple);

// Lifecycle transitions (server-driven; hosts trigger these explicitly)
router.post('/:id/publish', publishRipple);   // draft -> active/scheduled
router.post('/:id/end', endRipple);           // active/scheduled -> wrapping
router.post('/:id/cancel', cancelRipple);     // draft/scheduled/active -> cancelled

// Participation — the people inside a Ripple are Ripplers
router.post('/:id/join', joinRipple);
router.post('/:id/leave', leaveRipple);
router.post('/:id/follow', followRipple);
router.post('/:id/unfollow', unfollowRipple);
router.get('/:id/members', getMembers);
router.get('/:id/requests', getRequests);
router.post('/:id/requests/:userId/approve', approveRequest);
router.post('/:id/requests/:userId/reject', rejectRequest);
router.post('/:id/members/:userId/remove', removeMember);
router.post('/:id/members/:userId/promote', promoteMember);
router.post('/:id/members/:userId/demote', demoteMember);

// Coordination — lazily creates the linked group chat on first open
router.post('/:id/chat', getOrCreateRippleChat);

// Contribution timeline — the posts inside a Ripple
router.post('/:id/events', createEvent);
router.get('/:id/events', listEvents);
router.delete('/:id/events/:eventId', deleteEvent);
router.post('/:id/events/:eventId/react', reactToEvent);
router.post('/:id/events/:eventId/pin', pinEvent);

// Outcome — ratings, attendance, reporting
router.post('/:id/rating', rateRipple);
router.get('/:id/rating', getRippleRating);
router.get('/:id/rating/me', getMyRating);
router.post('/:id/attendance', markAttendance);
router.post('/:id/report', reportRipple);

// Globe — city-aggregated join arcs (never per-person)
router.get('/:id/arcs', getRippleArcs);

module.exports = router;
