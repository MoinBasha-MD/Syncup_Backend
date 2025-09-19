const AIAssistant = require('../models/aiAssistantModel');
const AIConversation = require('../models/aiConversationModel');
const User = require('../models/userModel');
const { broadcastToUser } = require('../socketManager');

/**
 * AI Message Service
 * Core service for AI-to-AI communication
 */

class AIMessageService {
  
  /**
   * Initialize AI for a user (called when user registers or first uses AI)
   */
  static async initializeAI(userId, aiName = 'Diya') {
    try {
      // Check if AI already exists
      let ai = await AIAssistant.findByUserId(userId);
      
      if (!ai) {
        ai = new AIAssistant({
          userId,
          aiName,
          personality: 'friendly'
        });
        await ai.save();
        console.log(`🤖 AI initialized for user ${userId}: ${aiName}`);
      }
      
      return ai;
    } catch (error) {
      console.error('Error initializing AI:', error);
      throw error;
    }
  }

  /**
   * Send AI-to-AI message with instant WebSocket delivery
   */
  static async sendInstantAIMessage(fromUserId, toUserId, messageData) {
    try {
      const { messageType, content, context } = messageData;

      // Get both AIs
      const senderAI = await AIAssistant.findByUserId(fromUserId);
      const receiverAI = await AIAssistant.findByUserId(toUserId);

      if (!senderAI) {
        await this.initializeAI(fromUserId);
        senderAI = await AIAssistant.findByUserId(fromUserId);
      }

      if (!receiverAI) {
        await this.initializeAI(toUserId);
        receiverAI = await AIAssistant.findByUserId(toUserId);
      }

      // Create conversation record
      const conversation = new AIConversation({
        participants: {
          initiatorAI: {
            aiId: senderAI.aiId,
            userId: fromUserId,
            aiName: senderAI.aiName
          },
          responderAI: {
            aiId: receiverAI.aiId,
            userId: toUserId,
            aiName: receiverAI.aiName
          }
        },
        topic: context?.topic || 'availability_check',
        context: context || {}
      });

      await conversation.save();

      // Add initial message
      await conversation.addMessage(
        senderAI.aiId,
        receiverAI.aiId,
        messageType,
        content
      );

      // Prepare WebSocket message
      const wsMessage = {
        type: 'ai_message_received',
        conversationId: conversation.conversationId,
        fromAI: {
          aiId: senderAI.aiId,
          name: senderAI.aiName,
          userId: fromUserId
        },
        toAI: {
          aiId: receiverAI.aiId,
          name: receiverAI.aiName,
          userId: toUserId
        },
        messageType,
        content,
        context,
        timestamp: new Date(),
        requiresResponse: true
      };

      // Send via WebSocket for instant delivery
      const delivered = broadcastToUser(toUserId, 'ai_message_received', wsMessage);
      
      console.log(`🚀 Instant AI message: ${senderAI.aiName} → ${receiverAI.aiName} (${delivered ? 'delivered' : 'queued'})`);

      return {
        success: true,
        conversationId: conversation.conversationId,
        delivered
      };

    } catch (error) {
      console.error('Error sending instant AI message:', error);
      throw error;
    }
  }

  /**
   * Process AI message and generate instant response
   */
  static async generateInstantResponse(userId, messageData) {
    try {
      const { conversationId, fromAI, content, context } = messageData;

      // Get user's AI and user info
      const userAI = await AIAssistant.findByUserId(userId);
      const user = await User.findById(userId);

      if (!userAI || !user) {
        throw new Error('User or AI not found');
      }

      // Generate response based on request type
      let response;
      
      if (context?.topic === 'availability_check') {
        response = await this.generateAvailabilityResponse(user, userAI, content, context);
      } else {
        response = await this.generateGeneralResponse(user, userAI, content, context);
      }

      // Update conversation with response
      const conversation = await AIConversation.findOne({ conversationId });
      if (conversation) {
        await conversation.addMessage(
          userAI.aiId,
          fromAI.aiId,
          'response',
          response
        );

        // Mark as completed if it's a simple availability check
        if (context?.topic === 'availability_check') {
          await conversation.markCompleted({
            success: true,
            finalResponse: response.text
          });
        }
      }

      // Send response back via WebSocket
      const responseMessage = {
        type: 'ai_response_received',
        conversationId,
        fromAI: {
          aiId: userAI.aiId,
          name: userAI.aiName,
          userId: userId
        },
        toAI: fromAI,
        messageType: 'response',
        content: response,
        timestamp: new Date()
      };

      broadcastToUser(fromAI.userId, 'ai_response_received', responseMessage);

      console.log(`⚡ Instant AI response: ${userAI.aiName} → ${fromAI.name}`);

      return response;

    } catch (error) {
      console.error('Error generating instant response:', error);
      throw error;
    }
  }

