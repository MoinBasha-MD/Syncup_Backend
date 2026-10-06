const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  registerDevice,
  rotateSignedPreKey,
  getUserDevices,
  getOwnDevices,
  revokeDevice,
  putBackup,
  getBackup,
} = require('../controllers/e2eeController');

// E2EE v2 device directory - all routes require authentication
router.post('/devices', protect, registerDevice);
router.get('/devices', protect, getOwnDevices);
router.delete('/devices/:deviceId', protect, revokeDevice);
router.put('/devices/:deviceId/signed-prekey', protect, rotateSignedPreKey);
router.get('/users/:userId/devices', protect, getUserDevices);

// Encrypted backup pointer (opaque blob metadata; owner-only)
router.put('/backup', protect, putBackup);
router.get('/backup', protect, getBackup);

module.exports = router;
