const mongoose = require('mongoose');
const winston = require('winston');

// Configure logger for database operations
const dbLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/database.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

const connectDB = async (customOptions = {}) => {
  try {
    // Default connection options
    const defaultOptions = {
      // ⚡ PERFORMANCE OPTIMIZATION: Increased pool size for better concurrency
      // Connection pool settings
      maxPoolSize: 50, // Maximum number of connections in the pool (increased from 10)
      minPoolSize: 10,  // Minimum number of connections in the pool (increased from 5)
      maxIdleTimeMS: 60000, // Close connections after 60 seconds of inactivity (increased from 30s)
      serverSelectionTimeoutMS: 5000, // How long to try selecting a server
      socketTimeoutMS: 45000, // How long to wait for a response
      
      // Connection timeout settings
      waitQueueTimeoutMS: 10000, // 10 seconds (increased from 5s for high load)
      
      // Monitoring and debugging
      heartbeatFrequencyMS: 10000, // Heartbeat every 10 seconds
      
      // Write concern - CRITICAL for data persistence
      writeConcern: {
        w: 1,          // Wait for primary to acknowledge (works with standalone MongoDB)
        j: true,       // Wait for journal commit (ensures durability)
        wtimeout: 5000 // Timeout after 5 seconds
      }
    };

    // Merge custom options with defaults (custom options take precedence)
    const options = { ...defaultOptions, ...customOptions };

    dbLogger.info('Connecting to MongoDB with optimized settings:', {
      maxPoolSize: options.maxPoolSize,
      minPoolSize: options.minPoolSize,
      maxIdleTimeMS: options.maxIdleTimeMS
    });

    const conn = await mongoose.connect(process.env.MONGO_URI, options);

    // Connection event listeners
    mongoose.connection.on('connected', () => {
      dbLogger.info(`🗄️  MongoDB Connected: ${conn.connection.host}:${conn.connection.port}`);
      dbLogger.info(`📊 Database: ${conn.connection.name}`);
    });

    mongoose.connection.on('error', (err) => {
      dbLogger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      dbLogger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      dbLogger.info('MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        dbLogger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        dbLogger.error('Error during MongoDB shutdown:', err);
        process.exit(1);
      }
    });

    // Log connection pool stats periodically (only in development)
    if (process.env.NODE_ENV !== 'production') {
      setInterval(() => {
        const stats = mongoose.connection.db?.stats;
        if (stats) {
          dbLogger.info('Connection Pool Stats:', {
            totalConnections: mongoose.connection.readyState,
            activeConnections: mongoose.connection.db.serverConfig?.connections?.length || 0
          });
        }
      }, 60000); // Every minute
    }

    return conn;
  } catch (error) {
    dbLogger.error('Database connection failed:', {
      message: error.message,
      stack: error.stack
    });
    
    // In production, attempt retry logic
    if (process.env.NODE_ENV === 'production') {
      dbLogger.info('Attempting to reconnect in 5 seconds...');
      setTimeout(() => connectDB(), 5000);
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;
