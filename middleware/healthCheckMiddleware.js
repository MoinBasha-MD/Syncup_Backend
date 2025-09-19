const mongoose = require('mongoose');
const { performance } = require('perf_hooks');

/**
 * Comprehensive health check middleware
 * Provides detailed system health information
 */

const healthCheck = async (req, res) => {
  const startTime = performance.now();
  const healthStatus = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    checks: {}
  };

  try {
    // Database connectivity check
    const dbStart = performance.now();
    const dbState = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    healthStatus.checks.database = {
      status: dbState === 1 ? 'UP' : 'DOWN',
      state: dbStates[dbState],
      responseTime: `${(performance.now() - dbStart).toFixed(2)}ms`
    };

    if (dbState === 1) {
      // Test database query
      try {
        const dbTestStart = performance.now();
        await mongoose.connection.db.admin().ping();
        healthStatus.checks.database.ping = `${(performance.now() - dbTestStart).toFixed(2)}ms`;
      } catch (error) {
        healthStatus.checks.database.status = 'DOWN';
        healthStatus.checks.database.error = error.message;
      }
    }

    // Memory usage check
    const memUsage = process.memoryUsage();
    healthStatus.checks.memory = {
      status: 'UP',
      usage: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
      },
      heapUsedPercentage: `${((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2)}%`
    };

    // CPU usage check (basic)
    const cpuUsage = process.cpuUsage();
    healthStatus.checks.cpu = {
      status: 'UP',
      usage: {
        user: `${(cpuUsage.user / 1000).toFixed(2)}ms`,
        system: `${(cpuUsage.system / 1000).toFixed(2)}ms`
      }
    };

    // Disk space check (if available)
    try {
      const fs = require('fs');
      const stats = fs.statSync('./');
      healthStatus.checks.disk = {
        status: 'UP',
        available: 'Check manually' // Node.js doesn't have built-in disk space check
      };
    } catch (error) {
      healthStatus.checks.disk = {
        status: 'UNKNOWN',
        error: 'Unable to check disk space'
      };
    }

    // Environment variables check
    const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    healthStatus.checks.environment = {
      status: missingEnvVars.length === 0 ? 'UP' : 'DOWN',
      required: requiredEnvVars,
      missing: missingEnvVars
    };

    // Overall status determination
    const allChecks = Object.values(healthStatus.checks);
    const hasDownServices = allChecks.some(check => check.status === 'DOWN');
    
    if (hasDownServices) {
      healthStatus.status = 'DOWN';
    }

    // Response time
    healthStatus.responseTime = `${(performance.now() - startTime).toFixed(2)}ms`;

    // Set appropriate HTTP status
    const httpStatus = healthStatus.status === 'UP' ? 200 : 503;
    
    res.status(httpStatus).json(healthStatus);

  } catch (error) {
    healthStatus.status = 'DOWN';
    healthStatus.error = error.message;
    healthStatus.responseTime = `${(performance.now() - startTime).toFixed(2)}ms`;
    
    res.status(503).json(healthStatus);
  }
};

/**
 * Simple liveness probe
 */
const liveness = (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    message: 'Service is alive'
  });
};

/**
 * Readiness probe
 */
const readiness = async (req, res) => {
  try {
    // Check if database is ready
    const dbState = mongoose.connection.readyState;
    
    if (dbState !== 1) {
      return res.status(503).json({
        status: 'NOT_READY',
        timestamp: new Date().toISOString(),
        message: 'Database not ready',
        database: { state: dbState }
      });
    }

    // Check if required environment variables are set
    const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingEnvVars.length > 0) {
      return res.status(503).json({
        status: 'NOT_READY',
        timestamp: new Date().toISOString(),
        message: 'Missing required environment variables',
        missing: missingEnvVars
      });
    }

    res.status(200).json({
      status: 'READY',
      timestamp: new Date().toISOString(),
      message: 'Service is ready to accept requests'
    });

  } catch (error) {
    res.status(503).json({
      status: 'NOT_READY',
      timestamp: new Date().toISOString(),
      message: 'Service not ready',
      error: error.message
    });
  }
};

/**
 * Metrics endpoint for monitoring systems
 */
const metrics = (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  const metrics = {
    timestamp: new Date().toISOString(),
    process: {
      uptime: process.uptime(),
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    memory: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers || 0
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    database: {
      state: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name
    }
  };

  res.status(200).json(metrics);
};

module.exports = {
  healthCheck,
  liveness,
  readiness,
  metrics
};
