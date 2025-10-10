const AIInstance = require('../models/aiInstanceModel');
const AIMessageQueue = require('../models/aiMessageQueueModel');
const GroupAINetwork = require('../models/groupAiNetworkModel');
const { aiLogger } = require('../utils/loggerSetup');

class AIRouterService {
  constructor() {
    this.activeConnections = new Map(); // aiId -> socket connection
    this.routingStats = {
      messagesRouted: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatency: 0
    };
  }

  /**
   * Register an AI instance connection for real-time routing
   * @param {string} aiId - AI instance identifier
   * @param {Object} socketConnection - Socket.IO connection object
   */
  registerConnection(aiId, socketConnection) {
    this.activeConnections.set(aiId, socketConnection);
    aiLogger.info(`AI ${aiId} registered for real-time routing`, { aiId, event: 'ai_registered' });
    
    // Set up connection event handlers
    socketConnection.on('disconnect', () => {
      this.unregisterConnection(aiId);
    });
    
    socketConnection.on('ai:heartbeat', () => {
      this.handleHeartbeat(aiId);
    });
  }

  /**
   * Unregister an AI instance connection
   * @param {string} aiId - AI instance identifier
   */
  unregisterConnection(aiId) {
    this.activeConnections.delete(aiId);
    aiLogger.info(`AI ${aiId} unregistered from real-time routing`, { aiId, event: 'ai_unregistered' });
  }

