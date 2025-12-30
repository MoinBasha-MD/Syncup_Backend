/**
 * ✅ WEEK 2 FIX: Input Validation Middleware for Page Posts
 * Validates and sanitizes user input to prevent XSS, injection attacks, and data corruption
 */

const { body, param, validationResult } = require('express-validator');

/**
 * Validation rules for creating/updating page posts
 */
const validatePagePost = [
  // Content validation
  body('content')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Content must be between 1 and 5000 characters')
    .escape(), // Sanitize HTML to prevent XSS
  
  // Visibility validation
  body('visibility')
    .optional()
    .isIn(['public', 'followers', 'custom'])
    .withMessage('Visibility must be one of: public, followers, custom'),
  
  // Target audience validation
  body('targetAudience.enabled')
    .optional()
    .isBoolean()
    .withMessage('targetAudience.enabled must be a boolean'),
  
  body('targetAudience.countries')
    .optional()
    .isArray()
    .withMessage('targetAudience.countries must be an array'),
  
  body('targetAudience.countries.*')
    .optional()
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .toUpperCase()
    .withMessage('Country codes must be 2-letter ISO codes (e.g., US, UK, IN)'),
  
  body('targetAudience.excludeCountries')
    .optional()
    .isArray()
    .withMessage('targetAudience.excludeCountries must be an array'),
  
  body('targetAudience.excludeCountries.*')
    .optional()
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .toUpperCase()
    .withMessage('Exclude country codes must be 2-letter ISO codes'),
  
  body('targetAudience.ageRange.min')
    .optional()
    .isInt({ min: 13, max: 100 })
    .withMessage('Minimum age must be between 13 and 100'),
  
  body('targetAudience.ageRange.max')
    .optional()
    .isInt({ min: 13, max: 100 })
    .withMessage('Maximum age must be between 13 and 100')
    .custom((value, { req }) => {
      if (req.body.targetAudience?.ageRange?.min && value < req.body.targetAudience.ageRange.min) {
        throw new Error('Maximum age must be greater than or equal to minimum age');
      }
      return true;
    }),
  
  body('targetAudience.customListIds')
    .optional()
    .isArray()
    .withMessage('targetAudience.customListIds must be an array'),
  
  body('targetAudience.customListIds.*')
    .optional()
    .isMongoId()
    .withMessage('Custom list IDs must be valid MongoDB ObjectIds'),
  
  // Media validation
  body('media')
    .optional()
    .isArray()
    .withMessage('Media must be an array'),
  
  body('media.*.type')
    .optional()
    .isIn(['image', 'video'])
    .withMessage('Media type must be either image or video'),
  
  body('media.*.url')
    .optional()
    .isURL()
    .withMessage('Media URL must be a valid URL'),
  
  // Hashtags validation
  body('hashtags')
    .optional()
    .isArray()
    .withMessage('Hashtags must be an array'),
  
  body('hashtags.*')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Hashtags must be alphanumeric with underscores only, max 50 characters'),
  
  // Scheduled post validation
  body('scheduledFor')
    .optional()
    .isISO8601()
    .withMessage('scheduledFor must be a valid ISO 8601 date')
    .custom((value) => {
      const scheduledDate = new Date(value);
      const now = new Date();
      if (scheduledDate <= now) {
        throw new Error('scheduledFor must be a future date');
      }
      return true;
    }),
  
  // Timezone validation
  body('timezone')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Timezone must be a valid string'),
  
  // Boolean flags validation
  body('showHashtags')
    .optional()
    .isBoolean()
    .withMessage('showHashtags must be a boolean'),
  
  body('isPinned')
    .optional()
    .isBoolean()
    .withMessage('isPinned must be a boolean'),
  
  body('isPublished')
    .optional()
    .isBoolean()
    .withMessage('isPublished must be a boolean'),
  
  // Validation result handler
  (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      console.error('❌ [VALIDATION] Input validation failed:', errors.array());
      return res.status(400).json({ 
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(err => ({
          field: err.path,
          message: err.msg,
          value: err.value
        }))
      });
    }
    
    // Additional custom validation
    if (req.body.visibility === 'custom' && !req.body.targetAudience?.enabled) {
      return res.status(400).json({
        success: false,
        message: 'targetAudience must be enabled when visibility is set to custom'
      });
    }
    
    console.log('✅ [VALIDATION] Input validation passed');
    next();
  }
];

/**
 * Validation rules for page ID parameter
 */
const validatePageId = [
  param('pageId')
    .isMongoId()
    .withMessage('Invalid page ID format'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid page ID',
        errors: errors.array()
      });
    }
    next();
  }
];

/**
 * Validation rules for post ID parameter
 */
const validatePostId = [
  param('postId')
    .isMongoId()
    .withMessage('Invalid post ID format'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid post ID',
        errors: errors.array()
      });
    }
    next();
  }
];

/**
 * Validation rules for comment content
 */
const validateComment = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Comment must be between 1 and 2000 characters')
    .escape(), // Sanitize HTML
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid comment',
        errors: errors.array()
      });
    }
    next();
  }
];

/**
 * Validation rules for page creation
 */
const validatePageCreation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Page name must be between 1 and 100 characters')
    .escape(),
  
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-z0-9_]+$/)
    .withMessage('Username must be lowercase alphanumeric with underscores only'),
  
  body('pageType')
    .isIn(['personal', 'business', 'community', 'brand'])
    .withMessage('Invalid page type'),
  
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio must not exceed 500 characters')
    .escape(),
  
  body('category')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Category must not exceed 50 characters')
    .escape(),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

module.exports = {
  validatePagePost,
  validatePageId,
  validatePostId,
  validateComment,
  validatePageCreation
};
