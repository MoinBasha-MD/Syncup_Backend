const AIInstance = require('../models/aiInstanceModel');
const AIRegistryService = require('../services/aiRegistryService');
const AIAuthMiddleware = require('../middleware/aiAuthMiddleware');
const winston = require('winston');

// Configure logger for AI Instance Controller
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-instance-controller.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Initialize AI Registry Service
const aiRegistryService = new AIRegistryService();

class AIInstanceController {
  /**
   * Register a new AI instance for a user
   * POST /api/ai/register
   */
  static async registerAI(req, res) {
    try {
      const userId = req.user.userId || req.user.id; // From user authentication middleware
      const aiConfig = req.body;

      // Validate required fields
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required',
          code: 'USER_ID_REQUIRED'
        });
      }

      // Register AI instance
      const aiInstance = await aiRegistryService.registerAI(userId, aiConfig);

      // Generate AI authentication token
      const aiToken = AIAuthMiddleware.generateAIToken(aiInstance);

      logger.info(`AI instance ${aiInstance.aiId} registered for user ${userId}`);

      res.status(201).json({
        success: true,
        message: 'AI instance registered successfully',
        data: {
          aiId: aiInstance.aiId,
          aiName: aiInstance.aiName,
          status: aiInstance.status,
          capabilities: aiInstance.capabilities,
          preferences: aiInstance.preferences,
          networkSettings: aiInstance.networkSettings,
          createdAt: aiInstance.createdAt
        },
        aiToken
      });

    } catch (error) {
      logger.error(`Failed to register AI: ${error.message}`);
      
      if (error.message.includes('already has an AI instance')) {
        return res.status(409).json({
          success: false,
          error: error.message,
          code: 'AI_ALREADY_EXISTS'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to register AI instance',
        code: 'AI_REGISTRATION_FAILED'
      });
    }
  }

  /**
   * Get AI instance by user ID
   * GET /api/ai/instance/:userId
   */
  static async getAIByUser(req, res) {
    try {
      const { userId } = req.params;

      // Check if requesting user can access this AI
      const requestingUserId = req.user.userId || req.user.id;
      const requestingUserIdStr = requestingUserId.toString();
      const userIdStr = userId.toString();
      
      // Allow access if user IDs match (handle both string and ObjectId formats)
      const hasAccess = requestingUserIdStr === userIdStr || 
                       requestingUserId === userId ||
                       req.user.isAdmin;
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          code: 'ACCESS_DENIED'
        });
      }

      // Try to find AI instance with multiple user ID formats
      let aiInstance = await aiRegistryService.getAIByUser(userId);
      
      // If not found, try with the requesting user's ID format
      if (!aiInstance && requestingUserIdStr !== userIdStr) {
        aiInstance = await aiRegistryService.getAIByUser(requestingUserIdStr);
      }

      if (!aiInstance) {
        return res.status(404).json({
          success: false,
          error: 'AI instance not found for user',
          code: 'AI_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: {
          aiId: aiInstance.aiId,
          aiName: aiInstance.aiName,
          status: aiInstance.status,
          capabilities: aiInstance.capabilities,
          preferences: aiInstance.preferences,
          networkSettings: {
            allowDirectMentions: aiInstance.networkSettings.allowDirectMentions,
            allowGroupMentions: aiInstance.networkSettings.allowGroupMentions,
            trustedAIsCount: aiInstance.networkSettings.trustedAIs.length,
            blockedAIsCount: aiInstance.networkSettings.blockedAIs.length
          },
          stats: aiInstance.stats,
          lastActive: aiInstance.lastActive,
          isOnline: aiInstance.isOnline
        }
      });

    } catch (error) {
      logger.error(`Failed to get AI by user ${req.params.userId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve AI instance',
        code: 'AI_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Update AI instance settings
   * PUT /api/ai/instance/:aiId
   */
  static async updateAIInstance(req, res) {
    try {
      const { aiId } = req.params;
      const updates = req.body;

      // Verify AI ownership
      if (req.ai.aiId !== aiId) {
        return res.status(403).json({
          success: false,
          error: 'Can only update your own AI instance',
          code: 'AI_OWNERSHIP_REQUIRED'
        });
      }

      const aiInstance = req.ai.instance;

      // Update allowed fields
      const allowedUpdates = [
        'aiName', 'capabilities', 'preferences', 'networkSettings'
      ];

      let hasUpdates = false;
      allowedUpdates.forEach(field => {
        if (updates[field] !== undefined) {
          if (field === 'capabilities' || field === 'preferences' || field === 'networkSettings') {
            // Merge objects
            aiInstance[field] = { ...aiInstance[field], ...updates[field] };
          } else {
            aiInstance[field] = updates[field];
          }
          hasUpdates = true;
        }
      });

      if (!hasUpdates) {
        return res.status(400).json({
          success: false,
          error: 'No valid updates provided',
          code: 'NO_UPDATES'
        });
      }

      await aiInstance.save();

      logger.info(`AI instance ${aiId} updated successfully`);

      res.json({
        success: true,
        message: 'AI instance updated successfully',
        data: {
          aiId: aiInstance.aiId,
          aiName: aiInstance.aiName,
          capabilities: aiInstance.capabilities,
          preferences: aiInstance.preferences,
          networkSettings: aiInstance.networkSettings,
          updatedAt: aiInstance.updatedAt
        }
      });

    } catch (error) {
      logger.error(`Failed to update AI instance ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to update AI instance',
        code: 'AI_UPDATE_FAILED'
      });
    }
  }

  /**
   * Deactivate AI instance
   * DELETE /api/ai/instance/:aiId
   */
  static async deactivateAI(req, res) {
    try {
      const { aiId } = req.params;

      // Verify AI ownership
      if (req.ai.aiId !== aiId) {
        return res.status(403).json({
          success: false,
          error: 'Can only deactivate your own AI instance',
          code: 'AI_OWNERSHIP_REQUIRED'
        });
      }

      await aiRegistryService.deregisterAI(aiId);

      logger.info(`AI instance ${aiId} deactivated successfully`);

      res.json({
        success: true,
        message: 'AI instance deactivated successfully'
      });

    } catch (error) {
      logger.error(`Failed to deactivate AI instance ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to deactivate AI instance',
        code: 'AI_DEACTIVATION_FAILED'
      });
    }
  }

  /**
   * Get AI status
   * GET /api/ai/status/:aiId
   */
  static async getAIStatus(req, res) {
    try {
      const { aiId } = req.params;

      const aiInstance = await aiRegistryService.getAIById(aiId);

      if (!aiInstance) {
        return res.status(404).json({
          success: false,
          error: 'AI instance not found',
          code: 'AI_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: {
          aiId: aiInstance.aiId,
          aiName: aiInstance.aiName,
          status: aiInstance.status,
          isOnline: aiInstance.isOnline,
          lastActive: aiInstance.lastActive,
          lastHeartbeat: aiInstance.lastHeartbeat
        }
      });

    } catch (error) {
      logger.error(`Failed to get AI status ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve AI status',
        code: 'AI_STATUS_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Update AI status
   * PUT /api/ai/status/:aiId
   */
  static async updateAIStatus(req, res) {
    try {
      const { aiId } = req.params;
      const { status } = req.body;

      // Verify AI ownership
      if (req.ai.aiId !== aiId) {
        return res.status(403).json({
          success: false,
          error: 'Can only update your own AI status',
          code: 'AI_OWNERSHIP_REQUIRED'
        });
      }

      // Validate status
      const validStatuses = ['online', 'offline', 'busy', 'away'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          code: 'INVALID_STATUS'
        });
      }

      const updatedAI = await aiRegistryService.updateAIStatus(aiId, status);

      logger.info(`AI ${aiId} status updated to ${status}`);

      res.json({
        success: true,
        message: 'AI status updated successfully',
        data: {
          aiId: updatedAI.aiId,
          status: updatedAI.status,
          lastActive: updatedAI.lastActive
        }
      });

    } catch (error) {
      logger.error(`Failed to update AI status ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to update AI status',
        code: 'AI_STATUS_UPDATE_FAILED'
      });
    }
  }

  /**
   * Get AI capabilities
   * GET /api/ai/capabilities/:aiId
   */
  static async getAICapabilities(req, res) {
    try {
      const { aiId } = req.params;

      const aiInstance = await aiRegistryService.getAIById(aiId);

      if (!aiInstance) {
        return res.status(404).json({
          success: false,
          error: 'AI instance not found',
          code: 'AI_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: {
          aiId: aiInstance.aiId,
          aiName: aiInstance.aiName,
          capabilities: aiInstance.capabilities,
          version: aiInstance.version
        }
      });

    } catch (error) {
      logger.error(`Failed to get AI capabilities ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve AI capabilities',
        code: 'AI_CAPABILITIES_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Update AI capabilities
   * PUT /api/ai/capabilities/:aiId
   */
  static async updateAICapabilities(req, res) {
    try {
      const { aiId } = req.params;
      const { capabilities } = req.body;

      // Verify AI ownership
      if (req.ai.aiId !== aiId) {
        return res.status(403).json({
          success: false,
          error: 'Can only update your own AI capabilities',
          code: 'AI_OWNERSHIP_REQUIRED'
        });
      }

      if (!capabilities || typeof capabilities !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Valid capabilities object required',
          code: 'INVALID_CAPABILITIES'
        });
      }

      const aiInstance = req.ai.instance;
      aiInstance.capabilities = { ...aiInstance.capabilities, ...capabilities };
      await aiInstance.save();

      logger.info(`AI ${aiId} capabilities updated`);

      res.json({
        success: true,
        message: 'AI capabilities updated successfully',
        data: {
          aiId: aiInstance.aiId,
          capabilities: aiInstance.capabilities,
          updatedAt: aiInstance.updatedAt
        }
      });

    } catch (error) {
      logger.error(`Failed to update AI capabilities ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to update AI capabilities',
        code: 'AI_CAPABILITIES_UPDATE_FAILED'
      });
    }
  }

  /**
   * Search for AIs
   * GET /api/ai/search
   */
  static async searchAIs(req, res) {
    try {
      const searchCriteria = {
        status: req.query.status,
        capabilities: {},
        privacyLevel: req.query.privacyLevel,
        responseStyle: req.query.responseStyle,
        limit: parseInt(req.query.limit) || 20
      };

      // Parse capability filters
      if (req.query.canSchedule !== undefined) {
        searchCriteria.capabilities.canSchedule = req.query.canSchedule === 'true';
      }
      if (req.query.canAccessCalendar !== undefined) {
        searchCriteria.capabilities.canAccessCalendar = req.query.canAccessCalendar === 'true';
      }
      if (req.query.canMakeReservations !== undefined) {
        searchCriteria.capabilities.canMakeReservations = req.query.canMakeReservations === 'true';
      }

      const matchingAIs = await aiRegistryService.searchAIs(searchCriteria);

      // Filter out sensitive information
      const publicAIData = matchingAIs.map(ai => ({
        aiId: ai.aiId,
        aiName: ai.aiName,
        status: ai.status,
        capabilities: ai.capabilities,
        preferences: {
          responseStyle: ai.preferences.responseStyle,
          privacyLevel: ai.preferences.privacyLevel
        },
        lastActive: ai.lastActive,
        isOnline: ai.isOnline
      }));

      res.json({
        success: true,
        data: publicAIData,
        count: publicAIData.length,
        searchCriteria
      });

    } catch (error) {
      logger.error(`Failed to search AIs: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to search AI instances',
        code: 'AI_SEARCH_FAILED'
      });
    }
  }

  /**
   * Get AI statistics
   * GET /api/ai/stats/:aiId
   */
  static async getAIStats(req, res) {
    try {
      const { aiId } = req.params;

      // Verify AI ownership or admin access
      if (req.ai.aiId !== aiId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to AI statistics',
          code: 'ACCESS_DENIED'
        });
      }

      const aiInstance = await aiRegistryService.getAIById(aiId);

      if (!aiInstance) {
        return res.status(404).json({
          success: false,
          error: 'AI instance not found',
          code: 'AI_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: {
          aiId: aiInstance.aiId,
          stats: aiInstance.stats,
          networkStats: {
            trustedAIsCount: aiInstance.networkSettings.trustedAIs.length,
            blockedAIsCount: aiInstance.networkSettings.blockedAIs.length,
            allowedGroupsCount: aiInstance.networkSettings.allowedGroups.length
          },
          activityStats: {
            lastActive: aiInstance.lastActive,
            lastHeartbeat: aiInstance.lastHeartbeat,
            isOnline: aiInstance.isOnline,
            status: aiInstance.status
          }
        }
      });

    } catch (error) {
      logger.error(`Failed to get AI stats ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve AI statistics',
        code: 'AI_STATS_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Get registry statistics (admin only)
   * GET /api/ai/registry/stats
   */
  static async getRegistryStats(req, res) {
    try {
      // Check admin access
      if (!req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required',
          code: 'ADMIN_ACCESS_REQUIRED'
        });
      }

      const stats = await aiRegistryService.getRegistryStatistics();

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error(`Failed to get registry stats: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve registry statistics',
        code: 'REGISTRY_STATS_FAILED'
      });
    }
  }

  /**
   * Heartbeat endpoint for AI instances
   * POST /api/ai/heartbeat
   */
  static async heartbeat(req, res) {
    try {
      const aiInstance = req.ai.instance;
      await aiInstance.updateHeartbeat();

      res.json({
        success: true,
        message: 'Heartbeat recorded',
        data: {
          aiId: aiInstance.aiId,
          status: aiInstance.status,
          lastHeartbeat: aiInstance.lastHeartbeat
        }
      });

    } catch (error) {
      logger.error(`Failed to record heartbeat for AI ${req.ai.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to record heartbeat',
        code: 'HEARTBEAT_FAILED'
      });
    }
  }
}

module.exports = AIInstanceController;
