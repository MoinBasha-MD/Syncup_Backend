const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  checkUserExists
} = require('../controllers/authController');

// ✅ SECURITY FIX: Add rate limiting to prevent brute force attacks
// Simple in-memory rate limiter (for production, use Redis)
const loginAttempts = new Map();

const rateLimiter = (req, res, next) => {
  const identifier = req.body.phoneNumber || req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  if (!loginAttempts.has(identifier)) {
    loginAttempts.set(identifier, []);
  }
  
  const attempts = loginAttempts.get(identifier);
  // Remove old attempts outside the window
  const recentAttempts = attempts.filter(time => now - time < windowMs);
  
  if (recentAttempts.length >= maxAttempts) {
    const oldestAttempt = recentAttempts[0];
    const timeLeft = Math.ceil((windowMs - (now - oldestAttempt)) / 1000 / 60);
    return res.status(429).json({
      success: false,
      message: `Too many login attempts. Please try again in ${timeLeft} minutes.`
    });
  }
  
  recentAttempts.push(now);
  loginAttempts.set(identifier, recentAttempts);
  
  // Clean up old entries every hour
  if (Math.random() < 0.01) {
    for (const [key, times] of loginAttempts.entries()) {
      const recent = times.filter(time => now - time < windowMs);
      if (recent.length === 0) {
        loginAttempts.delete(key);
      } else {
        loginAttempts.set(key, recent);
      }
    }
  }
  
  next();
};

// Authentication routes - all public
router.post('/register', registerUser);
router.post('/login', rateLimiter, loginUser); // ✅ Add rate limiting to login
router.post('/check', checkUserExists);

// ✅ FIX: Health check endpoint for connection testing
router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    server: 'Syncup Backend'
  });
});

// Alternative health check at root
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
