const { ApiError } = require('../utils/errorClasses');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-service' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error({
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    ip: req.ip,
    body: req.body,
    params: req.params,
    query: req.query,
  });

  // Check if it's our custom API error
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      error: err.name
    });
  }

  // ✅ FIX: Multer file-size/type errors previously fell through to the
  // generic 500 handler below, giving clients a confusing "Internal Server
  // Error" instead of a clear, actionable message when a file/video/image
  // exceeded its upload limit.
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'File is too large for this upload type.',
        error: 'LIMIT_FILE_SIZE'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload error',
      error: err.code || 'MulterError'
    });
  }

  // Handle mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    return res.status(400).json({
      success: false,
      message: messages.join(', '),
      error: 'ValidationError'
    });
  }

  // Handle mongoose duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`,
      error: 'DuplicateKeyError'
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: 'JsonWebTokenError'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
      error: 'TokenExpiredError'
    });
  }

  // Check if response has already been sent
  if (res.headersSent) {
    console.error('❌ Headers already sent, cannot send error response:', err.message);
    return next(err);
  }

  // Default to 500 server error
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    error: err.name || 'Error'
  });
};

// Not found middleware
const notFound = (req, res, next) => {
  // Ignore common bot/scanner requests to reduce noise in logs
  const ignoredPaths = ['/index.htm', '/index.html', '/.env', '/wp-admin', '/phpMyAdmin', '/admin'];
  if (ignoredPaths.some(path => req.originalUrl.includes(path))) {
    return res.status(404).end(); // Silent 404 for bots
  }

  // Silently 404 missing upload files (post-media, profile-images, etc.)
  // These are expected when files are lost during server migrations / redeployments
  // and don't need to pollute the error log.
  if (req.originalUrl.startsWith('/uploads/') || req.originalUrl.includes('/api/uploads/')) {
    return res.status(404).end();
  }

  const error = new ApiError(`Not Found - ${req.originalUrl}`, 404);
  next(error);
};

module.exports = { errorHandler, notFound };
