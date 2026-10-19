const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for authentication
 * @param {string} id - MongoDB ObjectId of the user
 * @param {string} userId - UUID of the user
 * @param {Object} [sessionData] - Optional session/device claims for linked devices
 * @param {number} [tokenVersion] - User's tokenVersion (force-logout counter)
 * @returns {string} JWT token
 */
const generateToken = (id, userId, sessionData = null, tokenVersion = 0) => {
  const payload = { id, userId, tv: tokenVersion };

  if (sessionData) {
    payload.sessionId = sessionData.sessionId;
    payload.deviceId = sessionData.deviceId;
    payload.tokenType = 'desk';
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

const generateDeskToken = (id, userId, sessionData, tokenVersion = 0) => {
  return jwt.sign(
    { id, userId, ...sessionData, tokenType: 'desk', tv: tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (sessionId) => {
  return jwt.sign(
    { sessionId, tokenType: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * Short-lived read-only user token issued to an admin for impersonation.
 * authMiddleware marks the request with req.user.impersonatedBy and rejects
 * non-GET methods for these tokens.
 * @param {Object} user - user document (needs _id, userId, tokenVersion)
 * @param {string|ObjectId} adminId - impersonating admin's id
 * @returns {string} JWT token (15m)
 */
const signImpersonationToken = (user, adminId) => {
  return jwt.sign(
    {
      id: user._id,
      userId: user.userId,
      tokenType: 'impersonation',
      imp: String(adminId),
      tv: user.tokenVersion || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

module.exports = { generateToken, generateDeskToken, generateRefreshToken, signImpersonationToken };