  /**
   * Generate availability response with privacy controls
   */
  static async generateAvailabilityResponse(user, userAI, requestContent, context) {
    try {
      const activity = context?.activity || 'meeting';
      
      // Check privacy settings
      const canShareStatus = userAI.privacySettings.shareStatus;
      const canShareCalendar = userAI.privacySettings.shareCalendarAvailability;
      const canShareLocation = userAI.privacySettings.shareGeneralLocation;

      if (!canShareStatus) {
        return {
          text: `I'm not able to share ${user.name || 'my user'}'s availability information right now.`,
          sharedData: {
            availability: null,
            reason: 'privacy_restricted'
          }
        };
      }

      // Get current status
      const currentStatus = user.status || 'Available';
      const isAvailable = currentStatus === 'Available';
      
      let responseText = '';
      let sharedData = {
        availability: isAvailable,
        status: currentStatus
      };

      if (isAvailable) {
        responseText = `Great news! ${user.name || 'My user'} is currently available`;
        
        // Add time information if allowed
        if (canShareCalendar) {
          responseText += ' and free for the next 2 hours';
          sharedData.timeSlots = ['next 2 hours'];
        }
        
        // Add location if allowed
        if (canShareLocation) {
          responseText += '. They\'re currently in the downtown area';
          sharedData.location = 'downtown area';
        }
        
        responseText += `. Perfect timing for ${activity}! 😊`;
        
      } else {
        responseText = `${user.name || 'My user'} is currently ${currentStatus.toLowerCase()}`;
        
        if (canShareCalendar) {
          responseText += ', but they might be available later today';
        }
        
        responseText += `. Would you like me to check for alternative times?`;
      }

      return {
        text: responseText,
        sharedData
      };

    } catch (error) {
      console.error('Error generating availability response:', error);
      return {
        text: "I'm having trouble checking availability right now. Please try again in a moment.",
        sharedData: { error: true }
      };
    }
  }

  /**
   * Generate general response
   */
  static async generateGeneralResponse(user, userAI, content, context) {
    return {
      text: `${userAI.aiName} received your message. Thank you for reaching out!`,
      sharedData: {
        acknowledged: true,
        timestamp: new Date()
      }
    };
  }

  /**
   * Get AI conversations for user
   */
  static async getUserAIConversations(userId, limit = 20) {
    try {
      const userAI = await AIAssistant.findByUserId(userId);
      if (!userAI) {
        return [];
      }

      const conversations = await AIConversation.findByAI(userAI.aiId)
        .populate('participants.initiatorAI.userId', 'name profileImage')
        .populate('participants.responderAI.userId', 'name profileImage')
        .limit(limit);

      return conversations;
    } catch (error) {
      console.error('Error getting user AI conversations:', error);
      return [];
    }
  }

  /**
   * Update AI online status
   */
  static async setAIOnline(userId, socketId) {
    try {
      const ai = await AIAssistant.findByUserId(userId);
      if (ai) {
        await ai.setOnline(socketId);
        console.log(`🟢 AI ${ai.aiName} is now online (${userId})`);
      }
    } catch (error) {
      console.error('Error setting AI online:', error);
    }
  }

  /**
   * Update AI offline status
   */
  static async setAIOffline(userId) {
    try {
      const ai = await AIAssistant.findByUserId(userId);
      if (ai) {
        await ai.setOffline();
        console.log(`🔴 AI ${ai.aiName} is now offline (${userId})`);
      }
    } catch (error) {
      console.error('Error setting AI offline:', error);
    }
  }
}

module.exports = AIMessageService;
