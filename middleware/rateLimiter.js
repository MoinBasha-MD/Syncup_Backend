/**
 * ✅ WEEK 2 FIX: Rate Limiting Middleware
 * Prevents spam, abuse, and server overload by limiting request frequency
 */

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for post creation
 * Limit: 10 posts per 15 minutes per user
 */
const postCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 posts per window
  message: {
    success: false,
    message: 'Too many posts created. Please try again in 15 minutes.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Use user ID as key (requires authentication)
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip;
  },
  // Skip rate limiting for successful requests only
  skipSuccessfulRequests: false,
  // Skip rate limiting for failed requests
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Post creation limit exceeded for user ${req.user?._id}`);
    res.status(429).json({
      success: false,
      message: 'Too many posts created. Please try again in 15 minutes.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Rate limiter for comments
 * Limit: 30 comments per 15 minutes per user
 */
const commentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Max 30 comments per window
  message: {
    success: false,
    message: 'Too many comments posted. Please try again in 15 minutes.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip;
  },
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Comment limit exceeded for user ${req.user?._id}`);
    res.status(429).json({
      success: false,
      message: 'Too many comments posted. Please try again in 15 minutes.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Rate limiter for likes
 * Limit: 100 likes per 15 minutes per user
 */
const likeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 likes per window
  message: {
    success: false,
    message: 'Too many likes. Please try again in 15 minutes.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip;
  },
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Like limit exceeded for user ${req.user?._id}`);
    res.status(429).json({
      success: false,
      message: 'Too many likes. Please slow down.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Rate limiter for follow/unfollow actions
 * Limit: 20 follow actions per hour per user
 */
const followLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Max 20 follow actions per hour
  message: {
    success: false,
    message: 'Too many follow/unfollow actions. Please try again in 1 hour.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip;
  },
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Follow limit exceeded for user ${req.user?._id}`);
    res.status(429).json({
      success: false,
      message: 'Too many follow/unfollow actions. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Rate limiter for page creation
 * Limit: 5 pages per day per user
 */
const pageCreationLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // Max 5 pages per day
  message: {
    success: false,
    message: 'Too many pages created. You can create up to 5 pages per day.',
    retryAfter: '24 hours'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip;
  },
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Page creation limit exceeded for user ${req.user?._id}`);
    res.status(429).json({
      success: false,
      message: 'You have reached the daily limit of 5 pages. Please try again tomorrow.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * General API rate limiter
 * Limit: 100 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per window
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] General limit exceeded for IP ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Strict rate limiter for authentication endpoints
 * Limit: 5 attempts per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    console.warn(`⚠️ [RATE LIMIT] Auth limit exceeded for IP ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

module.exports = {
  postCreationLimiter,
  commentLimiter,
  likeLimiter,
  followLimiter,
  pageCreationLimiter,
  generalLimiter,
  authLimiter
};
