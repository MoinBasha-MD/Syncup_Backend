// Cheap body-size gate for the Sync Space surfaces (partner API, sync-space
// user API, OAuth, partner portals). It runs BEFORE the global 200mb parsers
// so oversized payloads are rejected without being read into memory.
//
// - Content-Length present and over the limit → 413.
// - A body without Content-Length (chunked) → 411 LENGTH_REQUIRED.
// - GET/HEAD/OPTIONS and requests with no body pass through untouched.
const syncSpaceBodyLimit = (maxBytes) => (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return res.status(400).json({ success: false, code: 'BAD_CONTENT_LENGTH' });
    }
    if (parsed > maxBytes) {
      return res.status(413).json({ success: false, code: 'PAYLOAD_TOO_LARGE' });
    }
    return next();
  }
  if (req.headers['transfer-encoding']) {
    return res.status(411).json({ success: false, code: 'LENGTH_REQUIRED' });
  }
  next();
};

module.exports = syncSpaceBodyLimit;
