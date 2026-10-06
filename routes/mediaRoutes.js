const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { issueMediaToken } = require('../utils/mediaToken');

const router = express.Router();

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

router.get('/token', protect, (req, res) => {
  try {
    const token = issueMediaToken(req.user.userId, TOKEN_TTL_MS);
    res.json({
      success: true,
      data: {
        token,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      },
    });
  } catch (error) {
    console.error('❌ Failed to issue media token');
    res.status(500).json({ success: false, message: 'Failed to issue media token' });
  }
});

module.exports = router;
