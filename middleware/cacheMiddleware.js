const { getAsync, setAsync } = require('../config/redis');
const { InternalServerError } = require('../utils/errorClasses');

/**
 * Cache middleware for API responses
 * @param {number} duration - Cache duration in seconds
 * @returns {Function} - Express middleware
 */
const cache = (duration = 3600) => {
  return async (req, res, next) => {
    // Skip caching for non-GET requests and POST requests with body
    if (req.method !== 'GET' && !(req.method === 'POST' && req.body)) {
      return next();
    }

    // Create a cache key from the request URL, method, and user ID (if authenticated)
    const userId = req.user ? req.user._id || req.user.userId || 'unknown' : 'public';
    let cacheKey;
    
    if (req.method === 'GET') {
      cacheKey = `${userId}:${req.method}:${req.originalUrl}`;
    } else {
      // For POST requests, include a hash of the body in the cache key
      const bodyHash = JSON.stringify(req.body);
      cacheKey = `${userId}:${req.method}:${req.originalUrl}:${bodyHash}`;
    }

    try {
      // Try to get cached response
      const cachedResponse = await getAsync(cacheKey);

      if (cachedResponse) {
        try {
          // Return cached response
          const parsedResponse = JSON.parse(cachedResponse);
          return res.status(200).json(parsedResponse);
        } catch (parseError) {
          console.error('Error parsing cached response:', parseError);
          // Continue to controller if parsing fails
        }
      }

      // If no cached response, continue to the controller
      // Capture the original res.json method
      const originalJson = res.json;

      // Override res.json method to cache the response
      res.json = function (data) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Cache the response
          setAsync(cacheKey, JSON.stringify(data), 'EX', duration)
            .catch(err => console.error(`Redis cache error for key ${cacheKey}:`, err));
        }

        // Call the original json method
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      // Continue without caching if there's an error
      next();
    }
  };
};

/**
 * Cache invalidation middleware
 * @param {string} pattern - Cache key pattern to invalidate
 * @returns {Function} - Express middleware
 */
const invalidateCache = (pattern) => {
  return async (req, res, next) => {
    try {
      // Get the user ID if authenticated
      const userId = req.user ? req.user._id : 'public';
      
      // Create the cache key pattern
      const cachePattern = pattern 
        ? `${userId}:${pattern}` 
        : `${userId}:*`;

      // Store the pattern in the request object for later use
      req.cachePattern = cachePattern;

      // Continue to the controller
      next();
    } catch (error) {
      console.error('Cache invalidation middleware error:', error);
      next(new InternalServerError('Error invalidating cache'));
    }
  };
};

/**
 * Helper function to invalidate cache after a successful operation
 * @param {string} pattern - Cache key pattern to invalidate
 */
const invalidateCacheByPattern = async (pattern) => {
  try {
    const { client } = require('../config/redis');
    
    // Use Redis KEYS command to find matching keys
    client.keys(pattern, (err, keys) => {
      if (err) {
        console.error('Redis KEYS error:', err);
        return;
      }
      
      if (keys.length > 0) {
        // Delete all matching keys
        client.del(keys, (err, count) => {
          if (err) {
            console.error('Redis DEL error:', err);
          } else {
            console.log(`Invalidated ${count} cache entries matching pattern: ${pattern}`);
          }
        });
      }
    });
  } catch (error) {
    console.error('Error invalidating cache by pattern:', error);
  }
};

module.exports = {
  cache,
  invalidateCache,
  invalidateCacheByPattern,
};
