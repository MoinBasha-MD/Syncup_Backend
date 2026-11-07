const IdempotencyKey = require('../models/IdempotencyKey');
const { fail } = require('../utils/adminV2Response');

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const inFlight = new Set();

/**
 * Idempotency-Key for admin v2 mutations. Mount after requireAdminV2.
 *
 * - no header            → pass through
 * - first request        → capture res.json and persist for 24h
 * - replay               → return the stored response with Idempotent-Replay
 * - concurrent duplicate → 409 IDEMPOTENCY_IN_PROGRESS
 */
const idempotency = (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!MUTATING.has(req.method) || key === undefined) return next();

  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    return fail(res, 400, 'BAD_REQUEST', 'Idempotency-Key must be 8-128 characters');
  }
  if (!req.admin?._id) return next(); // auth routes never reach here

  const scope = `${req.admin._id}:${key}:${req.method}:${req.baseUrl}${req.path}`;

  if (inFlight.has(scope)) {
    return fail(res, 409, 'IDEMPOTENCY_IN_PROGRESS', 'This action is already running');
  }

  IdempotencyKey.findOne({
    adminId: req.admin._id,
    key,
    method: req.method,
    path: `${req.baseUrl}${req.path}`,
  })
    .lean()
    .then((existing) => {
      if (existing) {
        res.set('Idempotent-Replay', 'true');
        return res.status(existing.status || 200).json(existing.body);
      }

      inFlight.add(scope);
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        IdempotencyKey.create({
          adminId: req.admin._id,
          key,
          method: req.method,
          path: `${req.baseUrl}${req.path}`,
          status: res.statusCode || 200,
          body,
        }).catch((error) => {
          if (error.code !== 11000) console.error('❌ [IDEMPOTENCY] store failed:', error.message);
        });
        return originalJson(body);
      };
      res.on('finish', () => inFlight.delete(scope));
      res.on('close', () => inFlight.delete(scope));
      return next();
    })
    .catch(next);
};

module.exports = { idempotency };
