const redis = require('redis');

// Track Redis connection status
let redisAvailable = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Create Redis client with connection options
const client = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  password: process.env.REDIS_PASSWORD || '',
  socket: {
    connectTimeout: 5000, // 5 seconds timeout
    reconnectStrategy: (retries) => {
      if (retries >= MAX_CONNECTION_ATTEMPTS) {
        console.log(`Redis connection failed after ${retries} attempts. Running in fallback mode.`);
        return new Error('Redis connection failed, running in fallback mode');
      }
      // Reconnect with exponential backoff, max 5 seconds
      return Math.min(retries * 500, 5000);
    }
  }
});

// Handle Redis connection events
client.on('connect', () => {
  console.log('Redis client connected');
  redisAvailable = true;
  connectionAttempts = 0;
});

client.on('error', (err) => {
  console.error(`Redis error: ${err.message || err}`);
  if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
    redisAvailable = false;
  }
});

client.on('reconnecting', () => {
  console.log(`Redis client reconnecting... (attempt ${++connectionAttempts})`);
});

client.on('end', () => {
  console.log('Redis connection ended');
  redisAvailable = false;
});

// Connect to Redis only if enabled
(async () => {
  // Check if Redis is enabled in environment variables
  const redisEnabled = process.env.REDIS_ENABLED !== 'false';
  
  if (!redisEnabled) {
    console.log('Redis is disabled in configuration. Running in memory-only mode.');
    redisAvailable = false;
    return;
  }
  
  try {
    await client.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message || err);
    redisAvailable = false;
    console.log('Application will run without Redis caching');
  }
})();

// In-memory cache as fallback when Redis is unavailable
const memoryCache = new Map();
const memoryCacheExpiry = new Map();

// Helper function to clean expired items from memory cache
const cleanMemoryCache = () => {
  const now = Date.now();
  for (const [key, expiry] of memoryCacheExpiry.entries()) {
    if (expiry <= now) {
      memoryCache.delete(key);
      memoryCacheExpiry.delete(key);
    }
  }
};

// Run cache cleanup every minute
setInterval(cleanMemoryCache, 60000);

// Helper functions that handle Redis errors gracefully with fallback to memory cache
const getAsync = async (key) => {
  // Clean expired items from memory cache
  cleanMemoryCache();
  
  // If Redis is not available, use memory cache
  if (!redisAvailable) {
    return memoryCache.get(key) || null;
  }
  
  try {
    if (!client.isOpen) {
      // Try to reconnect if not at max attempts
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log('Redis client not connected, attempting to reconnect...');
        await client.connect();
      } else {
        // Fall back to memory cache
        return memoryCache.get(key) || null;
      }
    }
    const result = await client.get(key);
    return result;
  } catch (err) {
    console.error(`Redis getAsync error for key ${key}:`, err.message || err);
    // Fall back to memory cache
    return memoryCache.get(key) || null;
  }
};

const setAsync = async (key, value, expiryType, expiry) => {
  // If Redis is not available, use memory cache
  if (!redisAvailable) {
    // Store in memory cache
    memoryCache.set(key, value);
    
    // Set expiry if provided
    if (expiryType === 'EX' && expiry) {
      const expiryMs = expiry * 1000; // Convert seconds to milliseconds
      memoryCacheExpiry.set(key, Date.now() + expiryMs);
    }
    return true;
  }
  
  try {
    if (!client.isOpen) {
      // Try to reconnect if not at max attempts
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log('Redis client not connected, attempting to reconnect...');
        await client.connect();
      } else {
        // Fall back to memory cache
        memoryCache.set(key, value);
        if (expiryType === 'EX' && expiry) {
          const expiryMs = expiry * 1000;
          memoryCacheExpiry.set(key, Date.now() + expiryMs);
        }
        return true;
      }
    }
    
    // Also store in memory cache as backup
    memoryCache.set(key, value);
    if (expiryType === 'EX' && expiry) {
      const expiryMs = expiry * 1000;
      memoryCacheExpiry.set(key, Date.now() + expiryMs);
    }
    
    // Store in Redis
    if (expiryType && expiry) {
      return await client.set(key, value, { [expiryType]: expiry });
    }
    return await client.set(key, value);
  } catch (err) {
    console.error(`Redis setAsync error for key ${key}:`, err.message || err);
    // Fall back to memory cache
    memoryCache.set(key, value);
    if (expiryType === 'EX' && expiry) {
      const expiryMs = expiry * 1000;
      memoryCacheExpiry.set(key, Date.now() + expiryMs);
    }
    return true;
  }
};

const delAsync = async (key) => {
  // Always remove from memory cache
  memoryCache.delete(key);
  memoryCacheExpiry.delete(key);
  
  // If Redis is not available, just return success
  if (!redisAvailable) {
    return 1;
  }
  
  try {
    if (!client.isOpen) {
      // Try to reconnect if not at max attempts
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log('Redis client not connected, attempting to reconnect...');
        await client.connect();
      } else {
        return 1; // Return as if deletion was successful
      }
    }
    return await client.del(key);
  } catch (err) {
    console.error(`Redis delAsync error for key ${key}:`, err.message || err);
    return 1; // Return as if deletion was successful
  }
};

const expireAsync = async (key, seconds) => {
  // Update memory cache expiry
  if (memoryCache.has(key)) {
    memoryCacheExpiry.set(key, Date.now() + (seconds * 1000));
  }
  
  // If Redis is not available, just return success
  if (!redisAvailable) {
    return true;
  }
  
  try {
    if (!client.isOpen) {
      // Try to reconnect if not at max attempts
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log('Redis client not connected, attempting to reconnect...');
        await client.connect();
      } else {
        return true; // Return as if expiry was set successfully
      }
    }
    return await client.expire(key, seconds);
  } catch (err) {
    console.error(`Redis expireAsync error for key ${key}:`, err.message || err);
    return true; // Return as if expiry was set successfully
  }
};

module.exports = {
  client,
  getAsync,
  setAsync,
  delAsync,
  expireAsync,
};
