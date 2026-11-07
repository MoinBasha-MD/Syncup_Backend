/**
 * Global, conservative clamp for listing query parameters.
 *
 * Express 5 exposes `req.query` as a prototype getter that re-parses on every
 * access, so this installs an own property with the clamped values. Controllers
 * keep using `req.query.page/limit/skip/offset` unchanged.
 */
const MAX_LIMIT = 200;
const MAX_PAGE = 100000;
const MAX_OFFSET = 1000000;

const toInt = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

module.exports = (req, res, next) => {
  const query = req.query;
  if (!query || typeof query !== 'object' || Buffer.isBuffer(query)) return next();

  const clamped = { ...query };

  for (const key of ['limit', 'perPage', 'pageSize']) {
    const n = toInt(clamped[key]);
    if (n !== null) clamped[key] = String(Math.min(MAX_LIMIT, Math.max(1, n)));
  }
  for (const key of ['page']) {
    const n = toInt(clamped[key]);
    if (n !== null) clamped[key] = String(Math.min(MAX_PAGE, Math.max(1, n)));
  }
  for (const key of ['skip', 'offset']) {
    const n = toInt(clamped[key]);
    if (n !== null) clamped[key] = String(Math.min(MAX_OFFSET, Math.max(0, n)));
  }

  Object.defineProperty(req, 'query', {
    value: clamped,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  next();
};
