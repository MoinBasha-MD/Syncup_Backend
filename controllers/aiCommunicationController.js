const AIRouterService = require('../services/aiRouterService');
const AIMessageQueueService = require('../services/aiMessageQueueService');
const AIRegistryService = require('../services/aiRegistryService');
const AIConversation = require('../models/aiConversationModel');
const winston = require('winston');

// Configure logger for AI Communication Controller
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-communication-controller.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Initialize services
const aiRouterService = new AIRouterService();
const aiMessageQueueService = new AIMessageQueueService();
const aiRegistryService = new AIRegistryService();

class AICommunicationController {
  /**
   * Send message to another AI
   * POST /api/ai/message/send
   */
  static async sendMessage(req, res) {
    try {
      const { targetAiId, targetUserId, message, priority = 'medium', options = {} } = req.body;
      const fromAiId = req.ai.aiId;

      // Validate required fields
      if (!targetAiId && !targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'Target AI ID or User ID is required',
          code: 'TARGET_REQUIRED'
        });
      }

      if (!message || !message.text) {
        return res.status(400).json({
          success: false,
          error: 'Message text is required',
          code: 'MESSAGE_TEXT_REQUIRED'
        });
      }

      // Get target AI ID if user ID provided
      let finalTargetAiId = targetAiId;
      if (!finalTargetAiId && targetUserId) {
        const targetAI = await aiRegistryService.getAIByUser(targetUserId);
        if (!targetAI) {
          return res.status(404).json({
            success: false,
            error: 'Target user does not have an AI instance',
            code: 'TARGET_AI_NOT_FOUND'
          });
        }
        finalTargetAiId = targetAI.aiId;
      }

      // Prepare message with metadata
      const messageWithMetadata = {
        fromAiId,
        type: message.type || 'request',
        content: {
          text: message.text,
          data: message.data || {},
          attachments: message.attachments || [],
          metadata: {
            conversationId: message.conversationId,
            requestId: message.requestId,
            originalUserRequest: message.originalUserRequest,
            context: message.context || {}
          }
        }
      };

      // Route the message
      const routingResult = await aiRouterService.routeMessage(
        fromAiId,
        finalTargetAiId,
        messageWithMetadata,
        {
          priority,
          scheduledFor: options.scheduledFor,
          expiresAt: options.expiresAt,
          forceQueued: options.forceQueued,
          forceRealtime: options.forceRealtime
        }
      );

      if (!routingResult.success) {
        return res.status(400).json({
          success: false,
          error: routingResult.error,
          code: 'MESSAGE_ROUTING_FAILED'
        });
      }

      // Create or update conversation record
      let conversation = null;
      if (message.conversationId) {
        conversation = await AIConversation.findOne({ conversationId: message.conversationId });
      }

      if (!conversation) {
        // Create new conversation
        const targetAI = await aiRegistryService.getAIById(finalTargetAiId);
        conversation = new AIConversation({
          participants: {
            initiatorAI: {
              aiId: fromAiId,
              userId: req.ai.userId,
              aiName: req.ai.aiName
            },
            responderAI: {
              aiId: finalTargetAiId,
              userId: targetAI.userId,
              aiName: targetAI.aiName
            }
          },
          topic: message.context?.activity || 'general',
          context: {
            originalRequest: message.originalUserRequest || message.text,
            activity: message.context?.activity || 'communication',
            timeframe: message.context?.timeframe || 'now',
            urgency: priority === 'urgent' ? 'high' : priority === 'high' ? 'medium' : 'low'
          }
        });
        await conversation.save();
      }

      // Add message to conversation
      await conversation.addMessage(
        fromAiId,
        finalTargetAiId,
        message.type || 'request',
        messageWithMetadata.content
      );

