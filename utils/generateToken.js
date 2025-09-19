const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for authentication
 * @param {string} id - MongoDB ObjectId of the user
 * @param {string} userId - UUID of the user
 * @returns {string} JWT token
 */
const generateToken = (id, userId) => {
  return jwt.sign({ id, userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

module.exports = { generateToken };
