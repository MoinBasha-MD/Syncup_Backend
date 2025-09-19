const cluster = require('cluster');
const os = require('os');
const winston = require('winston');

/**
 * Performance Optimization Middleware
 * Includes clustering, caching, and performance monitoring
 */

// Performance monitoring
const performanceStats = {
  requestCount: 0,
  responseTimeSum: 0,
  errorCount: 0,
  activeRequests: 0,
  startTime: Date.now()
};

/**
 * Request performance tracking middleware
 */
const performanceTracker = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  performanceStats.requestCount++;
  performanceStats.activeRequests++;

  // Add request ID for tracking
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = process.hrtime.bigint();
    const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    performanceStats.responseTimeSum += responseTime;
    performanceStats.activeRequests--;
    
    if (res.statusCode >= 400) {
      performanceStats.errorCount++;
    }
    
    // Add performance headers only if headers haven't been sent yet
    if (!res.headersSent) {
      res.set('X-Response-Time', `${responseTime.toFixed(2)}ms`);
      res.set('X-Request-ID', req.requestId);
    }
    
    // Log slow requests (>1000ms)
    if (responseTime > 1000) {
      winston.warn('Slow request detected', {
        requestId: req.requestId,
        method: req.method,
        url: req.url,
        responseTime: `${responseTime.toFixed(2)}ms`,
        statusCode: res.statusCode
      });
    }
    
    originalEnd.apply(this, args);
  };
  
  next();
};

/**
 * Response caching middleware for static/semi-static content
 */
const responseCache = (duration = 300) => { // 5 minutes default
  const cache = new Map();
  const maxCacheSize = 1000; // Maximum number of cached responses
  
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip caching for authenticated requests (unless specifically allowed)
    if (req.headers.authorization && !req.url.includes('/health') && !req.url.includes('/metrics')) {
      return next();
    }
    
    const cacheKey = `${req.method}:${req.url}`;
    const cachedResponse = cache.get(cacheKey);
    
    if (cachedResponse && Date.now() - cachedResponse.timestamp < duration * 1000) {
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `public, max-age=${duration}`);
      return res.status(cachedResponse.statusCode).json(cachedResponse.data);
    }
    
    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Implement LRU cache eviction
        if (cache.size >= maxCacheSize) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        
        cache.set(cacheKey, {
          data,
          statusCode: res.statusCode,
          timestamp: Date.now()
        });
        
        res.set('X-Cache', 'MISS');
        res.set('Cache-Control', `public, max-age=${duration}`);
      }
      
      originalJson.call(this, data);
    };
    
    next();
  };
};

/**
 * Request timeout middleware
 */
const requestTimeout = (timeout = 30000) => { // 30 seconds default
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            type: 'TimeoutError',
            message: 'Request timeout',
            statusCode: 408,
            timestamp: new Date().toISOString()
          }
        });
      }
    }, timeout);
    
    // Clear timeout when response is sent
    const originalEnd = res.end;
    res.end = function(...args) {
      clearTimeout(timer);
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

/**
 * Connection pooling optimization for database
 */
const optimizeConnectionPool = () => {
  const cpuCount = os.cpus().length;
  
  return {
    // MongoDB connection pool settings
    maxPoolSize: Math.max(10, cpuCount * 2), // At least 10, or 2 per CPU core
    minPoolSize: Math.max(5, cpuCount), // At least 5, or 1 per CPU core
    maxIdleTimeMS: 30000, // 30 seconds
    waitQueueTimeoutMS: 5000, // 5 seconds
    serverSelectionTimeoutMS: 5000, // 5 seconds
    socketTimeoutMS: 45000, // 45 seconds
    heartbeatFrequencyMS: 10000 // 10 seconds
  };
};

/**
 * Clustering setup for multi-core utilization
 */
const setupClustering = () => {
  const numCPUs = os.cpus().length;
  const maxWorkers = Math.min(numCPUs, 8); // Limit to 8 workers max
  
  if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    console.log(`🚀 Master process ${process.pid} is running`);
    console.log(`🔧 Starting ${maxWorkers} worker processes...`);
    
    // Fork workers
    for (let i = 0; i < maxWorkers; i++) {
      cluster.fork();
    }
    
    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
      console.log(`💥 Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      cluster.fork();
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Master received SIGTERM, shutting down workers...');
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
    
    return true; // Master process
  }
  
  return false; // Worker process or development
};

/**
 * Memory usage monitoring and cleanup
 */
const memoryMonitor = () => {
  const checkInterval = 60000; // Check every minute
  const memoryThreshold = 0.85; // 85% of available memory
  
  setInterval(() => {
    const usage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const usedMemory = usage.rss;
    const memoryUsagePercent = usedMemory / totalMemory;
    
    if (memoryUsagePercent > memoryThreshold) {
      winston.warn('High memory usage detected', {
        usedMemory: `${Math.round(usedMemory / 1024 / 1024)}MB`,
        totalMemory: `${Math.round(totalMemory / 1024 / 1024)}MB`,
        percentage: `${(memoryUsagePercent * 100).toFixed(2)}%`
      });
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        winston.info('Forced garbage collection executed');
      }
    }
  }, checkInterval);
};

/**
 * Get current performance statistics
 */
const getPerformanceStats = () => {
  const uptime = Date.now() - performanceStats.startTime;
  const avgResponseTime = performanceStats.requestCount > 0 
    ? performanceStats.responseTimeSum / performanceStats.requestCount 
    : 0;
  const requestsPerSecond = performanceStats.requestCount / (uptime / 1000);
  const errorRate = performanceStats.requestCount > 0 
    ? (performanceStats.errorCount / performanceStats.requestCount) * 100 
    : 0;
  
  return {
    uptime: uptime,
    totalRequests: performanceStats.requestCount,
    activeRequests: performanceStats.activeRequests,
    requestsPerSecond: requestsPerSecond,
    averageResponseTime: avgResponseTime,
    errorCount: performanceStats.errorCount,
    errorRate: errorRate,
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  };
};

/**
 * Express middleware for performance optimization
 */
const performanceOptimization = () => {
  return [
    performanceTracker,
    requestTimeout(30000), // 30 second timeout
    responseCache(300) // 5 minute cache
  ];
};

module.exports = {
  performanceTracker,
  responseCache,
  requestTimeout,
  optimizeConnectionPool,
  setupClustering,
  memoryMonitor,
  getPerformanceStats,
  performanceOptimization
};
