const winston = require('winston');
const Message = require('../../models/Message');
const User = require('../../models/userModel');
const GroupMessage = require('../../models/groupMessageModel');
const { enhancedNotificationService } = require('../enhancedNotificationService');

// Configure logger for Communication Agent
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/communication-agent.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class CommunicationAgent {
  constructor() {
    this.agentId = null;
    this.isActive = false;
    this.messageQueue = new Map(); // Priority queues for different message types
    this.deliveryTracking = new Map(); // Track message delivery status
    this.userPreferences = new Map(); // Cache user communication preferences
    
    this.metrics = {
      messagesProcessed: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      averageDeliveryTime: 0,
      notificationsSent: 0,
      queueSize: 0
    };
    
    // Initialize message queues
    this.initializeMessageQueues();
  }

  /**
   * Initialize the communication agent
   */
  async initialize(agentId) {
    this.agentId = agentId;
    this.isActive = true;
    
    logger.info(`📱 Communication Agent ${agentId} initialized`);
    
    // Start message processing
    this.startMessageProcessing();
    
    // Load user preferences
    await this.loadUserPreferences();
  }

  /**
   * Process a communication task
   */
  async processTask(payload, context) {
    const startTime = Date.now();
    
    try {
      const { action, data } = payload;
      let result;
      
      switch (action) {
        case 'send_message':
          result = await this.sendMessage(data, context);
          break;
        case 'broadcast_message':
          result = await this.broadcastMessage(data, context);
          break;
        case 'send_notification':
          result = await this.sendNotification(data, context);
          break;
        case 'process_message_queue':
          result = await this.processMessageQueue(data, context);
          break;
        case 'optimize_delivery':
          result = await this.optimizeDelivery(data, context);
          break;
        case 'analyze_communication_patterns':
          result = await this.analyzeCommunicationPatterns(data, context);
          break;
        default:
          throw new Error(`Unknown communication action: ${action}`);
      }
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      
      return result;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      logger.error(`❌ Communication task failed:`, error);
      throw error;
    }
  }

  /**
   * Send a message with intelligent routing
   */
  async sendMessage(data, context) {
    const { senderId, receiverId, content, messageType = 'text', priority = 'medium', options = {} } = data;
    
    try {
      // Validate users
      const [sender, receiver] = await Promise.all([
        User.findOne({ userId: senderId }),
        User.findOne({ userId: receiverId })
      ]);
      
      if (!sender) throw new Error(`Sender ${senderId} not found`);
      if (!receiver) throw new Error(`Receiver ${receiverId} not found`);
      
      // Check if users can communicate
      const canCommunicate = await this.checkCommunicationPermissions(sender, receiver);
      if (!canCommunicate.allowed) {
        throw new Error(`Communication not allowed: ${canCommunicate.reason}`);
      }
      
      // Create message
      const message = new Message({
        senderId,
        receiverId,
        content,
        messageType,
        timestamp: new Date(),
        metadata: {
          priority,
          agentProcessed: true,
          processingTime: Date.now(),
          ...options.metadata
        }
      });
      
      await message.save();
      
      // Add to appropriate queue based on priority
      await this.addToMessageQueue(message, priority);
      
      // Send real-time notification if receiver is online
      const receiverPrefs = this.userPreferences.get(receiverId);
      if (receiverPrefs?.realTimeNotifications) {
        await this.sendRealTimeNotification(message, receiver);
      }
      
      // Track delivery
      this.trackMessageDelivery(message._id, {
        status: 'queued',
        queuedAt: new Date(),
        priority
      });
      
      this.metrics.messagesProcessed++;
      
      logger.info(`📨 Message queued: ${message._id} (${senderId} → ${receiverId})`);
      
      return {
        messageId: message._id,
        status: 'queued',
        estimatedDelivery: this.estimateDeliveryTime(priority),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Message sending failed:', error);
      throw error;
    }
  }

  /**
   * Broadcast message to multiple recipients
   */
  async broadcastMessage(data, context) {
    const { senderId, recipients, content, messageType = 'broadcast', priority = 'medium', options = {} } = data;
    
    try {
      const sender = await User.findOne({ userId: senderId });
      if (!sender) throw new Error(`Sender ${senderId} not found`);
      
      const results = [];
      const batchSize = 50; // Process in batches to avoid overwhelming the system
      
      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (recipientId) => {
          try {
            const result = await this.sendMessage({
              senderId,
              receiverId: recipientId,
              content,
              messageType,
              priority,
              options: {
                ...options,
                isBroadcast: true,
                batchId: `broadcast_${Date.now()}`
              }
            }, context);
            
            return { recipientId, success: true, messageId: result.messageId };
          } catch (error) {
            return { recipientId, success: false, error: error.message };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Small delay between batches to prevent system overload
        if (i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      logger.info(`📢 Broadcast completed: ${successful} successful, ${failed} failed`);
      
      return {
        totalRecipients: recipients.length,
        successful,
        failed,
        results,
        batchSize,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Broadcast message failed:', error);
      throw error;
    }
  }

  /**
   * Send intelligent notifications
   */
  async sendNotification(data, context) {
    const { userId, notificationType, title, message, data: notificationData = {}, options = {} } = data;
    
    try {
      const user = await User.findOne({ userId });
      if (!user) throw new Error(`User ${userId} not found`);
      
      // Get user notification preferences
      const preferences = this.userPreferences.get(userId) || await this.getUserPreferences(userId);
      
      // Check if user wants this type of notification
      if (!this.shouldSendNotification(notificationType, preferences)) {
        return {
          userId,
          notificationType,
          sent: false,
          reason: 'User preferences disabled this notification type',
          success: true
        };
      }
      
      // Determine optimal delivery method and timing
      const deliveryStrategy = await this.determineDeliveryStrategy(user, preferences, notificationType);
      
      // Send notification through appropriate channels
      const results = [];
      
      if (deliveryStrategy.channels.includes('push')) {
        const pushResult = await this.sendPushNotification(user, title, message, notificationData);
        results.push({ channel: 'push', ...pushResult });
      }
      
      if (deliveryStrategy.channels.includes('email')) {
        const emailResult = await this.sendEmailNotification(user, title, message, notificationData);
        results.push({ channel: 'email', ...emailResult });
      }
      
      if (deliveryStrategy.channels.includes('sms')) {
        const smsResult = await this.sendSMSNotification(user, title, message, notificationData);
        results.push({ channel: 'sms', ...smsResult });
      }
      
      if (deliveryStrategy.channels.includes('in_app')) {
        const inAppResult = await this.sendInAppNotification(user, title, message, notificationData);
        results.push({ channel: 'in_app', ...inAppResult });
      }
      
      this.metrics.notificationsSent++;
      
      return {
        userId,
        notificationType,
        deliveryStrategy,
        results,
        sent: results.some(r => r.success),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Notification sending failed:', error);
      throw error;
    }
  }

  /**
   * Communicate with other agents or services
   */
  async communicate(payload, context) {
    const { targetType, targetId, messageType, data, priority = 'medium' } = payload;
    
    try {
      let result;
      
      switch (targetType) {
        case 'agent':
          result = await this.communicateWithAgent(targetId, messageType, data, priority);
          break;
        case 'service':
          result = await this.communicateWithService(targetId, messageType, data, priority);
          break;
        case 'external_api':
          result = await this.communicateWithExternalAPI(targetId, messageType, data, priority);
          break;
        case 'webhook':
          result = await this.sendWebhook(targetId, messageType, data, priority);
          break;
        default:
          throw new Error(`Unknown target type: ${targetType}`);
      }
      
      return {
        targetType,
        targetId,
        messageType,
        result,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Inter-service communication failed:', error);
      throw error;
    }
  }

  /**
   * Analyze communication patterns and optimize
   */
  async analyzeData(payload, context) {
    const { analysisType, timeRange = '7d', userId = null } = payload;
    
    try {
      let result;
      
      switch (analysisType) {
        case 'message_patterns':
          result = await this.analyzeMessagePatterns(timeRange, userId);
          break;
        case 'delivery_performance':
          result = await this.analyzeDeliveryPerformance(timeRange);
          break;
        case 'notification_effectiveness':
          result = await this.analyzeNotificationEffectiveness(timeRange);
          break;
        case 'communication_health':
          result = await this.analyzeCommunicationHealth();
          break;
        default:
          throw new Error(`Unknown analysis type: ${analysisType}`);
      }
      
      return {
        analysisType,
        timeRange,
        result,
        generatedAt: new Date(),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Communication analysis failed:', error);
      throw error;
    }
  }

  /**
   * Monitor communication system
   */
  async monitorSystem(payload, context) {
    try {
      const monitoring = {
        queues: {
          high: this.messageQueue.get('high')?.length || 0,
          medium: this.messageQueue.get('medium')?.length || 0,
          low: this.messageQueue.get('low')?.length || 0,
          total: this.getTotalQueueSize()
        },
        delivery: {
          pending: this.getPendingDeliveries(),
          inProgress: this.getInProgressDeliveries(),
          completed: this.getCompletedDeliveries(),
          failed: this.getFailedDeliveries()
        },
        performance: {
          averageDeliveryTime: this.metrics.averageDeliveryTime,
          messagesPerSecond: this.calculateMessagesPerSecond(),
          deliverySuccessRate: this.calculateDeliverySuccessRate(),
          queueProcessingRate: this.calculateQueueProcessingRate()
        },
        systemHealth: {
          memoryUsage: process.memoryUsage().heapUsed,
          activeConnections: this.getActiveConnections(),
          errorRate: this.calculateErrorRate()
        }
      };
      
      // Generate alerts for system issues
      const alerts = [];
      
      if (monitoring.queues.total > 1000) {
        alerts.push({
          type: 'high_queue_size',
          severity: 'warning',
          value: monitoring.queues.total
        });
      }
      
      if (monitoring.performance.deliverySuccessRate < 0.95) {
        alerts.push({
          type: 'low_delivery_success_rate',
          severity: 'critical',
          value: monitoring.performance.deliverySuccessRate
        });
      }
      
      monitoring.alerts = alerts;
      
      return monitoring;
      
    } catch (error) {
      logger.error('❌ Communication monitoring failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the communication agent
   */
  async healthCheck() {
    return {
      status: this.isActive ? 'healthy' : 'inactive',
      queueSize: this.getTotalQueueSize(),
      deliveryTracking: this.deliveryTracking.size,
      userPreferences: this.userPreferences.size,
      metrics: this.metrics,
      lastActivity: new Date()
    };
  }

  // Helper methods

  /**
   * Initialize message queues
   */
  initializeMessageQueues() {
    this.messageQueue.set('urgent', []);
    this.messageQueue.set('high', []);
    this.messageQueue.set('medium', []);
    this.messageQueue.set('low', []);
  }

  /**
   * Add message to appropriate queue
   */
  async addToMessageQueue(message, priority) {
    const queue = this.messageQueue.get(priority) || this.messageQueue.get('medium');
    queue.push({
      message,
      queuedAt: new Date(),
      attempts: 0
    });
    
    this.metrics.queueSize = this.getTotalQueueSize();
  }

  /**
   * Start message processing
   */
  startMessageProcessing() {
    // Process messages every second
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.processNextMessage();
      } catch (error) {
        logger.error('❌ Message processing error:', error);
      }
    }, 1000);
  }

  /**
   * Process next message in queue
   */
  async processNextMessage() {
    // Process in priority order
    const priorities = ['urgent', 'high', 'medium', 'low'];
    
    for (const priority of priorities) {
      const queue = this.messageQueue.get(priority);
      if (queue && queue.length > 0) {
        const queueItem = queue.shift();
        await this.deliverMessage(queueItem);
        this.metrics.queueSize = this.getTotalQueueSize();
        return;
      }
    }
  }

  /**
   * Deliver message to recipient
   */
  async deliverMessage(queueItem) {
    const startTime = Date.now();
    
    try {
      const { message } = queueItem;
      
      // Update delivery tracking
      this.updateDeliveryTracking(message._id, {
        status: 'delivering',
        deliveryStarted: new Date()
      });
      
      // Simulate message delivery (in real implementation, this would use Socket.IO, push notifications, etc.)
      await this.performMessageDelivery(message);
      
      const deliveryTime = Date.now() - startTime;
      
      // Update delivery tracking
      this.updateDeliveryTracking(message._id, {
        status: 'delivered',
        deliveredAt: new Date(),
        deliveryTime
      });
      
      // Update metrics
      this.metrics.messagesDelivered++;
      this.updateAverageDeliveryTime(deliveryTime);
      
      logger.info(`✅ Message delivered: ${message._id} in ${deliveryTime}ms`);
      
    } catch (error) {
      this.metrics.messagesFailed++;
      
      // Update delivery tracking
      this.updateDeliveryTracking(queueItem.message._id, {
        status: 'failed',
        error: error.message,
        failedAt: new Date()
      });
      
      // Retry logic
      queueItem.attempts++;
      if (queueItem.attempts < 3) {
        // Re-queue with lower priority
        const retryQueue = this.messageQueue.get('low');
        retryQueue.push(queueItem);
      }
      
      logger.error(`❌ Message delivery failed: ${queueItem.message._id}`, error);
    }
  }

  /**
   * Check communication permissions between users
   */
  async checkCommunicationPermissions(sender, receiver) {
    // Check if receiver has blocked sender
    if (receiver.blockedUsers && receiver.blockedUsers.includes(sender.userId)) {
      return { allowed: false, reason: 'Sender is blocked by receiver' };
    }
    
    // Check privacy settings
    if (receiver.privacySettings?.allowMessagesFrom === 'contacts_only') {
      if (!receiver.contacts || !receiver.contacts.includes(sender.userId)) {
        return { allowed: false, reason: 'Receiver only accepts messages from contacts' };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Load user preferences
   */
  async loadUserPreferences() {
    try {
      const users = await User.find({}, 'userId notificationPreferences communicationPreferences');
      
      for (const user of users) {
        this.userPreferences.set(user.userId, {
          notifications: user.notificationPreferences || {},
          communication: user.communicationPreferences || {},
          realTimeNotifications: true // Default
        });
      }
      
      logger.info(`📋 Loaded preferences for ${users.length} users`);
      
    } catch (error) {
      logger.error('❌ Failed to load user preferences:', error);
    }
  }

  /**
   * Update agent metrics
   */
  updateMetrics(processingTime, success) {
    if (success) {
      this.metrics.messagesProcessed++;
    } else {
      this.metrics.messagesFailed++;
    }
  }

  /**
   * Update average delivery time
   */
  updateAverageDeliveryTime(deliveryTime) {
    const totalDelivered = this.metrics.messagesDelivered;
    this.metrics.averageDeliveryTime = 
      ((this.metrics.averageDeliveryTime * (totalDelivered - 1)) + deliveryTime) / totalDelivered;
  }

  /**
   * Get total queue size
   */
  getTotalQueueSize() {
    let total = 0;
    for (const queue of this.messageQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Track message delivery
   */
  trackMessageDelivery(messageId, status) {
    this.deliveryTracking.set(messageId.toString(), {
      ...this.deliveryTracking.get(messageId.toString()),
      ...status
    });
  }

  /**
   * Update delivery tracking
   */
  updateDeliveryTracking(messageId, updates) {
    const existing = this.deliveryTracking.get(messageId.toString()) || {};
    this.deliveryTracking.set(messageId.toString(), { ...existing, ...updates });
  }

  /**
   * Estimate delivery time based on priority
   */
  estimateDeliveryTime(priority) {
    const estimates = {
      urgent: 1000, // 1 second
      high: 5000,   // 5 seconds
      medium: 15000, // 15 seconds
      low: 60000    // 1 minute
    };
    
    return new Date(Date.now() + (estimates[priority] || estimates.medium));
  }
}

module.exports = CommunicationAgent;