  /**
   * Route a message from one AI to another
   * @param {string} fromAiId - Source AI identifier
   * @param {string} toAiId - Target AI identifier
   * @param {Object} message - Message content and metadata
   * @param {Object} options - Routing options
   * @returns {Promise<Object>} Routing result
   */
  async routeMessage(fromAiId, toAiId, message, options = {}) {
    const startTime = Date.now();
    
    try {
      // Validate source and target AIs
      const [fromAI, toAI] = await Promise.all([
        AIInstance.findByAiId(fromAiId),
        AIInstance.findByAiId(toAiId)
      ]);

      if (!fromAI) {
        throw new Error(`Source AI ${fromAiId} not found`);
      }
      
      if (!toAI) {
        throw new Error(`Target AI ${toAiId} not found`);
      }

      // Check communication permissions
      if (!fromAI.canCommunicateWith(toAiId)) {
        throw new Error(`AI ${fromAiId} is not authorized to communicate with ${toAiId}`);
      }

      // Validate message content
      const validatedMessage = await this.validateMessage(message);
      
      // Preprocess message
      const processedMessage = await this.preprocessMessage(validatedMessage, fromAI, toAI);

      // Determine routing strategy
      const routingStrategy = this.determineRoutingStrategy(toAI, options);
      
      let routingResult;
      
      if (routingStrategy === 'realtime' && this.activeConnections.has(toAiId)) {
        // Real-time delivery via Socket.IO
        routingResult = await this.deliverRealtime(fromAiId, toAiId, processedMessage, options);
      } else {
        // Queue-based delivery
        routingResult = await this.deliverQueued(fromAiId, toAiId, processedMessage, options);
      }

      // Update routing statistics
      const latency = Date.now() - startTime;
      this.updateRoutingStats(true, latency);
      
      aiLogger.info(`Message routed from ${fromAiId} to ${toAiId} in ${latency}ms`, { 
        fromAiId, 
        toAiId, 
        latency, 
        messageId: routingResult.messageId,
        deliveryMethod: routingStrategy,
        event: 'message_routed'
      });
      
      return {
        success: true,
        messageId: routingResult.messageId,
        deliveryMethod: routingStrategy,
        latency,
        queuePosition: routingResult.queuePosition
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateRoutingStats(false, latency);
      
      logger.error(`Failed to route message from ${fromAiId} to ${toAiId}: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        latency
      };
    }
  }

  /**
   * Route a message to multiple AIs in a group
   * @param {string} fromAiId - Source AI identifier
   * @param {string} groupId - Target group identifier
   * @param {Object} message - Message content and metadata
   * @param {Object} options - Routing options
   * @returns {Promise<Object>} Group routing result
   */
  async routeToGroup(fromAiId, groupId, message, options = {}) {
    const startTime = Date.now();
    
    try {
      // Get source AI
      const fromAI = await AIInstance.findByAiId(fromAiId);
      if (!fromAI) {
        throw new Error(`Source AI ${fromAiId} not found`);
      }

      // Get group AI members
      const groupAIs = await this.getGroupAIMembers(groupId);
      if (groupAIs.length === 0) {
        throw new Error(`No AI members found for group ${groupId}`);
      }

      // Filter out the source AI and blocked AIs
      const targetAIs = groupAIs.filter(ai => 
        ai.aiId !== fromAiId && fromAI.canCommunicateWith(ai.aiId)
      );

      if (targetAIs.length === 0) {
        throw new Error(`No valid target AIs found in group ${groupId}`);
      }

      // Create group network if required
      let networkId = null;
      if (options.createNetwork) {
        const network = await GroupAINetwork.createNetwork(
          groupId,
          fromAiId,
          targetAIs.map(ai => ai.aiId),
          message.topic || 'Group Communication',
          message.context || {},
          options.networkOptions
        );
        networkId = network.networkId;
      }

      // Validate and preprocess message
      const validatedMessage = await this.validateMessage(message);
      const processedMessage = await this.preprocessMessage(validatedMessage, fromAI, null);
      
      // Add network information to message
      if (networkId) {
        processedMessage.metadata = processedMessage.metadata || {};
        processedMessage.metadata.networkId = networkId;
      }

      // Route to each target AI
      const routingPromises = targetAIs.map(targetAI => 
        this.routeMessage(fromAiId, targetAI.aiId, processedMessage, {
          ...options,
          isGroupMessage: true,
          groupId,
          networkId
        })
      );

      const routingResults = await Promise.allSettled(routingPromises);
      
      // Analyze results
      const successful = routingResults.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = routingResults.filter(r => r.status === 'rejected' || !r.value.success);

      const latency = Date.now() - startTime;
      
      logger.info(`Group message routed to ${successful.length}/${targetAIs.length} AIs in group ${groupId}`);

      return {
        success: true,
        groupId,
        networkId,
        totalTargets: targetAIs.length,
        successfulDeliveries: successful.length,
        failedDeliveries: failed.length,
        latency,
        results: routingResults.map((result, index) => ({
          targetAiId: targetAIs[index].aiId,
          success: result.status === 'fulfilled' && result.value.success,
          messageId: result.status === 'fulfilled' ? result.value.messageId : null,
          error: result.status === 'rejected' ? result.reason.message : 
                 (result.value.success ? null : result.value.error)
        }))
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error(`Failed to route group message from ${fromAiId} to group ${groupId}: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        latency
      };
    }
  }

  /**
   * Retry failed message delivery
   * @param {string} messageId - Message identifier to retry
   * @param {Object} retryOptions - Retry configuration
   * @returns {Promise<Object>} Retry result
   */
  async routeWithRetry(messageId, retryOptions = {}) {
    try {
      const queuedMessage = await AIMessageQueue.findById(messageId);
      
      if (!queuedMessage) {
        throw new Error(`Queued message ${messageId} not found`);
      }

      if (!queuedMessage.canRetry) {
        throw new Error(`Message ${messageId} cannot be retried (max retries exceeded or expired)`);
      }

      // Increment retry count
      await queuedMessage.incrementRetry();
      
      // Attempt delivery based on current AI status
      const targetAI = await AIInstance.findByAiId(queuedMessage.targetAiId);
      
      if (!targetAI) {
        await queuedMessage.markAsFailed('system', 'Target AI no longer exists');
        return { success: false, error: 'Target AI not found' };
      }

      const routingStrategy = this.determineRoutingStrategy(targetAI, retryOptions);
      
      let deliveryResult;
      if (routingStrategy === 'realtime' && this.activeConnections.has(queuedMessage.targetAiId)) {
        deliveryResult = await this.deliverRealtimeFromQueue(queuedMessage);
      } else {
        // Message remains in queue with updated retry count
        deliveryResult = { messageId: queuedMessage.queueId, queuePosition: 0 };
      }

      logger.info(`Message ${messageId} retry attempt ${queuedMessage.retryCount} completed`);
      
      return {
        success: true,
        messageId: deliveryResult.messageId,
        retryCount: queuedMessage.retryCount,
        deliveryMethod: routingStrategy
      };

    } catch (error) {
      logger.error(`Failed to retry message ${messageId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate message content and structure
   * @param {Object} message - Message to validate
   * @returns {Promise<Object>} Validated message
   */
  async validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be a valid object');
    }

    if (!message.text || typeof message.text !== 'string') {
      throw new Error('Message must contain text content');
    }

    if (message.text.length > 5000) {
      throw new Error('Message text exceeds maximum length of 5000 characters');
    }

    // Validate message type
    const validTypes = ['request', 'response', 'notification', 'system'];
    if (message.type && !validTypes.includes(message.type)) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (message.priority && !validPriorities.includes(message.priority)) {
      throw new Error(`Invalid message priority: ${message.priority}`);
    }

    // Sanitize and validate attachments
    if (message.attachments) {
      message.attachments = message.attachments.filter(attachment => 
        attachment && typeof attachment === 'object' && attachment.type
      );
    }

    return message;
  }

  /**
   * Preprocess message before routing
   * @param {Object} message - Message to preprocess
   * @param {Object} fromAI - Source AI instance
   * @param {Object} toAI - Target AI instance (null for group messages)
   * @returns {Promise<Object>} Preprocessed message
   */
  async preprocessMessage(message, fromAI, toAI) {
    const processedMessage = { ...message };
    
    // Add routing metadata
    processedMessage.metadata = processedMessage.metadata || {};
    processedMessage.metadata.routedAt = new Date();
    processedMessage.metadata.fromAiName = fromAI.aiName;
    processedMessage.metadata.fromUserId = fromAI.userId;
    
    if (toAI) {
      processedMessage.metadata.toAiName = toAI.aiName;
      processedMessage.metadata.toUserId = toAI.userId;
    }

    // Apply privacy filters based on AI settings
    if (fromAI.preferences.privacyLevel === 'strict') {
      // Remove sensitive data for strict privacy
      delete processedMessage.metadata.fromUserId;
      if (processedMessage.data) {
        delete processedMessage.data.location;
        delete processedMessage.data.personalInfo;
      }
    }

    // Add conversation tracking
    if (!processedMessage.metadata.conversationId) {
      processedMessage.metadata.conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    return processedMessage;
  }

  /**
   * Determine the best routing strategy for a target AI
   * @param {Object} targetAI - Target AI instance
   * @param {Object} options - Routing options
   * @returns {string} Routing strategy ('realtime' or 'queued')
   */
  determineRoutingStrategy(targetAI, options = {}) {
    // Force queued delivery if specified
    if (options.forceQueued) {
      return 'queued';
    }

    // Force realtime delivery if specified and AI is online
    if (options.forceRealtime && targetAI.isOnline) {
      return 'realtime';
    }

    // Default strategy based on AI status and preferences
    if (targetAI.isOnline && targetAI.preferences.responseTimePreference === 'immediate') {
      return 'realtime';
    }

    // Use queued delivery for offline AIs or when preferred
    return 'queued';
  }

  /**
   * Deliver message in real-time via Socket.IO
   * @param {string} fromAiId - Source AI identifier
   * @param {string} toAiId - Target AI identifier
   * @param {Object} message - Processed message
   * @param {Object} options - Delivery options
   * @returns {Promise<Object>} Delivery result
   */
  async deliverRealtime(fromAiId, toAiId, message, options = {}) {
    const connection = this.activeConnections.get(toAiId);
    
    if (!connection) {
      throw new Error(`No active connection for AI ${toAiId}`);
    }

    const messageId = `rt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const deliveryPacket = {
      messageId,
      fromAiId,
      toAiId,
      message,
      timestamp: new Date(),
      options
    };

    // Send via Socket.IO
    connection.emit('ai:message', deliveryPacket);
    
    // Also create a queue entry for tracking and potential retry
    const queueEntry = await AIMessageQueue.createMessage(
      fromAiId,
      toAiId,
      message.type || 'request',
      message,
      {
        priority: message.priority || 'medium',
        scheduledFor: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      }
    );

    // Mark as delivered immediately for real-time
    await queueEntry.markAsDelivered();

    return {
      messageId: queueEntry.queueId,
      deliveryMethod: 'realtime',
      queuePosition: 0
    };
  }

  /**
   * Deliver message via queue system
   * @param {string} fromAiId - Source AI identifier
   * @param {string} toAiId - Target AI identifier
   * @param {Object} message - Processed message
   * @param {Object} options - Delivery options
   * @returns {Promise<Object>} Delivery result
   */
  async deliverQueued(fromAiId, toAiId, message, options = {}) {
    const queueEntry = await AIMessageQueue.createMessage(
      fromAiId,
      toAiId,
      message.type || 'request',
      message,
      {
        priority: message.priority || 'medium',
        scheduledFor: options.scheduledFor || new Date(),
        expiresAt: options.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
        maxRetries: options.maxRetries || 3
      }
    );

    // Get queue position
    const queuePosition = await this.getQueuePosition(toAiId, queueEntry.priority);

    return {
      messageId: queueEntry.queueId,
      deliveryMethod: 'queued',
      queuePosition
    };
  }

  /**
   * Deliver a queued message in real-time
   * @param {Object} queuedMessage - Queued message document
   * @returns {Promise<Object>} Delivery result
   */
  async deliverRealtimeFromQueue(queuedMessage) {
    const connection = this.activeConnections.get(queuedMessage.targetAiId);
    
    if (!connection) {
      throw new Error(`No active connection for AI ${queuedMessage.targetAiId}`);
    }

    const deliveryPacket = {
      messageId: queuedMessage.queueId,
      fromAiId: queuedMessage.fromAiId,
      toAiId: queuedMessage.targetAiId,
      message: queuedMessage.content,
      timestamp: new Date(),
      isRetry: queuedMessage.retryCount > 0
    };

    // Send via Socket.IO
    connection.emit('ai:message', deliveryPacket);
    
    // Mark as delivered
    await queuedMessage.markAsDelivered();

    return {
      messageId: queuedMessage.queueId,
      deliveryMethod: 'realtime'
    };
  }

  /**
   * Get AI members of a group
   * @param {string} groupId - Group identifier
   * @returns {Promise<Array>} Array of AI instances
   */
  async getGroupAIMembers(groupId) {
    try {
      // Integrate with your existing group system directly to avoid circular dependency
      const Group = require('../models/groupModel');
      const AIInstance = require('../models/aiInstanceModel');
      
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

      logger.info(`Found ${groupAIs.length} AI instances for group ${groupId}`);
      return groupAIs;
    } catch (error) {
      logger.error(`Failed to get group AI members for ${groupId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get position of a message in the queue
   * @param {string} targetAiId - Target AI identifier
   * @param {string} priority - Message priority
   * @returns {Promise<number>} Queue position
   */
  async getQueuePosition(targetAiId, priority) {
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
    const messagePriorityValue = priorityOrder[priority] || 2;

    const higherPriorityCount = await AIMessageQueue.countDocuments({
      targetAiId,
      status: 'queued',
      priority: { $in: Object.keys(priorityOrder).filter(p => priorityOrder[p] > messagePriorityValue) }
    });

    return higherPriorityCount + 1;
  }

  /**
   * Handle AI heartbeat
   * @param {string} aiId - AI identifier
   */
  async handleHeartbeat(aiId) {
    try {
      const ai = await AIInstance.findByAiId(aiId);
      if (ai) {
        await ai.updateHeartbeat();
      }
    } catch (error) {
      logger.error(`Failed to handle heartbeat for AI ${aiId}: ${error.message}`);
    }
  }

  /**
   * Update routing statistics
   * @param {boolean} success - Whether the routing was successful
   * @param {number} latency - Routing latency in milliseconds
   */
  updateRoutingStats(success, latency) {
    this.routingStats.messagesRouted++;
    
    if (success) {
      this.routingStats.successfulDeliveries++;
    } else {
      this.routingStats.failedDeliveries++;
    }

    // Update average latency (simple moving average)
    const totalMessages = this.routingStats.messagesRouted;
    this.routingStats.averageLatency = 
      ((this.routingStats.averageLatency * (totalMessages - 1)) + latency) / totalMessages;
  }

  /**
   * Get routing statistics
   * @returns {Object} Current routing statistics
   */
  getRoutingStats() {
    return {
      ...this.routingStats,
      successRate: this.routingStats.messagesRouted > 0 
        ? this.routingStats.successfulDeliveries / this.routingStats.messagesRouted 
        : 0,
      activeConnections: this.activeConnections.size
    };
  }

  /**
   * Get active AI connections
   * @returns {Array} List of active AI IDs
   */
  getActiveConnections() {
    return Array.from(this.activeConnections.keys());
  }
}

module.exports = AIRouterService;
