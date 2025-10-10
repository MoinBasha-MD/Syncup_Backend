const AIRouterService = require('./aiRouterService');
const AIRegistryService = require('./aiRegistryService');
const AIMessageQueueService = require('./aiMessageQueueService');
const AIAuthMiddleware = require('../middleware/aiAuthMiddleware');
const { aiLogger, connectionLogger } = require('../utils/loggerSetup');

class AISocketService {
  constructor() {
    this.aiRouter = new AIRouterService();
    this.aiRegistry = new AIRegistryService();
    this.messageQueue = new AIMessageQueueService();
    this.connectedAIs = new Map(); // aiId -> socket
    this.userSockets = new Map(); // userId -> socket
  }

  /**
   * Initialize AI Socket.IO events
   * @param {Object} io - Socket.IO server instance
   */
  initialize(io) {
    this.io = io;
    
    // Create AI namespace for AI-to-AI communication
    this.aiNamespace = io.of('/ai');
    
    this.aiNamespace.on('connection', (socket) => {
      this.handleAIConnection(socket);
    });

    // Handle user connections for AI notifications
    io.on('connection', (socket) => {
      this.handleUserConnection(socket);
    });

    aiLogger.info('AI Socket Service initialized', { event: 'ai_socket_service_init' });
  }

  /**
   * Handle AI instance connections
   * @param {Object} socket - Socket.IO socket
   */
  async handleAIConnection(socket) {
    connectionLogger.info('AI attempting to connect', { 
      socketId: socket.id,
      event: 'ai_connection_attempt'
    });

    // Authenticate AI
    socket.on('ai:authenticate', async (data) => {
      try {
        const { aiToken } = data;
        const validation = await AIAuthMiddleware.validateAIToken(aiToken);
        
        if (!validation.valid) {
          socket.emit('ai:auth_error', { error: validation.error });
          socket.disconnect();
          return;
        }

        const ai = validation.ai;
        
        // Register AI connection
        this.connectedAIs.set(ai.aiId, socket);
        this.aiRouter.registerConnection(ai.aiId, socket);
        
        // Update AI status to online
        await this.aiRegistry.updateAIStatus(ai.aiId, 'online');
        
        socket.aiId = ai.aiId;
        socket.userId = ai.userId;
        socket.join(`ai_${ai.aiId}`);
        socket.join(`user_${ai.userId}`);
        
        socket.emit('ai:authenticated', { 
          aiId: ai.aiId,
          status: 'online',
          capabilities: ai.capabilities
        });

        aiLogger.info('AI authenticated and connected', {
          aiId: ai.aiId,
          userId: ai.userId,
          socketId: socket.id,
          event: 'ai_authenticated'
        });

        // Set up AI-specific event handlers
        this.setupAIEventHandlers(socket, ai);

      } catch (error) {
        aiLogger.error('AI authentication failed', {
          error: error.message,
          socketId: socket.id,
          event: 'ai_auth_failed'
        });
        socket.emit('ai:auth_error', { error: 'Authentication failed' });
        socket.disconnect();
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleAIDisconnection(socket);
    });
  }

  /**
   * Set up event handlers for authenticated AI
   * @param {Object} socket - Socket.IO socket
   * @param {Object} ai - AI instance data
   */
  setupAIEventHandlers(socket, ai) {
    // Handle direct AI messages
    socket.on('ai:send_message', async (data) => {
      try {
        const { targetAiId, message, priority = 'medium', options = {} } = data;
        
        aiLogger.info('AI sending direct message', {
          fromAiId: ai.aiId,
          targetAiId,
          messageType: message.type,
          priority,
          event: 'ai_send_message'
        });

        const result = await this.aiRouter.routeMessage(
          ai.aiId,
          targetAiId,
          message,
          { ...options, priority }
        );

        socket.emit('ai:message_sent', {
          messageId: result.messageId,
          success: result.success,
          deliveryMethod: result.deliveryMethod,
          error: result.error
        });

      } catch (error) {
        aiLogger.error('Failed to send AI message', {
          fromAiId: ai.aiId,
          error: error.message,
          event: 'ai_send_message_failed'
        });
        socket.emit('ai:message_error', { error: error.message });
      }
    });

    // Handle group broadcasts
    socket.on('ai:broadcast_message', async (data) => {
      try {
        const { groupId, message, priority = 'medium', options = {} } = data;
        
        aiLogger.info('AI broadcasting to group', {
          fromAiId: ai.aiId,
          groupId,
          messageType: message.type,
          priority,
          event: 'ai_broadcast_message'
        });

        const result = await this.aiRouter.routeToGroup(
          ai.aiId,
          groupId,
          message,
          { ...options, priority, createNetwork: true }
        );

        socket.emit('ai:broadcast_sent', {
          networkId: result.networkId,
          success: result.success,
          totalTargets: result.totalTargets,
          successfulDeliveries: result.successfulDeliveries,
          error: result.error
        });

      } catch (error) {
        aiLogger.error('Failed to broadcast AI message', {
          fromAiId: ai.aiId,
          error: error.message,
          event: 'ai_broadcast_failed'
        });
        socket.emit('ai:broadcast_error', { error: error.message });
      }
    });

    // Handle AI status updates
    socket.on('ai:update_status', async (data) => {
      try {
        const { status } = data;
        await this.aiRegistry.updateAIStatus(ai.aiId, status);
        
        // Broadcast status update to other AIs
        this.aiNamespace.emit('ai:status_updated', {
          aiId: ai.aiId,
          status,
          timestamp: new Date()
        });

        socket.emit('ai:status_updated', { status });
        
        aiLogger.info('AI status updated', {
          aiId: ai.aiId,
          status,
          event: 'ai_status_updated'
        });

      } catch (error) {
        socket.emit('ai:status_error', { error: error.message });
      }
    });

    // Handle heartbeat
    socket.on('ai:heartbeat', async () => {
      try {
        await this.aiRegistry.getAIById(ai.aiId);
        socket.emit('ai:heartbeat_ack');
      } catch (error) {
        socket.emit('ai:heartbeat_error', { error: error.message });
      }
    });

    // Handle message processing confirmation
    socket.on('ai:message_processed', async (data) => {
      try {
        const { messageId, response, success = true } = data;
        
        // Update message status in queue
        await this.messageQueue.processQueuedMessages(ai.aiId, async (message) => {
          if (message.queueId === messageId) {
            return { success, response, responseReceived: !!response };
          }
          return { success: false, error: 'Message not found' };
        });

        aiLogger.info('AI message processed', {
          aiId: ai.aiId,
          messageId,
          success,
          event: 'ai_message_processed'
        });

      } catch (error) {
        aiLogger.error('Failed to process AI message', {
          aiId: ai.aiId,
          error: error.message,
          event: 'ai_message_process_failed'
        });
      }
    });
  }

  /**
   * Handle user connections for AI notifications
   * @param {Object} socket - Socket.IO socket
   */
  async handleUserConnection(socket) {
    socket.on('user:authenticate', async (data) => {
      try {
        const { userId, token } = data;
        
        // Validate user token (you can use existing auth middleware logic)
        // For now, we'll assume it's valid
        
        this.userSockets.set(userId, socket);
        socket.userId = userId;
        socket.join(`user_${userId}`);
        
        connectionLogger.info('User connected for AI notifications', {
          userId,
          socketId: socket.id,
          event: 'user_connected'
        });

        // Check if user has an AI and get its status
        const userAI = await this.aiRegistry.getAIByUser(userId);
        if (userAI) {
          socket.emit('ai:status', {
            aiId: userAI.aiId,
            status: userAI.status,
            isOnline: userAI.isOnline
          });
        }

      } catch (error) {
        connectionLogger.error('User connection failed', {
          error: error.message,
          socketId: socket.id,
          event: 'user_connection_failed'
        });
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        this.userSockets.delete(socket.userId);
        connectionLogger.info('User disconnected', {
          userId: socket.userId,
          socketId: socket.id,
          event: 'user_disconnected'
        });
      }
    });
  }

  /**
   * Handle AI disconnection
   * @param {Object} socket - Socket.IO socket
   */
  async handleAIDisconnection(socket) {
    if (socket.aiId) {
      this.connectedAIs.delete(socket.aiId);
      this.aiRouter.unregisterConnection(socket.aiId);
      
      try {
        // Update AI status to offline
        await this.aiRegistry.updateAIStatus(socket.aiId, 'offline');
        
        // Notify other AIs
        this.aiNamespace.emit('ai:status_updated', {
          aiId: socket.aiId,
          status: 'offline',
          timestamp: new Date()
        });

      } catch (error) {
        aiLogger.error('Error updating AI status on disconnect', {
          aiId: socket.aiId,
          error: error.message
        });
      }

      aiLogger.info('AI disconnected', {
        aiId: socket.aiId,
        userId: socket.userId,
        socketId: socket.id,
        event: 'ai_disconnected'
      });
    }
  }

  /**
   * Send message to AI via Socket.IO
   * @param {string} targetAiId - Target AI identifier
   * @param {Object} message - Message to send
   */
  async sendMessageToAI(targetAiId, message) {
    const socket = this.connectedAIs.get(targetAiId);
    if (socket) {
      socket.emit('ai:message_received', message);
      return true;
    }
    return false;
  }

  /**
   * Send notification to user
   * @param {string} userId - User identifier
   * @param {Object} notification - Notification data
   */
  async sendNotificationToUser(userId, notification) {
    const socket = this.userSockets.get(userId);
    if (socket) {
      socket.emit('ai:notification', notification);
      return true;
    }
    
    // Also try to send via user's AI if connected
    const userAI = await this.aiRegistry.getAIByUser(userId);
    if (userAI) {
      const aiSocket = this.connectedAIs.get(userAI.aiId);
      if (aiSocket) {
        aiSocket.emit('ai:user_notification', notification);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get connected AIs count
   * @returns {number} Number of connected AIs
   */
  getConnectedAIsCount() {
    return this.connectedAIs.size;
  }

  /**
   * Get connected users count
   * @returns {number} Number of connected users
   */
  getConnectedUsersCount() {
    return this.userSockets.size;
  }

  /**
   * Broadcast to all connected AIs
   * @param {string} event - Event name
   * @param {Object} data - Data to broadcast
   */
  broadcastToAllAIs(event, data) {
    this.aiNamespace.emit(event, data);
  }
}

module.exports = AISocketService;
