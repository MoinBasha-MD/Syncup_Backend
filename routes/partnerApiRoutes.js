const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { partnerApiAuth, apiKeyLimiter, messageLimiter, pairingLimiter } = require('../middleware/partnerApiAuth');
const partnerSpaceService = require('../services/partnerSpaceService');

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.use((req, res, next) => {
  if (process.env.SYNC_SPACE_ENABLED === 'false') {
    return res.status(503).json({
      success: false,
      code: 'SYNC_SPACE_DISABLED',
      message: 'Sync Space is currently unavailable',
    });
  }
  return next();
});

router.use(partnerApiAuth);
router.use(apiKeyLimiter);

router.get('/ping', (req, res) => {
  const { app, key } = req.partnerApi;
  res.json({
    success: true,
    app: { appId: app.appId, name: app.name, environment: app.environment },
    scopes: key.scopes,
  });
});

router.post('/connect-sessions', asyncHandler(async (req, res) => {
  const { app, key } = req.partnerApi;
  const result = await partnerSpaceService.createConnectSession({ app, key }, req.body);
  res.status(201).json({ success: true, ...result });
}));

router.get('/connect-sessions/:sessionId', asyncHandler(async (req, res) => {
  const { app } = req.partnerApi;
  const result = await partnerSpaceService.getConnectSession(app.appId, req.params.sessionId);
  res.json({ success: true, ...result });
}));

router.get('/connections/:subject', asyncHandler(async (req, res) => {
  const { app } = req.partnerApi;
  const connection = await partnerSpaceService.getConnectionBySubject(app.appId, req.params.subject);
  res.json({ success: true, ...connection });
}));

router.post('/messages', messageLimiter, asyncHandler(async (req, res) => {
  const { app, key } = req.partnerApi;
  const idempotencyKey = req.get('Idempotency-Key');
  const result = await partnerSpaceService.sendMessage({ app, key }, req.body, idempotencyKey);
  res.status(result.duplicated ? 200 : 201).json({
    success: true,
    messageId: result.messageId,
    createdAt: result.createdAt,
  });
}));

router.post('/pairings/qr', pairingLimiter, asyncHandler(async (req, res) => {
  const { app, key } = req.partnerApi;
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'qrPayload')) {
    return res.status(400).json({ success: false, code: 'REQUEST_FAILED', message: 'Unknown field' });
  }
  const result = await partnerSpaceService.pairByQr({ app, key }, body.qrPayload);
  res.json({ success: true, ...result });
}));

router.post('/pairings/otp', pairingLimiter, asyncHandler(async (req, res) => {
  const { app, key } = req.partnerApi;
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'identifier')) {
    return res.status(400).json({ success: false, code: 'REQUEST_FAILED', message: 'Unknown field' });
  }
  const result = await partnerSpaceService.requestOtpPairing({ app, key }, body.identifier);
  res.status(202).json({ success: true, ...result });
}));

router.post('/pairings/otp/verify', pairingLimiter, asyncHandler(async (req, res) => {
  const { app, key } = req.partnerApi;
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.some((k) => !['pairingId', 'code'].includes(k))) {
    return res.status(400).json({ success: false, code: 'REQUEST_FAILED', message: 'Unknown field' });
  }
  const result = await partnerSpaceService.verifyOtpPairing({ app, key }, body.pairingId, body.code);
  res.json({ success: true, ...result });
}));

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  return res.status(status).json({
    success: false,
    code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
    message: status >= 500 ? 'Internal server error' : err.message,
  });
});

module.exports = router;
