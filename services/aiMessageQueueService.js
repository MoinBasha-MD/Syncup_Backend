const AIMessageQueue = require('../models/aiMessageQueueModel');
const AIInstance = require('../models/aiInstanceModel');
const winston = require('winston');

// Configure logger for AI Message Queue Service
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-message-queue.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class AIMessageQueueService {
  constructor() {
    this.processingQueues = new Map(); // aiId -> processing status
    this.queueStats = {
      messagesProcessed: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      averageProcessingTime: 0
    };
    
    // Start background workers
    this.startQueueWorkers();
  }

  /**
   * Enqueue a message for delivery
   * @param {string} targetAiId - Target AI identifier
   * @param {Object} message - Message content and metadata
   * @param {string} priority - Message priority ('low', 'medium', 'high', 'urgent')
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueueMessage(targetAiId, message, priority = 'medium', options = {}) {
    const startTime = Date.now();
    
    try {
      // Validate target AI exists
      const targetAI = await AIInstance.findByAiId(targetAiId);
      if (!targetAI) {
        throw new Error(`Target AI ${targetAiId} not found`);
      }

      // Create queue entry
      const queueEntry = await AIMessageQueue.createMessage(
        message.fromAiId,
        targetAiId,
        message.type || 'request',
        message.content,
        {
          priority,
          scheduledFor: options.scheduledFor || new Date(),
          expiresAt: options.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxRetries: options.maxRetries || 3
        }
      );

      // Get current queue position
      const queuePosition = await this.getQueuePosition(targetAiId, priority);

      logger.info(`Message ${queueEntry.queueId} enqueued for AI ${targetAiId} at position ${queuePosition}`);

      return {
        success: true,
        messageId: queueEntry.queueId,
        queuePosition,
        estimatedDeliveryTime: this.estimateDeliveryTime(queuePosition, priority),
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`Failed to enqueue message for AI ${targetAiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Dequeue messages for a specific AI
   * @param {string} aiId - AI identifier
   * @param {number} limit - Maximum number of messages to dequeue
   * @returns {Promise<Array>} Array of dequeued messages
   */
  async dequeueMessages(aiId, limit = 10) {
    try {
      // Check if AI is already being processed
      if (this.processingQueues.get(aiId)) {
        logger.warn(`AI ${aiId} queue is already being processed`);
        return [];
      }

      // Mark as processing
      this.processingQueues.set(aiId, true);

      // Get queued messages
      const queuedMessages = await AIMessageQueue.getQueuedMessages(aiId, limit);
      
      if (queuedMessages.length === 0) {
        this.processingQueues.delete(aiId);
        return [];
      }

      // Mark messages as processing
      const processingPromises = queuedMessages.map(msg => msg.markAsProcessing());
      await Promise.all(processingPromises);

      logger.info(`Dequeued ${queuedMessages.length} messages for AI ${aiId}`);

      return queuedMessages;

    } catch (error) {
      logger.error(`Failed to dequeue messages for AI ${aiId}: ${error.message}`);
      this.processingQueues.delete(aiId);
      throw error;
    }
  }

  /**
   * Process queued messages for a specific AI
   * @param {string} aiId - AI identifier
   * @param {Function} messageHandler - Function to handle each message
   * @returns {Promise<Object>} Processing result
   */
  async processQueuedMessages(aiId, messageHandler) {
    const startTime = Date.now();
    let processedCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;

    try {
      // Get messages to process
      const messages = await this.dequeueMessages(aiId, 20);
      
      if (messages.length === 0) {
        return {
          success: true,
          processedCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          processingTime: Date.now() - startTime
        };
      }

      // Process each message
      for (const message of messages) {
        try {
          processedCount++;
          
          // Call the message handler
          const handlerResult = await messageHandler(message);
          
          if (handlerResult.success) {
            await message.markAsDelivered();
            deliveredCount++;
            
            // Confirm response if provided
            if (handlerResult.responseReceived) {
              await message.confirmResponse();
            }
          } else {
            await message.markAsFailed(
              handlerResult.errorType || 'processing',
              handlerResult.error || 'Message processing failed',
              handlerResult.errorDetails || {}
            );
            failedCount++;
          }

        } catch (processingError) {
          await message.markAsFailed(
            'system',
            processingError.message,
            { stack: processingError.stack }
          );
          failedCount++;
          logger.error(`Failed to process message ${message.queueId}: ${processingError.message}`);
        }
      }

      // Update statistics
      this.updateQueueStats(processedCount, deliveredCount, failedCount, Date.now() - startTime);

      logger.info(`Processed ${processedCount} messages for AI ${aiId}: ${deliveredCount} delivered, ${failedCount} failed`);

      return {
        success: true,
        processedCount,
        deliveredCount,
        failedCount,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`Failed to process queued messages for AI ${aiId}: ${error.message}`);
      throw error;
    } finally {
      // Always clear processing flag
      this.processingQueues.delete(aiId);
    }
  }

  /**
   * Prioritize a message by updating its priority
   * @param {string} messageId - Message identifier
   * @param {string} newPriority - New priority level
   * @returns {Promise<Object>} Update result
   */
  async prioritizeMessage(messageId, newPriority) {
    try {
      const message = await AIMessageQueue.findById(messageId);
      if (!message) {
        throw new Error(`Message ${messageId} not found`);
      }

      if (message.status !== 'queued') {
        throw new Error(`Cannot prioritize message ${messageId} with status ${message.status}`);
      }

      await message.updatePriority(newPriority);
      
      logger.info(`Message ${messageId} priority updated to ${newPriority}`);

      return {
        success: true,
        messageId,
        oldPriority: message.priority,
        newPriority,
        newQueuePosition: await this.getQueuePosition(message.targetAiId, newPriority)
      };

    } catch (error) {
      logger.error(`Failed to prioritize message ${messageId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get high priority messages for an AI
   * @param {string} aiId - AI identifier
   * @returns {Promise<Array>} Array of high priority messages
   */
  async getHighPriorityMessages(aiId) {
    try {
      const highPriorityMessages = await AIMessageQueue.getHighPriorityMessages(aiId);
      
      logger.info(`Found ${highPriorityMessages.length} high priority messages for AI ${aiId}`);
      
      return highPriorityMessages;

    } catch (error) {
      logger.error(`Failed to get high priority messages for AI ${aiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up expired messages
   * @returns {Promise<number>} Number of cleaned up messages
   */
  async cleanupExpiredMessages() {
    try {
      const result = await AIMessageQueue.cleanupExpiredMessages();
      
      logger.info(`Cleaned up ${result.deletedCount} expired messages`);
      
      return result.deletedCount;

    } catch (error) {
      logger.error(`Failed to cleanup expired messages: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retry failed messages
   * @param {string} aiId - AI identifier (optional, if not provided retries all)
   * @returns {Promise<Object>} Retry result
   */
  async retryFailedMessages(aiId = null) {
    try {
      let query = {
        status: 'failed',
        retryCount: { $lt: 3 }, // Assuming max retries is 3
        expiresAt: { $gt: new Date() }
      };

      if (aiId) {
        query.targetAiId = aiId;
      }

      const failedMessages = await AIMessageQueue.find(query);
      
      let retriedCount = 0;
      for (const message of failedMessages) {
        if (message.canRetry) {
          await message.incrementRetry();
          retriedCount++;
        }
      }

      logger.info(`Retried ${retriedCount} failed messages${aiId ? ` for AI ${aiId}` : ''}`);

      return {
        success: true,
        retriedCount,
        totalFailedMessages: failedMessages.length
      };

    } catch (error) {
      logger.error(`Failed to retry failed messages: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get queue statistics for an AI
   * @param {string} aiId - AI identifier
   * @returns {Promise<Object>} Queue statistics
   */
  async getQueueStatistics(aiId) {
    try {
      const stats = await AIMessageQueue.getQueueStatistics(aiId);
      
      // Add processing information
      stats.isProcessing = this.processingQueues.has(aiId);
      stats.estimatedProcessingTime = this.estimateProcessingTime(stats.queued);

      return stats;

    } catch (error) {
      logger.error(`Failed to get queue statistics for AI ${aiId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get global queue statistics
   * @returns {Object} Global queue statistics
   */
  getGlobalQueueStatistics() {
    return {
      ...this.queueStats,
      activeProcessingQueues: this.processingQueues.size,
      successRate: this.queueStats.messagesProcessed > 0 
        ? this.queueStats.messagesDelivered / this.queueStats.messagesProcessed 
        : 0
    };
  }

  /**
   * Pause message processing for an AI
   * @param {string} aiId - AI identifier
   * @returns {Promise<boolean>} Success status
   */
  async pauseQueue(aiId) {
    try {
      // Mark AI as busy to prevent new message processing
      const ai = await AIInstance.findByAiId(aiId);
      if (ai) {
        await ai.updateStatus('busy');
      }

      // Stop current processing if active
      this.processingQueues.delete(aiId);

      logger.info(`Queue processing paused for AI ${aiId}`);
      return true;

    } catch (error) {
      logger.error(`Failed to pause queue for AI ${aiId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Resume message processing for an AI
   * @param {string} aiId - AI identifier
   * @returns {Promise<boolean>} Success status
   */
  async resumeQueue(aiId) {
    try {
      // Mark AI as online to resume message processing
      const ai = await AIInstance.findByAiId(aiId);
      if (ai) {
        await ai.updateStatus('online');
      }

      logger.info(`Queue processing resumed for AI ${aiId}`);
      return true;

    } catch (error) {
      logger.error(`Failed to resume queue for AI ${aiId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get messages for a specific conversation
   * @param {string} conversationId - Conversation identifier
   * @returns {Promise<Array>} Array of conversation messages
   */
  async getConversationMessages(conversationId) {
    try {
      const messages = await AIMessageQueue.getMessagesForConversation(conversationId);
      
      return messages.map(msg => ({
        messageId: msg.queueId,
        fromAiId: msg.fromAiId,
        targetAiId: msg.targetAiId,
        content: msg.content,
        status: msg.status,
        timestamp: msg.createdAt,
        deliveredAt: msg.deliveredAt
      }));

    } catch (error) {
      logger.error(`Failed to get conversation messages for ${conversationId}: ${error.message}`);
      throw error;
    }
  }

  // Private helper methods

  /**
   * Get queue position for a message
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
   * Estimate delivery time based on queue position and priority
   * @param {number} queuePosition - Position in queue
   * @param {string} priority - Message priority
   * @returns {Date} Estimated delivery time
   */
  estimateDeliveryTime(queuePosition, priority) {
    const baseProcessingTime = 30; // 30 seconds per message
    const priorityMultipliers = { urgent: 0.5, high: 0.7, medium: 1.0, low: 1.5 };
    
    const multiplier = priorityMultipliers[priority] || 1.0;
    const estimatedSeconds = queuePosition * baseProcessingTime * multiplier;
    
    return new Date(Date.now() + estimatedSeconds * 1000);
  }

  /**
   * Estimate processing time for a queue
   * @param {number} queueSize - Number of messages in queue
   * @returns {number} Estimated processing time in seconds
   */
  estimateProcessingTime(queueSize) {
    const averageProcessingTime = 30; // 30 seconds per message
    return queueSize * averageProcessingTime;
  }

  /**
   * Update queue statistics
   * @param {number} processed - Number of messages processed
   * @param {number} delivered - Number of messages delivered
   * @param {number} failed - Number of messages failed
   * @param {number} processingTime - Total processing time
   */
  updateQueueStats(processed, delivered, failed, processingTime) {
    this.queueStats.messagesProcessed += processed;
    this.queueStats.messagesDelivered += delivered;
    this.queueStats.messagesFailed += failed;

    // Update average processing time
    if (processed > 0) {
      const avgTime = processingTime / processed;
      const totalMessages = this.queueStats.messagesProcessed;
      this.queueStats.averageProcessingTime = 
        ((this.queueStats.averageProcessingTime * (totalMessages - processed)) + (avgTime * processed)) / totalMessages;
    }
  }

  /**
   * Start background workers for queue processing
   */
  startQueueWorkers() {
    // Cleanup worker - runs every 5 minutes
    setInterval(async () => {
      try {
        await this.cleanupExpiredMessages();
      } catch (error) {
        logger.error(`Cleanup worker error: ${error.message}`);
      }
    }, 5 * 60 * 1000);

    // Retry worker - runs every 10 minutes
    setInterval(async () => {
      try {
        await this.retryFailedMessages();
      } catch (error) {
        logger.error(`Retry worker error: ${error.message}`);
      }
    }, 10 * 60 * 1000);

    // Health check worker - runs every minute
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error(`Health check worker error: ${error.message}`);
      }
    }, 60 * 1000);

    logger.info('Queue workers started successfully');
  }

  /**
   * Perform health check on the queue system
   */
  async performHealthCheck() {
    try {
      // Check for stuck processing queues
      const stuckQueues = [];
      for (const [aiId, isProcessing] of this.processingQueues.entries()) {
        if (isProcessing) {
          // Check if AI has been processing for too long (> 10 minutes)
          const ai = await AIInstance.findByAiId(aiId);
          if (ai && ai.lastActive < new Date(Date.now() - 10 * 60 * 1000)) {
            stuckQueues.push(aiId);
          }
        }
      }

      // Clear stuck queues
      stuckQueues.forEach(aiId => {
        this.processingQueues.delete(aiId);
        logger.warn(`Cleared stuck processing queue for AI ${aiId}`);
      });

      // Log health status
      if (stuckQueues.length === 0) {
        logger.debug('Queue system health check passed');
      }

    } catch (error) {
      logger.error(`Health check failed: ${error.message}`);
    }
  }
}

module.exports = AIMessageQueueService;
