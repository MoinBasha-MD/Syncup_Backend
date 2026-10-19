/**
 * Uniform /api/admin/v2 envelope:
 *   success: { ok:true, data, nextCursor? }
 *   failure: { ok:false, code, message }
 */

const ok = (res, data, nextCursor) => {
  const body = { ok: true, data };
  if (nextCursor !== undefined && nextCursor !== null) body.nextCursor = nextCursor;
  return res.json(body);
};

const fail = (res, status, code, message) =>
  res.status(status).json({ ok: false, code, message });

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseLimit = (value, { fallback = 30, max = 100 } = {}) => {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const mongoose = require('mongoose');

const isValidObjectId = (value) =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

/** Error class thrown inside v2 handlers; converted by the router-level error handler. */
class AdminV2Error extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (code, message) => new AdminV2Error(400, code, message);
const unauthorized = (code, message) => new AdminV2Error(401, code, message);
const forbidden = (code, message) => new AdminV2Error(403, code, message);
const notFound = (code, message) => new AdminV2Error(404, code, message);

/** Wrap async handlers so thrown AdminV2Error / unexpected errors hit the local handler. */
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Router-local error handler — mount last inside the v2 router. */
const adminV2ErrorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  if (status >= 500) {
    console.error(`❌ [ADMIN V2] ${req.method} ${req.path}:`, err);
  }
  return fail(res, status, code, err.message || 'Internal server error');
};

module.exports = {
  ok,
  fail,
  escapeRegex,
  parseLimit,
  isValidObjectId,
  AdminV2Error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  handle,
  adminV2ErrorHandler,
};
