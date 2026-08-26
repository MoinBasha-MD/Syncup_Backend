const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createChallengeLimiter,
  challengeActionLimiter,
  createChallenge,
  inspectChallenge,
  approveChallenge,
  getChallengeStatus,
  activateSession,
  refreshSession,
  getDevices,
  revokeDevice,
  revokeAllDevices,
} = require('../controllers/deviceController');

// Public/rate-limited browser endpoints
router.post('/challenge', createChallengeLimiter, createChallenge);
router.get('/challenge/:pairingId', getChallengeStatus);
router.post('/activate', activateSession);
router.post('/refresh', refreshSession);

// Private mobile endpoints
router.post('/challenge/inspect', protect, challengeActionLimiter, inspectChallenge);
router.post('/challenge/approve', protect, challengeActionLimiter, approveChallenge);
router.get('/', protect, getDevices);
router.post('/revoke', protect, revokeDevice);
router.post('/revoke-all', protect, revokeAllDevices);

module.exports = router;
