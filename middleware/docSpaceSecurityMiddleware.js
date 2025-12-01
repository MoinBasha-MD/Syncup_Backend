const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const validator = require('validator');

/**
 * Document Request Rate Limiter
 * Prevents spam requests to document owners
 */
const documentRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes per user
  message: {
    success: false,
    message: 'Too many document requests. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use user ID as key for rate limiting
  keyGenerator: (req) => {
    return req.user?.userId || req.ip;
  }
});

/**
 * Document Upload Rate Limiter
 * Prevents abuse of upload endpoint
 */
const documentUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour
  message: {
    success: false,
    message: 'Too many document uploads. Please try again later.'
  },
  keyGenerator: (req) => {
    return req.user?.userId || req.ip;
  }
});

/**
 * Sanitize and validate document input
 */
const sanitizeDocumentInput = (req, res, next) => {
  try {
    // Sanitize all string inputs to prevent MongoDB injection
    if (req.body) {
      req.body = mongoSanitize.sanitize(req.body);
    }
    
    if (req.params) {
      req.params = mongoSanitize.sanitize(req.params);
    }
    
    if (req.query) {
      req.query = mongoSanitize.sanitize(req.query);
    }
    
    // Additional XSS protection for text fields
    if (req.body.customName) {
      req.body.customName = validator.escape(req.body.customName.trim());
      
      // Validate length
      if (req.body.customName.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Custom name must be less than 100 characters'
        });
      }
    }
    
    // Additional XSS protection for text fields
    if (req.body.requestMessage) {
      req.body.requestMessage = validator.escape(req.body.requestMessage.trim());
      
      // Validate length
      if (req.body.requestMessage.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'Request message must be less than 500 characters'
        });
      }
    }
    
    if (req.body && req.body.responseMessage && typeof req.body.responseMessage === 'string') {
      req.body.responseMessage = validator.escape(req.body.responseMessage.trim());
      
      // Validate length
      if (req.body.responseMessage.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'Response message must be less than 500 characters'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('❌ [DOC SPACE SECURITY] Sanitization error:', error);
    res.status(500).json({
      success: false,
      message: 'Input validation failed'
    });
  }
};

/**
 * Validate file content matches declared type
 * Prevents malicious files disguised as documents
 */
const validateFileContent = async (req, res, next) => {
  try {
    if (!req.file) {
      return next();
    }
    
    const fileType = require('file-type');
    const fs = require('fs').promises;
    
    // Read first 4100 bytes for file type detection
    const buffer = await fs.readFile(req.file.path);
    const detectedType = await fileType.fromBuffer(buffer);
    
    // Define allowed MIME types and their magic numbers
    const allowedTypes = {
      'application/pdf': ['pdf'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'application/msword': ['doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx']
    };
    
    // Check if detected type matches declared type
    if (!detectedType) {
      // If file type can't be detected, reject for safety
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Unable to verify file type. Please upload a valid document.'
      });
    }
    
    const declaredMimeType = req.file.mimetype;
    const detectedMimeType = detectedType.mime;
    
    // Check if detected type is in allowed list
    const isAllowed = Object.keys(allowedTypes).some(allowedMime => {
      return detectedMimeType === allowedMime || 
             detectedMimeType.startsWith(allowedMime.split('/')[0]);
    });
    
    if (!isAllowed) {
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: `File type ${detectedMimeType} is not allowed. Only PDF, images, and documents are permitted.`
      });
    }
    
    // Additional check: declared type should match detected type category
    const declaredCategory = declaredMimeType.split('/')[0];
    const detectedCategory = detectedMimeType.split('/')[0];
    
    if (declaredCategory !== detectedCategory && 
        !(declaredMimeType.includes('document') && detectedMimeType.includes('zip'))) {
      // DOCX files are actually ZIP files, so allow this exception
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'File content does not match declared file type. Upload rejected for security reasons.'
      });
    }
    
    console.log(`✅ [DOC SPACE SECURITY] File validated: ${detectedMimeType}`);
    next();
  } catch (error) {
    console.error('❌ [DOC SPACE SECURITY] File validation error:', error);
    
    // Clean up file on error
    if (req.file) {
      try {
        await require('fs').promises.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'File validation failed'
    });
  }
};

/**
 * Log security events for audit trail
 */
const logSecurityEvent = (eventType) => {
  return (req, res, next) => {
    const userId = req.user?.userId || 'anonymous';
    const ip = req.ip || req.connection.remoteAddress;
    
    console.log(`🔒 [DOC SPACE SECURITY] ${eventType}:`, {
      userId,
      ip,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
    
    next();
  };
};

/**
 * Validate document access permissions
 * Additional layer of security before serving documents
 */
const validateDocumentAccess = async (req, res, next) => {
  try {
    const requesterId = req.user.userId;
    const { ownerId, documentType } = req.params;
    
    // Prevent users from accessing their own documents through this endpoint
    // (they should use the regular doc space endpoint)
    if (requesterId === ownerId) {
      return res.status(400).json({
        success: false,
        message: 'Use /api/doc-space to access your own documents'
      });
    }
    
    // Additional validation will be done in controller
    next();
  } catch (error) {
    console.error('❌ [DOC SPACE SECURITY] Access validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Access validation failed'
    });
  }
};

module.exports = {
  documentRequestLimiter,
  documentUploadLimiter,
  sanitizeDocumentInput,
  validateFileContent,
  logSecurityEvent,
  validateDocumentAccess
};
