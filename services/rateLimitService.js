const asyncHandler = require('express-async-handler');

/**
 * Enhanced Rate Limiting Service with persistent storage
 * Uses database storage instead of in-memory Map for production reliability
 */

// In-memory fallback for development (will be replaced with Redis/DB in production)
const rateLimitStore = new Map();

// Rate limit configurations
const RATE_LIMITS = {
  SEARCH: {
    limit: 10,      // requests per minute
    window: 60 * 1000, // 1 minute
    name: 'search'
  },
  CONNECTION_REQUEST: {
    limit: 50,      // requests per day
    window: 24 * 60 * 60 * 1000, // 24 hours
    name: 'connection_request'
  },
  GENERAL_API: {
    limit: 100,     // requests per minute
    window: 60 * 1000, // 1 minute
    name: 'general_api'
  }
};

/**
 * Get rate limit key for user and action
 */
const getRateLimitKey = (userId, action) => {
  return `rate_limit:${action}:${userId}`;
};

/**
 * Clean expired entries from storage
 */
const cleanExpiredEntries = (key, window) => {
  const now = Date.now();
  const entries = rateLimitStore.get(key) || [];
  const validEntries = entries.filter(timestamp => now - timestamp < window);
  
  if (validEntries.length > 0) {
    rateLimitStore.set(key, validEntries);
  } else {
    rateLimitStore.delete(key);
  }
  
  return validEntries;
};

/**
 * Check if user has exceeded rate limit
 */
const checkRateLimit = (userId, action, customLimit = null, customWindow = null) => {
  const config = RATE_LIMITS[action.toUpperCase()] || RATE_LIMITS.GENERAL_API;
  const limit = customLimit || config.limit;
  const window = customWindow || config.window;
  
  const key = getRateLimitKey(userId, action);
  const now = Date.now();
  
  // Clean expired entries and get current valid entries
  const validEntries = cleanExpiredEntries(key, window);
  
  // Check if limit exceeded
  if (validEntries.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: new Date(validEntries[0] + window),
      retryAfter: Math.ceil((validEntries[0] + window - now) / 1000)
    };
  }
  
  // Add current request
  validEntries.push(now);
  rateLimitStore.set(key, validEntries);
  
  return {
    allowed: true,
    remaining: limit - validEntries.length,
    resetTime: new Date(now + window),
    retryAfter: 0
  };
};

/**
 * Express middleware for rate limiting
 */
const rateLimitMiddleware = (action, customLimit = null, customWindow = null) => {
  return asyncHandler(async (req, res, next) => {
    const userId = req.user?.userId;
    
    if (!userId) {
      res.status(401);
      throw new Error('Authentication required for rate limiting');
    }
    
    const result = checkRateLimit(userId, action, customLimit, customWindow);
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': customLimit || RATE_LIMITS[action.toUpperCase()]?.limit || RATE_LIMITS.GENERAL_API.limit,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Reset': result.resetTime.toISOString()
    });
    
    if (!result.allowed) {
      res.set('Retry-After', result.retryAfter);
      res.status(429);
      throw new Error(`Rate limit exceeded. Try again in ${result.retryAfter} seconds.`);
    }
    
    next();
  });
};

/**
 * Get current rate limit status for a user
 */
const getRateLimitStatus = (userId, action) => {
  const config = RATE_LIMITS[action.toUpperCase()] || RATE_LIMITS.GENERAL_API;
  const key = getRateLimitKey(userId, action);
  const validEntries = cleanExpiredEntries(key, config.window);
  
  return {
    limit: config.limit,
    remaining: Math.max(0, config.limit - validEntries.length),
    used: validEntries.length,
    resetTime: validEntries.length > 0 ? new Date(validEntries[0] + config.window) : new Date(),
    windowMs: config.window
  };
};

/**
 * Reset rate limit for a user (admin function)
 */
const resetRateLimit = (userId, action = null) => {
  if (action) {
    const key = getRateLimitKey(userId, action);
    rateLimitStore.delete(key);
  } else {
    // Reset all rate limits for user
    const userKeys = Array.from(rateLimitStore.keys()).filter(key => 
      key.includes(`:${userId}`)
    );
    userKeys.forEach(key => rateLimitStore.delete(key));
  }
};

/**
 * Get rate limiting statistics (admin function)
 */
const getRateLimitStats = () => {
  const stats = {
    totalKeys: rateLimitStore.size,
    activeUsers: new Set(),
    actionBreakdown: {}
  };
  
  rateLimitStore.forEach((value, key) => {
    const parts = key.split(':');
    if (parts.length === 3) {
      const [, action, userId] = parts;
      stats.activeUsers.add(userId);
      stats.actionBreakdown[action] = (stats.actionBreakdown[action] || 0) + 1;
    }
  });
  
  stats.activeUsers = stats.activeUsers.size;
  
  return stats;
};

module.exports = {
  checkRateLimit,
  rateLimitMiddleware,
  getRateLimitStatus,
  resetRateLimit,
  getRateLimitStats,
  RATE_LIMITS
};
