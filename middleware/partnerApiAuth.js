const rateLimit = require('express-rate-limit');
const partnerService = require('../services/partnerService');

const invalidKey = (res) => res.status(401).json({
  success: false,
  code: 'INVALID_API_KEY',
  message: 'Invalid API key',
});

const partnerApiAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : null;
    if (!token) return invalidKey(res);
    const { partner, app, key } = await partnerService.authenticateApiKey(token);
    req.partnerApi = { partner, app, key };
    return next();
  } catch (error) {
    return invalidKey(res);
  }
};

const keyRateLimiter = (limit) => rateLimit({
  windowMs: 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.partnerApi?.key?.keyId || req.ip,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests' },
});

const apiKeyLimiter = keyRateLimiter(120);
const messageLimiter = keyRateLimiter(30);
const pairingLimiter = keyRateLimiter(10);

const requireScope = (scope) => (req, res, next) => {
  const scopes = req.partnerApi && req.partnerApi.key ? req.partnerApi.key.scopes : [];
  if (!scopes.includes(scope)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_SCOPE',
      message: 'API key lacks the required scope',
    });
  }
  return next();
};

module.exports = { partnerApiAuth, apiKeyLimiter, messageLimiter, pairingLimiter, requireScope };
