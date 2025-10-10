const AIInstance = require('../models/aiInstanceModel');
const User = require('../models/userModel');
const winston = require('winston');

// Configure logger for AI Registry Service
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-registry.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class AIRegistryService {
  constructor() {
    this.registryCache = new Map(); // aiId -> AI instance cache
    this.userAICache = new Map(); // userId -> aiId cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache timeout
  }

  /**
   * Register a new AI instance for a user
   * @param {string} userId - User identifier
   * @param {Object} aiConfig - AI configuration options
   * @returns {Promise<Object>} Created AI instance
   */
  async registerAI(userId, aiConfig = {}) {
    try {
      // Check if user already has an AI instance
      const existingAI = await AIInstance.findByUserId(userId);
      if (existingAI) {
        throw new Error(`User ${userId} already has an AI instance: ${existingAI.aiId}`);
      }

      // Validate user exists
      const user = await User.findOne({ 
        $or: [
          { _id: userId },
          { userId: userId }
        ]
      });
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Create AI instance with default configuration
      const aiData = {
        userId,
        aiName: aiConfig.aiName || user.name ? `${user.name}'s Maya` : 'Maya',
        capabilities: {
          canSchedule: aiConfig.canSchedule !== undefined ? aiConfig.canSchedule : true,
          canAccessCalendar: aiConfig.canAccessCalendar !== undefined ? aiConfig.canAccessCalendar : true,
          canMakeReservations: aiConfig.canMakeReservations !== undefined ? aiConfig.canMakeReservations : false,
          canShareLocation: aiConfig.canShareLocation !== undefined ? aiConfig.canShareLocation : false,
          maxConcurrentConversations: aiConfig.maxConcurrentConversations || 5
        },
        preferences: {
          responseStyle: aiConfig.responseStyle || 'friendly',
          privacyLevel: aiConfig.privacyLevel || 'moderate',
          autoApprovalSettings: {
            lowPriorityRequests: aiConfig.autoApproveLowPriority || false,
            trustedAIsOnly: aiConfig.trustedAIsOnly !== undefined ? aiConfig.trustedAIsOnly : true,
            maxAutoApprovalDuration: aiConfig.maxAutoApprovalDuration || 30
          },
          responseTimePreference: aiConfig.responseTimePreference || 'normal'
        },
        networkSettings: {
          allowDirectMentions: aiConfig.allowDirectMentions !== undefined ? aiConfig.allowDirectMentions : true,
          allowGroupMentions: aiConfig.allowGroupMentions !== undefined ? aiConfig.allowGroupMentions : true,
          trustedAIs: aiConfig.trustedAIs || [],
          blockedAIs: aiConfig.blockedAIs || [],
          allowedGroups: aiConfig.allowedGroups || []
        }
      };

      const aiInstance = await AIInstance.create(aiData);
      
      // Update caches
      this.registryCache.set(aiInstance.aiId, {
        data: aiInstance,
        timestamp: Date.now()
      });
      this.userAICache.set(userId, aiInstance.aiId);

      logger.info(`AI instance ${aiInstance.aiId} registered for user ${userId}`);
      
      return aiInstance;

    } catch (error) {
      logger.error(`Failed to register AI for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deregister an AI instance
   * @param {string} aiId - AI identifier
   * @returns {Promise<boolean>} Success status
   */
  async deregisterAI(aiId) {
    try {
      const aiInstance = await AIInstance.findByAiId(aiId);
      if (!aiInstance) {
        throw new Error(`AI instance ${aiId} not found`);
      }

      // Mark as inactive instead of deleting (for audit trail)
      aiInstance.isActive = false;
      aiInstance.status = 'offline';
      await aiInstance.save();

      // Clear caches
      this.registryCache.delete(aiId);
      this.userAICache.delete(aiInstance.userId);

      logger.info(`AI instance ${aiId} deregistered`);
      
      return true;

    } catch (error) {
      logger.error(`Failed to deregister AI ${aiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update AI instance status
   * @param {string} aiId - AI identifier
   * @param {string} status - New status ('online', 'offline', 'busy', 'away')
   * @returns {Promise<Object>} Updated AI instance
   */
  async updateAIStatus(aiId, status) {
    try {
      const validStatuses = ['online', 'offline', 'busy', 'away'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }

      const aiInstance = await AIInstance.findByAiId(aiId);
      if (!aiInstance) {
        throw new Error(`AI instance ${aiId} not found`);
      }

      await aiInstance.updateStatus(status);
      
      // Update cache
      this.registryCache.set(aiId, {
        data: aiInstance,
        timestamp: Date.now()
      });

      logger.info(`AI ${aiId} status updated to ${status}`);
      
      return aiInstance;

    } catch (error) {
      logger.error(`Failed to update AI ${aiId} status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get AI instance by user ID
   * @param {string} userId - User identifier
   * @returns {Promise<Object|null>} AI instance or null
   */
  async getAIByUser(userId) {
    try {
      // Check cache first
      const cachedAiId = this.userAICache.get(userId);
      if (cachedAiId) {
        const cachedAI = this.registryCache.get(cachedAiId);
        if (cachedAI && this.isCacheValid(cachedAI.timestamp)) {
          return cachedAI.data;
        }
      }

      // Fetch from database
      const aiInstance = await AIInstance.findByUserId(userId);
      
      if (aiInstance) {
        // Update caches
        this.registryCache.set(aiInstance.aiId, {
          data: aiInstance,
          timestamp: Date.now()
        });
        this.userAICache.set(userId, aiInstance.aiId);
      }

      return aiInstance;

    } catch (error) {
      logger.error(`Failed to get AI for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get AI instance by AI ID
   * @param {string} aiId - AI identifier
   * @returns {Promise<Object|null>} AI instance or null
   */
  async getAIById(aiId) {
    try {
      // Check cache first
      const cachedAI = this.registryCache.get(aiId);
      if (cachedAI && this.isCacheValid(cachedAI.timestamp)) {
        return cachedAI.data;
      }

      // Fetch from database
      const aiInstance = await AIInstance.findByAiId(aiId);
      
      if (aiInstance) {
        // Update cache
        this.registryCache.set(aiId, {
          data: aiInstance,
          timestamp: Date.now()
        });
      }

      return aiInstance;

    } catch (error) {
      logger.error(`Failed to get AI ${aiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find AI instance by username
   * @param {string} username - Username to search for
   * @returns {Promise<Object|null>} AI instance or null
   */
  async findAIByUsername(username) {
    try {
      // Find user by username first
      const user = await User.findOne({ 
        $or: [
          { username: username },
          { email: username },
          { phoneNumber: username }
        ]
      });

      if (!user) {
        return null;
      }

      // Get AI for this user
      return await this.getAIByUser(user._id.toString());

    } catch (error) {
      logger.error(`Failed to find AI by username ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get AI instances for a group
   * @param {string} groupId - Group identifier
   * @returns {Promise<Array>} Array of AI instances
   */
  async getGroupAIs(groupId) {
    try {
      // Integrate with your existing group system
      const Group = require('../models/groupModel');
      
      // Get the group and its members
      const group = await Group.findOne({ groupId }).populate('members.userId');
      if (!group) {
        logger.warn(`Group ${groupId} not found`);
        return [];
      }

      // Get user IDs from group members
      const memberUserIds = group.members.map(member => member.userId.toString());
      
      // Find AI instances for these users
      const groupAIs = await AIInstance.find({
        userId: { $in: memberUserIds },
        isActive: true
      });

      // Update cache for each AI
      groupAIs.forEach(ai => {
        this.registryCache.set(ai.aiId, {
          data: ai,
          timestamp: Date.now()
        });
      });

      logger.info(`Found ${groupAIs.length} AI instances for group ${groupId}`);
      return groupAIs;

    } catch (error) {
      logger.error(`Failed to get group AIs for group ${groupId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all online AI instances
   * @returns {Promise<Array>} Array of online AI instances
   */
  async getOnlineAIs() {
    try {
      const onlineAIs = await AIInstance.findOnlineAIs();
      
      // Update cache for each AI
      onlineAIs.forEach(ai => {
        this.registryCache.set(ai.aiId, {
          data: ai,
          timestamp: Date.now()
        });
      });

      return onlineAIs;

    } catch (error) {
      logger.error(`Failed to get online AIs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get trusted AIs for a specific AI
   * @param {string} aiId - AI identifier
   * @returns {Promise<Array>} Array of trusted AI instances
   */
  async getTrustedAIs(aiId) {
    try {
      const aiInstance = await this.getAIById(aiId);
      if (!aiInstance) {
        throw new Error(`AI instance ${aiId} not found`);
      }

      const trustedAiIds = aiInstance.networkSettings.trustedAIs;
      if (trustedAiIds.length === 0) {
        return [];
      }

      const trustedAIs = await AIInstance.find({
        aiId: { $in: trustedAiIds },
        isActive: true
      });

      // Update cache for each trusted AI
      trustedAIs.forEach(ai => {
        this.registryCache.set(ai.aiId, {
          data: ai,
          timestamp: Date.now()
        });
      });

      return trustedAIs;

    } catch (error) {
      logger.error(`Failed to get trusted AIs for ${aiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build AI network topology for a group
   * @param {string} groupId - Group identifier
   * @returns {Promise<Object>} Network topology information
   */
  async buildAINetwork(groupId) {
    try {
      const groupAIs = await this.getGroupAIs(groupId);
      
      const networkTopology = {
        groupId,
        totalAIs: groupAIs.length,
        onlineAIs: groupAIs.filter(ai => ai.isOnline).length,
        offlineAIs: groupAIs.filter(ai => !ai.isOnline).length,
        aisByStatus: {
          online: groupAIs.filter(ai => ai.status === 'online').length,
          busy: groupAIs.filter(ai => ai.status === 'busy').length,
          away: groupAIs.filter(ai => ai.status === 'away').length,
          offline: groupAIs.filter(ai => ai.status === 'offline').length
        },
        capabilities: {
          canSchedule: groupAIs.filter(ai => ai.capabilities.canSchedule).length,
          canAccessCalendar: groupAIs.filter(ai => ai.capabilities.canAccessCalendar).length,
          canMakeReservations: groupAIs.filter(ai => ai.capabilities.canMakeReservations).length,
          canShareLocation: groupAIs.filter(ai => ai.capabilities.canShareLocation).length
        },
        trustRelationships: this.analyzeTrustRelationships(groupAIs)
      };

      return networkTopology;

    } catch (error) {
      logger.error(`Failed to build AI network for group ${groupId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate AI permissions for a specific action
   * @param {string} fromAiId - Source AI identifier
   * @param {string} toAiId - Target AI identifier
   * @param {string} action - Action to validate
   * @returns {Promise<Object>} Permission validation result
   */
  async validateAIPermissions(fromAiId, toAiId, action) {
    try {
      const [fromAI, toAI] = await Promise.all([
        this.getAIById(fromAiId),
        this.getAIById(toAiId)
      ]);

      if (!fromAI) {
        return { allowed: false, reason: `Source AI ${fromAiId} not found` };
      }

      if (!toAI) {
        return { allowed: false, reason: `Target AI ${toAiId} not found` };
      }

      // Check if communication is allowed
      if (!fromAI.canCommunicateWith(toAiId)) {
        return { allowed: false, reason: 'Communication not allowed between these AIs' };
      }

      // Check specific action permissions
      const actionPermissions = this.checkActionPermissions(fromAI, toAI, action);
      
      return {
        allowed: actionPermissions.allowed,
        reason: actionPermissions.reason,
        restrictions: actionPermissions.restrictions
      };

    } catch (error) {
      logger.error(`Failed to validate AI permissions: ${error.message}`);
      return { allowed: false, reason: 'Permission validation failed' };
    }
  }

  /**
   * Search for AIs by various criteria
   * @param {Object} searchCriteria - Search parameters
   * @returns {Promise<Array>} Array of matching AI instances
   */
  async searchAIs(searchCriteria) {
    try {
      const query = { isActive: true };

      // Add search criteria to query
      if (searchCriteria.status) {
        query.status = searchCriteria.status;
      }

      if (searchCriteria.capabilities) {
        Object.keys(searchCriteria.capabilities).forEach(capability => {
          query[`capabilities.${capability}`] = searchCriteria.capabilities[capability];
        });
      }

      if (searchCriteria.privacyLevel) {
        query['preferences.privacyLevel'] = searchCriteria.privacyLevel;
      }

      if (searchCriteria.responseStyle) {
        query['preferences.responseStyle'] = searchCriteria.responseStyle;
      }

      const matchingAIs = await AIInstance.find(query)
        .limit(searchCriteria.limit || 50)
        .sort({ lastActive: -1 });

      return matchingAIs;

    } catch (error) {
      logger.error(`Failed to search AIs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get registry statistics
   * @returns {Promise<Object>} Registry statistics
   */
  async getRegistryStatistics() {
    try {
      const [
        totalAIs,
        activeAIs,
        onlineAIs,
        busyAIs,
        awayAIs,
        offlineAIs
      ] = await Promise.all([
        AIInstance.countDocuments({ isActive: true }),
        AIInstance.countDocuments({ isActive: true }),
        AIInstance.countDocuments({ status: 'online', isActive: true }),
        AIInstance.countDocuments({ status: 'busy', isActive: true }),
        AIInstance.countDocuments({ status: 'away', isActive: true }),
        AIInstance.countDocuments({ status: 'offline', isActive: true })
      ]);

      return {
        totalAIs,
        activeAIs,
        statusDistribution: {
          online: onlineAIs,
          busy: busyAIs,
          away: awayAIs,
          offline: offlineAIs
        },
        cacheStatistics: {
          registryCacheSize: this.registryCache.size,
          userAICacheSize: this.userAICache.size,
          cacheHitRate: this.calculateCacheHitRate()
        }
      };

    } catch (error) {
      logger.error(`Failed to get registry statistics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up inactive AI instances
   * @param {number} inactiveDays - Days of inactivity threshold
   * @returns {Promise<number>} Number of cleaned up AIs
   */
  async cleanupInactiveAIs(inactiveDays = 30) {
    try {
      const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
      
      const inactiveAIs = await AIInstance.find({
        lastActive: { $lt: cutoffDate },
        isActive: true
      });

      let cleanedCount = 0;
      for (const ai of inactiveAIs) {
        ai.isActive = false;
        ai.status = 'offline';
        await ai.save();
        
        // Clear from caches
        this.registryCache.delete(ai.aiId);
        this.userAICache.delete(ai.userId);
        
        cleanedCount++;
      }

      logger.info(`Cleaned up ${cleanedCount} inactive AI instances`);
      return cleanedCount;

    } catch (error) {
      logger.error(`Failed to cleanup inactive AIs: ${error.message}`);
      throw error;
    }
  }

  // Private helper methods

  /**
   * Check if cache entry is still valid
   * @param {number} timestamp - Cache entry timestamp
   * @returns {boolean} Whether cache is valid
   */
  isCacheValid(timestamp) {
    return (Date.now() - timestamp) < this.cacheTimeout;
  }

  /**
   * Analyze trust relationships between AIs
   * @param {Array} ais - Array of AI instances
   * @returns {Object} Trust relationship analysis
   */
  analyzeTrustRelationships(ais) {
    const relationships = {
      totalTrustConnections: 0,
      mutualTrustPairs: 0,
      isolatedAIs: 0,
      mostTrustedAI: null,
      averageTrustConnections: 0
    };

    const trustCounts = new Map();
    
    ais.forEach(ai => {
      const trustCount = ai.networkSettings.trustedAIs.length;
      trustCounts.set(ai.aiId, trustCount);
      relationships.totalTrustConnections += trustCount;
    });

    // Find mutual trust pairs
    ais.forEach(ai1 => {
      ai1.networkSettings.trustedAIs.forEach(trustedAiId => {
        const trustedAI = ais.find(ai => ai.aiId === trustedAiId);
        if (trustedAI && trustedAI.networkSettings.trustedAIs.includes(ai1.aiId)) {
          relationships.mutualTrustPairs++;
        }
      });
    });

    // Find isolated AIs (no trust connections)
    relationships.isolatedAIs = ais.filter(ai => 
      ai.networkSettings.trustedAIs.length === 0
    ).length;

    // Find most trusted AI
    if (trustCounts.size > 0) {
      const maxTrustCount = Math.max(...trustCounts.values());
      const mostTrustedEntry = Array.from(trustCounts.entries())
        .find(([aiId, count]) => count === maxTrustCount);
      relationships.mostTrustedAI = mostTrustedEntry ? mostTrustedEntry[0] : null;
    }

    // Calculate average trust connections
    relationships.averageTrustConnections = ais.length > 0 
      ? relationships.totalTrustConnections / ais.length 
      : 0;

    return relationships;
  }

  /**
   * Check action-specific permissions
   * @param {Object} fromAI - Source AI instance
   * @param {Object} toAI - Target AI instance
   * @param {string} action - Action to check
   * @returns {Object} Permission check result
   */
  checkActionPermissions(fromAI, toAI, action) {
    const restrictions = [];

    switch (action) {
      case 'schedule_request':
        if (!toAI.capabilities.canSchedule) {
          return { allowed: false, reason: 'Target AI cannot handle scheduling requests' };
        }
        if (!toAI.capabilities.canAccessCalendar) {
          restrictions.push('Calendar access limited');
        }
        break;

      case 'location_request':
        if (!toAI.capabilities.canShareLocation) {
          return { allowed: false, reason: 'Target AI cannot share location information' };
        }
        break;

      case 'reservation_request':
        if (!toAI.capabilities.canMakeReservations) {
          return { allowed: false, reason: 'Target AI cannot make reservations' };
        }
        break;

      default:
        // General communication allowed if basic permissions pass
        break;
    }

    return { allowed: true, reason: 'Action permitted', restrictions };
  }

  /**
   * Calculate cache hit rate (placeholder implementation)
   * @returns {number} Cache hit rate percentage
   */
  calculateCacheHitRate() {
    // This would be implemented with actual cache hit/miss tracking
    return 0.85; // 85% placeholder
  }
}

module.exports = AIRegistryService;
