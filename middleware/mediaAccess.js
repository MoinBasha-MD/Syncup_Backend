const jwt = require('jsonwebtoken');
const { verifyMediaToken } = require('../utils/mediaToken');

// Grace-mode telemetry: count unauthenticated requests, log at most once/min.
let graceMisses = 0;
let lastGraceLogAt = 0;

/**
 * Media access gate for /uploads. Accepts a signed `?mt=` media token OR a
 * valid Bearer JWT. Enforcement is on by default; set MEDIA_AUTH_ENFORCE=false
 * only as a temporary escape hatch (e.g. while an old client build drains).
 */
const requireMediaAccess = (req, res, next) => {
  let authorized = false;

  const mediaToken = typeof req.query.mt === 'string' ? req.query.mt : null;
  if (mediaToken && verifyMediaToken(mediaToken)) {
    authorized = true;
  }

  if (!authorized) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      try {
        jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        authorized = true;
      } catch {
        authorized = false;
      }
    }
  }

  if (authorized) {
    res.set('Cache-Control', 'private, max-age=86400');
    return next();
  }

  if (process.env.MEDIA_AUTH_ENFORCE !== 'false') {
    return res.status(401).json({
      success: false,
      message: 'Media access requires the Syncup app',
    });
  }

  graceMisses += 1;
  const now = Date.now();
  if (now - lastGraceLogAt >= 60000) {
    console.warn(`⚠️ [MEDIA] ${graceMisses} unauthenticated media requests in grace mode`);
    graceMisses = 0;
    lastGraceLogAt = now;
  }
  next();
};

module.exports = { requireMediaAccess };
