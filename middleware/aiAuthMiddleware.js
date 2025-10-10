const jwt = require('jsonwebtoken');
const AIInstance = require('../models/aiInstanceModel');
const User = require('../models/userModel');
const winston = require('winston');

// Configure logger for AI Auth Middleware
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-auth.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class AIAuthMiddleware {
  /**
   * Authenticate AI instance requests
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  static async authenticateAI(req, res, next) {
    try {
      // Extract AI token from headers
      const aiToken = req.headers['x-ai-token'] || req.headers['authorization']?.replace('Bearer ', '');
      
      if (!aiToken) {
        return res.status(401).json({
          success: false,
          error: 'AI authentication token required',
          code: 'AI_TOKEN_MISSING'
        });
      }

      // Verify AI token
      let decoded;
      try {
        decoded = jwt.verify(aiToken, process.env.AI_JWT_SECRET || process.env.JWT_SECRET);
      } catch (jwtError) {
        logger.warn(`Invalid AI token: ${jwtError.message}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid AI authentication token',
          code: 'AI_TOKEN_INVALID'
        });
      }

      // Validate token structure
      if (!decoded.aiId || !decoded.userId) {
        return res.status(401).json({
          success: false,
          error: 'Malformed AI authentication token',
          code: 'AI_TOKEN_MALFORMED'
        });
      }

      // Get AI instance
      const aiInstance = await AIInstance.findByAiId(decoded.aiId);
      if (!aiInstance || !aiInstance.isActive) {
        logger.warn(`AI instance not found or inactive: ${decoded.aiId}`);
        return res.status(401).json({
          success: false,
          error: 'AI instance not found or inactive',
          code: 'AI_INSTANCE_NOT_FOUND'
        });
      }

      // Verify AI belongs to the user
      if (aiInstance.userId !== decoded.userId) {
        logger.warn(`AI instance ${decoded.aiId} does not belong to user ${decoded.userId}`);
        return res.status(401).json({
          success: false,
          error: 'AI instance ownership mismatch',
          code: 'AI_OWNERSHIP_MISMATCH'
        });
      }

      // Check if AI is online (for real-time operations)
      if (req.path.includes('/realtime') && !aiInstance.isOnline) {
        return res.status(403).json({
          success: false,
          error: 'AI instance must be online for real-time operations',
          code: 'AI_OFFLINE'
        });
      }

      // Update AI last active timestamp
      await aiInstance.updateHeartbeat();

      // Attach AI information to request
      req.ai = {
        aiId: aiInstance.aiId,
        userId: aiInstance.userId,
        aiName: aiInstance.aiName,
        status: aiInstance.status,
        capabilities: aiInstance.capabilities,
        preferences: aiInstance.preferences,
        networkSettings: aiInstance.networkSettings,
        instance: aiInstance
      };

      logger.debug(`AI ${aiInstance.aiId} authenticated successfully`);
      next();

    } catch (error) {
      logger.error(`AI authentication error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'AI authentication failed',
        code: 'AI_AUTH_ERROR'
      });
    }
  }

  /**
   * Authenticate user and their AI instance
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  static async authenticateUserAndAI(req, res, next) {
    try {
      // First authenticate the user (using existing user auth)
      const userToken = req.headers['authorization']?.replace('Bearer ', '');
      
      if (!userToken) {
        return res.status(401).json({
          success: false,
          error: 'User authentication token required',
          code: 'USER_TOKEN_MISSING'
        });
      }

      // Verify user token
      let decoded;
      try {
        decoded = jwt.verify(userToken, process.env.JWT_SECRET);
      } catch (jwtError) {
        return res.status(401).json({
          success: false,
          error: 'Invalid user authentication token',
          code: 'USER_TOKEN_INVALID'
        });
      }

      // Get user
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get user's AI instance
      const aiInstance = await AIInstance.findByUserId(user._id.toString());
      if (!aiInstance) {
        return res.status(404).json({
          success: false,
          error: 'AI instance not found for user',
          code: 'AI_INSTANCE_NOT_FOUND'
        });
      }

      // Attach user and AI information to request
      req.user = {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        name: user.name
      };

      req.ai = {
        aiId: aiInstance.aiId,
        userId: aiInstance.userId,
        aiName: aiInstance.aiName,
        status: aiInstance.status,
        capabilities: aiInstance.capabilities,
        preferences: aiInstance.preferences,
        networkSettings: aiInstance.networkSettings,
        instance: aiInstance
      };

      logger.debug(`User ${user._id} and AI ${aiInstance.aiId} authenticated successfully`);
      next();

    } catch (error) {
      logger.error(`User and AI authentication error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
  }

  /**
   * Check AI capabilities for specific actions
   * @param {Array} requiredCapabilities - Array of required capabilities
   * @returns {Function} Middleware function
   */
  static requireCapabilities(requiredCapabilities) {
    return (req, res, next) => {
      if (!req.ai) {
        return res.status(401).json({
          success: false,
          error: 'AI authentication required',
          code: 'AI_AUTH_REQUIRED'
        });
      }

      const aiCapabilities = req.ai.capabilities;
      const missingCapabilities = requiredCapabilities.filter(capability => 
        !aiCapabilities[capability]
      );

      if (missingCapabilities.length > 0) {
        logger.warn(`AI ${req.ai.aiId} missing capabilities: ${missingCapabilities.join(', ')}`);
        return res.status(403).json({
          success: false,
          error: 'AI lacks required capabilities',
          code: 'AI_INSUFFICIENT_CAPABILITIES',
          missingCapabilities
        });
      }

      next();
    };
  }

  /**
   * Check AI communication permissions
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  static async checkCommunicationPermissions(req, res, next) {
    try {
      if (!req.ai) {
        return res.status(401).json({
          success: false,
          error: 'AI authentication required',
          code: 'AI_AUTH_REQUIRED'
        });
      }

      const { targetAiId, targetUserId } = req.body;
      
      if (!targetAiId && !targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'Target AI ID or User ID required',
          code: 'TARGET_REQUIRED'
        });
      }

      // Get target AI
      let targetAI;
      if (targetAiId) {
        targetAI = await AIInstance.findByAiId(targetAiId);
      } else if (targetUserId) {
        targetAI = await AIInstance.findByUserId(targetUserId);
      }

      if (!targetAI) {
        return res.status(404).json({
          success: false,
          error: 'Target AI not found',
          code: 'TARGET_AI_NOT_FOUND'
        });
      }

      // Check if communication is allowed
      if (!req.ai.instance.canCommunicateWith(targetAI.aiId)) {
        logger.warn(`AI ${req.ai.aiId} cannot communicate with ${targetAI.aiId}`);
        return res.status(403).json({
          success: false,
          error: 'Communication not permitted with target AI',
          code: 'COMMUNICATION_FORBIDDEN'
        });
      }

      // Check target AI's privacy settings
      if (targetAI.preferences.privacyLevel === 'strict') {
        const isTrusted = targetAI.networkSettings.trustedAIs.includes(req.ai.aiId);
        if (!isTrusted) {
          return res.status(403).json({
            success: false,
            error: 'Target AI requires trusted relationship for communication',
            code: 'TRUST_REQUIRED'
          });
        }
      }

      // Attach target AI to request
      req.targetAI = {
        aiId: targetAI.aiId,
        userId: targetAI.userId,
        aiName: targetAI.aiName,
        status: targetAI.status,
        capabilities: targetAI.capabilities,
        preferences: targetAI.preferences,
        instance: targetAI
      };

      next();

    } catch (error) {
      logger.error(`Communication permission check error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  }

  /**
   * Validate AI status for operations
   * @param {Array} allowedStatuses - Array of allowed AI statuses
   * @returns {Function} Middleware function
   */
  static requireStatus(allowedStatuses) {
    return (req, res, next) => {
      if (!req.ai) {
        return res.status(401).json({
          success: false,
          error: 'AI authentication required',
          code: 'AI_AUTH_REQUIRED'
        });
      }

      if (!allowedStatuses.includes(req.ai.status)) {
        logger.warn(`AI ${req.ai.aiId} has invalid status ${req.ai.status} for operation`);
        return res.status(403).json({
          success: false,
          error: `AI must be in one of these statuses: ${allowedStatuses.join(', ')}`,
          code: 'AI_INVALID_STATUS',
          currentStatus: req.ai.status,
          allowedStatuses
        });
      }

      next();
    };
  }

  /**
   * Generate AI authentication token
   * @param {Object} aiInstance - AI instance object
   * @param {Object} options - Token options
   * @returns {string} JWT token
   */
  static generateAIToken(aiInstance, options = {}) {
    const payload = {
      aiId: aiInstance.aiId,
      userId: aiInstance.userId,
      aiName: aiInstance.aiName,
      type: 'ai_auth',
      iat: Math.floor(Date.now() / 1000)
    };

    const tokenOptions = {
      expiresIn: options.expiresIn || '24h',
      issuer: 'syncup-ai-system',
      audience: 'ai-network'
    };

    return jwt.sign(payload, process.env.AI_JWT_SECRET || process.env.JWT_SECRET, tokenOptions);
  }

  /**
   * Validate AI token without middleware (for Socket.IO)
   * @param {string} token - AI authentication token
   * @returns {Promise<Object>} Validation result
   */
  static async validateAIToken(token) {
    try {
      if (!token) {
        return { valid: false, error: 'Token missing' };
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.AI_JWT_SECRET || process.env.JWT_SECRET);
      
      if (!decoded.aiId || !decoded.userId) {
        return { valid: false, error: 'Malformed token' };
      }

      // Get AI instance
      const aiInstance = await AIInstance.findByAiId(decoded.aiId);
      if (!aiInstance || !aiInstance.isActive) {
        return { valid: false, error: 'AI instance not found or inactive' };
      }

      // Verify ownership
      if (aiInstance.userId !== decoded.userId) {
        return { valid: false, error: 'AI ownership mismatch' };
      }

      return {
        valid: true,
        ai: {
          aiId: aiInstance.aiId,
          userId: aiInstance.userId,
          aiName: aiInstance.aiName,
          status: aiInstance.status,
          capabilities: aiInstance.capabilities,
          preferences: aiInstance.preferences,
          networkSettings: aiInstance.networkSettings,
          instance: aiInstance
        }
      };

    } catch (error) {
      logger.error(`AI token validation error: ${error.message}`);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Rate limiting for AI operations
   * @param {Object} options - Rate limiting options
   * @returns {Function} Middleware function
   */
  static rateLimit(options = {}) {
    const {
      windowMs = 60 * 1000, // 1 minute
      maxRequests = 100,
      skipSuccessfulRequests = false,
      skipFailedRequests = false
    } = options;

    const requestCounts = new Map(); // aiId -> { count, resetTime }

    return (req, res, next) => {
      if (!req.ai) {
        return res.status(401).json({
          success: false,
          error: 'AI authentication required',
          code: 'AI_AUTH_REQUIRED'
        });
      }

      const aiId = req.ai.aiId;
      const now = Date.now();
      
      // Get or initialize request count for this AI
      let aiRequestData = requestCounts.get(aiId);
      if (!aiRequestData || now > aiRequestData.resetTime) {
        aiRequestData = {
          count: 0,
          resetTime: now + windowMs
        };
        requestCounts.set(aiId, aiRequestData);
      }

      // Check if limit exceeded
      if (aiRequestData.count >= maxRequests) {
        logger.warn(`Rate limit exceeded for AI ${aiId}: ${aiRequestData.count}/${maxRequests}`);
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          code: 'AI_RATE_LIMIT_EXCEEDED',
          limit: maxRequests,
          windowMs,
          resetTime: aiRequestData.resetTime
        });
      }

      // Increment request count
      aiRequestData.count++;

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - aiRequestData.count),
        'X-RateLimit-Reset': new Date(aiRequestData.resetTime).toISOString()
      });

      next();
    };
  }

  /**
   * Log AI activity for audit purposes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  static logActivity(req, res, next) {
    if (req.ai) {
      const activityLog = {
        aiId: req.ai.aiId,
        userId: req.ai.userId,
        action: `${req.method} ${req.path}`,
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.method !== 'GET' ? req.body : undefined
      };

      logger.info('AI Activity', activityLog);
    }

    next();
  }
}

module.exports = AIAuthMiddleware;
