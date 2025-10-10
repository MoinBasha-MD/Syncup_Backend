const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const serviceTag = service ? `[${service.toUpperCase()}]` : '';
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} ${level} ${serviceTag} ${message} ${metaStr}`;
  })
);

// File format
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// 1. Server Logger - General server operations
const serverLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  defaultMeta: { service: 'server' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'server.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// 2. AI Communication Logger - AI-to-AI messages and routing
const aiLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  defaultMeta: { service: 'ai-communication' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'ai-communication.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `🤖 ${timestamp} ${level} [AI] ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// 3. Connection Logger - Socket.IO connections and network events
const connectionLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  defaultMeta: { service: 'connections' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'connections.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `🔌 ${timestamp} ${level} [CONN] ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// 4. Database Logger - MongoDB operations
const dbLogger = winston.createLogger({
  level: 'info',
  format: fileFormat,
  defaultMeta: { service: 'database' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'database.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `🗄️  ${timestamp} ${level} [DB] ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// 5. Error Logger - All errors across the system
const errorLogger = winston.createLogger({
  level: 'error',
  format: fileFormat,
  defaultMeta: { service: 'errors' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'errors.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `❌ ${timestamp} ${level} [ERROR] ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Helper function to log to multiple loggers
const logToMultiple = (level, message, meta = {}, loggers = []) => {
  loggers.forEach(logger => {
    logger[level](message, meta);
  });
};

// Export all loggers
module.exports = {
  serverLogger,
  aiLogger,
  connectionLogger,
  dbLogger,
  errorLogger,
  logToMultiple,
  
  // Convenience methods
  logServer: (level, message, meta = {}) => serverLogger[level](message, meta),
  logAI: (level, message, meta = {}) => aiLogger[level](message, meta),
  logConnection: (level, message, meta = {}) => connectionLogger[level](message, meta),
  logDB: (level, message, meta = {}) => dbLogger[level](message, meta),
  logError: (message, meta = {}) => errorLogger.error(message, meta),
  
  // Log startup message
  logStartup: () => {
    const startupMessage = `
╔══════════════════════════════════════════════════════════════╗
║                    🚀 SYNCUP SERVER STARTED                  ║
║                                                              ║
║  📊 Server Logs: Green messages with [SERVER] tag           ║
║  🤖 AI Logs: Blue messages with [AI] tag                    ║
║  🔌 Connection Logs: Yellow messages with [CONN] tag        ║
║  🗄️  Database Logs: Cyan messages with [DB] tag             ║
║  ❌ Error Logs: Red messages with [ERROR] tag               ║
║                                                              ║
║  📁 Log files are saved in: ./logs/                         ║
╚══════════════════════════════════════════════════════════════╝
    `;
    console.log(startupMessage);
    serverLogger.info('🚀 Syncup Server Started Successfully');
    aiLogger.info('🤖 AI Communication System Initialized');
    connectionLogger.info('🔌 Connection Manager Ready');
    dbLogger.info('🗄️ Database Connection Established');
  }
};