      logger.info(`Message sent from AI ${fromAiId} to AI ${finalTargetAiId}`);

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: {
          messageId: routingResult.messageId,
          conversationId: conversation.conversationId,
          targetAiId: finalTargetAiId,
          deliveryMethod: routingResult.deliveryMethod,
          queuePosition: routingResult.queuePosition,
          estimatedDeliveryTime: routingResult.estimatedDeliveryTime,
          latency: routingResult.latency
        }
      });

    } catch (error) {
      logger.error(`Failed to send AI message: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to send message',
        code: 'MESSAGE_SEND_FAILED'
      });
    }
  }

  /**
   * Broadcast message to group AIs
   * POST /api/ai/message/broadcast
   */
  static async broadcastMessage(req, res) {
    try {
      const { groupId, message, priority = 'medium', options = {} } = req.body;
      const fromAiId = req.ai.aiId;

      // Validate required fields
      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required',
          code: 'GROUP_ID_REQUIRED'
        });
      }

      if (!message || !message.text) {
        return res.status(400).json({
          success: false,
          error: 'Message text is required',
          code: 'MESSAGE_TEXT_REQUIRED'
        });
      }

      // Prepare message with metadata
      const messageWithMetadata = {
        fromAiId,
        type: message.type || 'request',
        topic: message.topic || 'Group Communication',
        content: {
          text: message.text,
          data: message.data || {},
          attachments: message.attachments || [],
          metadata: {
            conversationId: message.conversationId,
            requestId: message.requestId,
            originalUserRequest: message.originalUserRequest,
            context: message.context || {}
          }
        },
        context: {
          originalRequest: message.originalUserRequest || message.text,
          requestType: message.context?.requestType || 'social',
          urgencyLevel: priority === 'urgent' ? 5 : priority === 'high' ? 4 : priority === 'medium' ? 3 : 2,
          expectedResponseTime: options.expectedResponseTime || 30,
          requiresConsensus: options.requiresConsensus || false,
          minimumResponses: options.minimumResponses || 1
        }
      };

      // Route to group
      const routingResult = await aiRouterService.routeToGroup(
        fromAiId,
        groupId,
        messageWithMetadata,
        {
          priority,
          createNetwork: options.createNetwork !== false, // Default to true
          networkOptions: {
            networkType: options.networkType || 'broadcast',
            timeoutAt: options.timeoutAt,
            settings: options.networkSettings
          }
        }
      );

      if (!routingResult.success) {
        return res.status(400).json({
          success: false,
          error: routingResult.error,
          code: 'GROUP_BROADCAST_FAILED'
        });
      }

      logger.info(`Group message broadcast from AI ${fromAiId} to group ${groupId}`);

      res.status(201).json({
        success: true,
        message: 'Group message broadcast successfully',
        data: {
          groupId: routingResult.groupId,
          networkId: routingResult.networkId,
          totalTargets: routingResult.totalTargets,
          successfulDeliveries: routingResult.successfulDeliveries,
          failedDeliveries: routingResult.failedDeliveries,
          latency: routingResult.latency,
          results: routingResult.results
        }
      });

    } catch (error) {
      logger.error(`Failed to broadcast group message: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to broadcast message',
        code: 'GROUP_BROADCAST_FAILED'
      });
    }
  }

  /**
   * Get pending messages for AI
   * GET /api/ai/message/inbox/:aiId
   */
  static async getInbox(req, res) {
    try {
      const { aiId } = req.params;
      const { limit = 20, priority } = req.query;

      // Verify AI ownership
      if (req.ai.aiId !== aiId) {
        return res.status(403).json({
          success: false,
          error: 'Can only access your own inbox',
          code: 'AI_OWNERSHIP_REQUIRED'
        });
      }

      // Get pending messages
      let messages;
      if (priority === 'high') {
        messages = await aiMessageQueueService.getHighPriorityMessages(aiId);
      } else {
        messages = await aiMessageQueueService.dequeueMessages(aiId, parseInt(limit));
      }

      // Format messages for response
      const formattedMessages = messages.map(msg => ({
        messageId: msg.queueId,
        fromAiId: msg.fromAiId,
        messageType: msg.messageType,
        priority: msg.priority,
        content: msg.content,
        status: msg.status,
        createdAt: msg.createdAt,
        scheduledFor: msg.scheduledFor,
        expiresAt: msg.expiresAt,
        retryCount: msg.retryCount
      }));

      res.json({
        success: true,
        data: formattedMessages,
        count: formattedMessages.length,
        hasMore: messages.length === parseInt(limit)
      });

    } catch (error) {
      logger.error(`Failed to get inbox for AI ${req.params.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve inbox',
        code: 'INBOX_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Process/mark message as processed
   * PUT /api/ai/message/process/:messageId
   */
  static async processMessage(req, res) {
    try {
      const { messageId } = req.params;
      const { response, success = true } = req.body;

      // Process the message through queue service
      const processingResult = await aiMessageQueueService.processQueuedMessages(
        req.ai.aiId,
        async (message) => {
          if (message.queueId === messageId) {
            return {
              success,
              response,
              responseReceived: !!response
            };
          }
          return { success: false, error: 'Message not found' };
        }
      );

      if (processingResult.processedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Message not found or already processed',
          code: 'MESSAGE_NOT_FOUND'
        });
      }

      logger.info(`Message ${messageId} processed by AI ${req.ai.aiId}`);

      res.json({
        success: true,
        message: 'Message processed successfully',
        data: {
          messageId,
          processed: processingResult.processedCount > 0,
          delivered: processingResult.deliveredCount > 0
        }
      });

    } catch (error) {
      logger.error(`Failed to process message ${req.params.messageId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to process message',
        code: 'MESSAGE_PROCESSING_FAILED'
      });
    }
  }

  /**
   * Get conversation details
   * GET /api/ai/conversation/:conversationId
   */
  static async getConversation(req, res) {
    try {
      const { conversationId } = req.params;

      const conversation = await AIConversation.findOne({ conversationId });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
          code: 'CONVERSATION_NOT_FOUND'
        });
      }

      // Check if AI is participant in conversation
      const isParticipant = conversation.participants.initiatorAI.aiId === req.ai.aiId ||
                           conversation.participants.responderAI.aiId === req.ai.aiId;

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to conversation',
          code: 'CONVERSATION_ACCESS_DENIED'
        });
      }

      res.json({
        success: true,
        data: {
          conversationId: conversation.conversationId,
          participants: conversation.participants,
          topic: conversation.topic,
          context: conversation.context,
          status: conversation.status,
          messages: conversation.messages,
          result: conversation.result,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        }
      });

    } catch (error) {
      logger.error(`Failed to get conversation ${req.params.conversationId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve conversation',
        code: 'CONVERSATION_RETRIEVAL_FAILED'
      });
    }
  }

  /**
   * Create new AI conversation
   * POST /api/ai/conversation/create
   */
  static async createConversation(req, res) {
    try {
      const { targetAiId, topic, context = {} } = req.body;
      const fromAiId = req.ai.aiId;

      if (!targetAiId) {
        return res.status(400).json({
          success: false,
          error: 'Target AI ID is required',
          code: 'TARGET_AI_REQUIRED'
        });
      }

      // Get target AI
      const targetAI = await aiRegistryService.getAIById(targetAiId);
      if (!targetAI) {
        return res.status(404).json({
          success: false,
          error: 'Target AI not found',
          code: 'TARGET_AI_NOT_FOUND'
        });
      }

      // Create conversation
      const conversation = new AIConversation({
        participants: {
          initiatorAI: {
            aiId: fromAiId,
            userId: req.ai.userId,
            aiName: req.ai.aiName
          },
          responderAI: {
            aiId: targetAiId,
            userId: targetAI.userId,
            aiName: targetAI.aiName
          }
        },
        topic: topic || 'AI Communication',
        context: {
          originalRequest: context.originalRequest || 'Direct AI conversation',
          activity: context.activity || 'communication',
          timeframe: context.timeframe || 'now',
          urgency: context.urgency || 'medium'
        }
      });

      await conversation.save();

      logger.info(`Conversation ${conversation.conversationId} created between AI ${fromAiId} and AI ${targetAiId}`);

      res.status(201).json({
        success: true,
        message: 'Conversation created successfully',
        data: {
          conversationId: conversation.conversationId,
          participants: conversation.participants,
          topic: conversation.topic,
          context: conversation.context,
          status: conversation.status,
          createdAt: conversation.createdAt
        }
      });

    } catch (error) {
      logger.error(`Failed to create conversation: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to create conversation',
        code: 'CONVERSATION_CREATION_FAILED'
      });
    }
  }

  /**
   * Close conversation
   * PUT /api/ai/conversation/:conversationId/close
   */
  static async closeConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const { result } = req.body;

      const conversation = await AIConversation.findOne({ conversationId });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
          code: 'CONVERSATION_NOT_FOUND'
        });
      }

      // Check if AI is participant in conversation
      const isParticipant = conversation.participants.initiatorAI.aiId === req.ai.aiId ||
                           conversation.participants.responderAI.aiId === req.ai.aiId;

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to conversation',
          code: 'CONVERSATION_ACCESS_DENIED'
        });
      }

      // Close conversation
      await conversation.markCompleted(result || {
        success: true,
        finalResponse: 'Conversation completed',
        nextSteps: []
      });

      logger.info(`Conversation ${conversationId} closed by AI ${req.ai.aiId}`);

      res.json({
        success: true,
        message: 'Conversation closed successfully',
        data: {
          conversationId: conversation.conversationId,
          status: conversation.status,
          result: conversation.result
        }
      });

    } catch (error) {
      logger.error(`Failed to close conversation ${req.params.conversationId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to close conversation',
        code: 'CONVERSATION_CLOSE_FAILED'
      });
    }
  }

  /**
   * Get AI communication statistics
   * GET /api/ai/communication/stats
   */
  static async getCommunicationStats(req, res) {
    try {
      const aiId = req.ai.aiId;

      // Get queue statistics
      const queueStats = await aiMessageQueueService.getQueueStatistics(aiId);
      
      // Get routing statistics
      const routingStats = aiRouterService.getRoutingStats();

      // Get conversation statistics
      const conversationStats = await AIConversation.aggregate([
        {
          $match: {
            $or: [
              { 'participants.initiatorAI.aiId': aiId },
              { 'participants.responderAI.aiId': aiId }
            ]
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const formattedConversationStats = conversationStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {});

      res.json({
        success: true,
        data: {
          aiId,
          queueStats,
          routingStats: {
            messagesRouted: routingStats.messagesRouted,
            successfulDeliveries: routingStats.successfulDeliveries,
            failedDeliveries: routingStats.failedDeliveries,
            averageLatency: routingStats.averageLatency,
            successRate: routingStats.successRate
          },
          conversationStats: {
            total: Object.values(formattedConversationStats).reduce((sum, count) => sum + count, 0),
            ...formattedConversationStats
          }
        }
      });

    } catch (error) {
      logger.error(`Failed to get communication stats for AI ${req.ai.aiId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve communication statistics',
        code: 'COMMUNICATION_STATS_FAILED'
      });
    }
  }
}

module.exports = AICommunicationController;
