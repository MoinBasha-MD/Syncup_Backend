/**
 * Maya request routes — /api/maya/requests
 * Friend-to-friend Maya requests; the friend always decides.
 */
const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const mayaRequests = require('../services/mayaRequestService');

const router = express.Router();
router.use(protect);

const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    res.json(out === undefined ? { success: true } : out);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'INTERNAL' });
  }
};

router.post('/', handle(async (req) => ({
  success: true,
  request: await mayaRequests.createRequest({ fromUserId: req.user.userId, body: req.body || {} }),
})));

router.get('/', handle(async (req) => ({
  success: true,
  ...(await mayaRequests.listRequests(req.user.userId, {
    box: req.query.box === 'sent' ? 'sent' : 'received',
    cursor: req.query.cursor || undefined,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 50),
  })),
})));

router.get('/:id', handle(async (req) => ({
  success: true,
  request: await mayaRequests.getRequest(req.user.userId, req.params.id),
})));

router.post('/:id/respond', handle(async (req) =>
  mayaRequests.respond(req.user.userId, req.params.id, req.body || {}).then((r) => ({ success: true, ...r }))));

router.post('/:id/confirm', handle(async (req) => ({
  success: true,
  request: await mayaRequests.confirm(req.user.userId, req.params.id, req.body || {}),
})));

router.post('/:id/cancel', handle(async (req) => ({
  success: true,
  request: await mayaRequests.cancel(req.user.userId, req.params.id),
})));

router.post('/:id/nudge', handle(async (req) => ({
  success: true,
  request: await mayaRequests.nudge(req.user.userId, req.params.id, req.body || {}),
})));

module.exports = router;
