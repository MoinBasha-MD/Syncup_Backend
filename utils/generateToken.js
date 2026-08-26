const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for authentication
 * @param {string} id - MongoDB ObjectId of the user
 * @param {string} userId - UUID of the user
 * @param {Object} [sessionData] - Optional session/device claims for linked devices
 * @returns {string} JWT token
 */
const generateToken = (id, userId, sessionData = null) => {
  const payload = { id, userId };

  if (sessionData) {
    payload.sessionId = sessionData.sessionId;
    payload.deviceId = sessionData.deviceId;
    payload.tokenType = 'desk';
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

const generateDeskToken = (id, userId, sessionData) => {
  return jwt.sign(
    { id, userId, ...sessionData, tokenType: 'desk' },
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

module.exports = { generateToken, generateDeskToken, generateRefreshToken };
