const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getMe, activate, updateSettings } = require('../controllers/syncSpaceController');
const connect = require('../controllers/syncSpaceConnectController');

const syncSpaceEnabled = (req, res, next) => {
  if (process.env.SYNC_SPACE_ENABLED === 'false') {
    return res.status(503).json({
      success: false,
      code: 'SYNC_SPACE_DISABLED',
      message: 'Sync Space is currently unavailable',
    });
  }
  next();
};

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

router.use(noStore);
router.use(syncSpaceEnabled);
router.use(protect);

router.get('/me', getMe);
router.post('/activate', activate);
router.patch('/settings', updateSettings);

router.post('/connect/preview', connect.requireActive, connect.preview);
router.post('/connect/approve', connect.requireActive, connect.approve);
router.post('/connect/decline', connect.requireActive, connect.decline);
router.get('/connections', connect.requireActive, connect.listConnections);
router.delete('/connections/:connectionId', connect.requireActive, connect.revokeConnection);
router.get('/everspace', connect.requireActive, connect.listEverspace);
router.get('/everspace/:connectionId/receipts', connect.requireActive, connect.listEverspaceReceipts);
router.get('/messages', connect.requireActive, connect.listMessages);
router.get('/messages/unread-count', connect.requireActive, connect.unreadCount);
router.post('/messages/read-all', connect.requireActive, connect.markAllRead);
router.post('/messages/:messageId/read', connect.requireActive, connect.markRead);
router.post('/messages/:messageId/reveal', connect.requireActive, connect.reveal);
router.post('/pairing/qr', connect.requireActive, connect.createPairingQr);
router.get('/pairing/qr/:pairingId', connect.requireActive, connect.pairingQrStatus);
router.get('/pairing/requests', connect.requireActive, connect.listPairingRequests);
router.post('/pairing/requests/:pairingId/decline', connect.requireActive, connect.declinePairingRequest);

module.exports = router;
