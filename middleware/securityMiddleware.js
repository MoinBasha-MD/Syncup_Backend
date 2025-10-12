const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const { BadRequestError } = require('../utils/errorClasses');

// Rate limiting middleware
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later',
      error: 'RateLimitError'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });
};

// General API rate limiter - 500 requests per 15 minutes
const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  500, // Increased to 500 for general endpoints
  'Too many requests, please try again after 15 minutes'
);

// Auth endpoints rate limiter - 20 requests per 15 minutes
const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  20, // Increased to 20
  'Too many login attempts, please try again after 15 minutes'
);

// User data endpoints rate limiter - 300 requests per 5 minutes
const userDataLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  300,
  'Too many user data requests, please try again after 5 minutes'
);

// Contact endpoints rate limiter - 500 requests per 5 minutes
const contactLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  500,
  'Too many contact requests, please try again after 5 minutes'
);

// Status endpoints rate limiter - VERY HIGH LIMITS (essentially no restriction)
// General status queries (GET) - 10000 requests per 5 minutes (no practical limit)
const statusLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  10000, // Essentially unlimited for normal usage
  'Too many status requests, please try again after 5 minutes'
);

// Status updates (PUT/POST) - 5000 updates per 5 minutes (essentially unlimited)
const statusUpdateLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  5000, // Essentially unlimited for normal usage
  'Too many status updates, please try again after 5 minutes'
);

// Request validation middleware
const validate = (validations) => {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => `${err.param}: ${err.msg}`);
      return next(new BadRequestError(errorMessages.join(', ')));
    }

    next();
  };
};

// Common validation schemas
const userValidationRules = {
  register: [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('phoneNumber')
      .matches(/^[0-9]{10}$/)
      .withMessage('Please provide a valid 10-digit phone number'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
  ],
  login: [
    body('phoneNumber')
      .matches(/^[0-9]{10}$/)
      .withMessage('Please provide a valid 10-digit phone number'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  updateProfile: [
    body('name').optional(),
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('phoneNumber')
      .optional()
      .matches(/^[0-9]{10}$/)
      .withMessage('Please provide a valid 10-digit phone number'),
    body('password')
      .optional()
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
  ],
  updateStatus: [
    body('status').notEmpty().withMessage('Status is required'),
    body('customStatus').optional(),
    body('duration').optional().isNumeric().withMessage('Duration must be a number'),
  ],
};

const statusValidationRules = {
  createTemplate: [
    body('name').notEmpty().withMessage('Name is required'),
    body('status').notEmpty().withMessage('Status is required'),
    body('customStatus').optional(),
    body('duration')
      .notEmpty()
      .isNumeric()
      .withMessage('Duration is required and must be a number'),
  ],
  updateTemplate: [
    body('name').optional(),
    body('status').optional(),
    body('customStatus').optional(),
    body('duration').optional().isNumeric().withMessage('Duration must be a number'),
  ],
  createSchedule: [
    body('status').notEmpty().withMessage('Status is required'),
    body('customStatus').optional(),
    body('startTime').notEmpty().withMessage('Start time is required'),
    body('endTime').notEmpty().withMessage('End time is required'),
    body('repeat').optional(),
  ],
  updateSchedule: [
    body('status').optional(),
    body('customStatus').optional(),
    body('startTime').optional(),
    body('endTime').optional(),
    body('repeat').optional(),
    body('active').optional().isBoolean().withMessage('Active must be a boolean'),
  ],
  bulkCreate: [
    body().isArray().withMessage('Request body must be an array'),
  ],
};

// Security headers middleware using helmet with custom configuration
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for API compatibility
});

// MongoDB injection protection - simplified to avoid compatibility issues
const mongoSanitizer = mongoSanitize({
  replaceWith: '_'
});

// XSS protection middleware
const xssProtection = (req, res, next) => {
  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    }
  }
  
  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = xss(req.query[key]);
      }
    }
  }
  
  next();
};

// HTTP Parameter Pollution protection
const hppProtection = hpp({
  whitelist: ['tags', 'categories'] // Allow arrays for these parameters
});

// Request size limiter
const requestSizeLimiter = (req, res, next) => {
  const contentLength = parseInt(req.get('Content-Length'));
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (contentLength > maxSize) {
    return res.status(413).json({
      success: false,
      message: 'Request entity too large',
      error: 'PayloadTooLargeError'
    });
  }
  
  next();
};

module.exports = {
  apiLimiter,
  authLimiter,
  userDataLimiter,
  contactLimiter,
  statusLimiter,
  statusUpdateLimiter, // Export new status update limiter
  validate,
  userValidationRules,
  statusValidationRules,
  securityHeaders,
  mongoSanitizer,
  xssProtection,
  hppProtection,
  requestSizeLimiter,
};
