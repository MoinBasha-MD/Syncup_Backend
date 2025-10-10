const AIAssistant = require('../models/aiAssistantModel');
const AIConversation = require('../models/aiConversationModel');
const User = require('../models/userModel');
const { broadcastToUser } = require('../socketManager');

/**
 * AI Conversation Processor
 * Handles complete AI-to-AI conversations on server side
 */
class AIConversationProcessor {
  
  /**
   * Process complete AI-to-AI conversation
   * @param {string} fromUserId - Initiator user ID
   * @param {string} toUserId - Target user ID  
   * @param {string} activity - Type of activity (coffee, lunch, meeting)
   * @param {Object} context - Additional context
   */
  async processAIConversation(fromUserId, toUserId, activity, context = {}) {
    try {
      console.log(`🤖 Starting AI conversation: ${fromUserId} → ${toUserId} for ${activity}`);
      
      // Get both AIs
      const [mayaA, mayaB] = await Promise.all([
        this.getOrCreateAI(fromUserId),
        this.getOrCreateAI(toUserId)
      ]);

      // Get user details for context
      const [userA, userB] = await Promise.all([
        User.findOne({ userId: fromUserId }),
        User.findOne({ userId: toUserId })
      ]);

      // Create conversation record
      const conversation = new AIConversation({
        participants: {
          initiatorAI: {
            aiId: mayaA.aiId,
            userId: fromUserId,
            aiName: mayaA.aiName
          },
          responderAI: {
            aiId: mayaB.aiId,
            userId: toUserId,
            aiName: mayaB.aiName
          }
        },
        topic: 'availability_check',
        context: {
          originalRequest: `${userA.name} wants to meet for ${activity}`,
          activity,
          timeframe: context.timeframe || 'soon',
          urgency: context.urgency || 'medium'
        }
      });

      await conversation.save();

      // Start AI conversation simulation
      const conversationResult = await this.simulateAIConversation(
        mayaA, mayaB, userA, userB, activity, conversation
      );

      // Send results to both users
      await this.broadcastConversationResult(
        fromUserId, toUserId, conversationResult, userA, userB
      );

      return {
        success: true,
        conversationId: conversation.conversationId,
        result: conversationResult
      };

    } catch (error) {
      console.error('❌ Error processing AI conversation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Simulate complete AI-to-AI conversation
   */
  async simulateAIConversation(mayaA, mayaB, userA, userB, activity, conversation) {
    console.log(`🎭 Simulating AI conversation between ${mayaA.aiName} and ${mayaB.aiName}`);

    // Step 1: Maya A initiates
    const step1 = {
      speaker: mayaA.aiName,
      message: `Hi ${mayaB.aiName}! I'm reaching out on behalf of ${userA.name}. They'd like to meet ${userB.name} for ${activity}. Is ${userB.name} available?`,
      timestamp: new Date()
    };

    // Step 2: Maya B checks availability and responds
    const userBStatus = await this.checkUserAvailability(userB);
    const step2 = {
      speaker: mayaB.aiName,
      message: this.generateAvailabilityResponse(userB, userBStatus, activity),
      timestamp: new Date()
    };

    // Step 3: Maya A suggests time/details
    const step3 = {
      speaker: mayaA.aiName,
      message: this.generateTimeProposal(activity, userBStatus),
      timestamp: new Date()
    };

    // Step 4: Maya B confirms or negotiates
    const step4 = {
      speaker: mayaB.aiName,
      message: this.generateFinalResponse(activity, userBStatus),
      timestamp: new Date()
    };

    const conversationSteps = [step1, step2, step3, step4];

    // Save conversation steps to database
    for (const step of conversationSteps) {
      await conversation.addMessage(
        step.speaker === mayaA.aiName ? mayaA.aiId : mayaB.aiId,
        step.speaker === mayaA.aiName ? mayaB.aiId : mayaA.aiId,
        'response',
        { text: step.message, timestamp: step.timestamp }
      );
    }

    // Generate final result
    const finalResult = this.generateFinalResult(conversationSteps, userA, userB, activity, userBStatus);
    
    await conversation.markCompleted(finalResult);

    return {
      conversationSteps,
      finalResult,
      participants: {
        initiator: { name: userA.name, ai: mayaA.aiName },
        responder: { name: userB.name, ai: mayaB.aiName }
      }
    };
  }

  /**
   * Check user availability (mock for now)
   */
  async checkUserAvailability(user) {
    // In real implementation, this would check:
    // - User's current status
    // - Calendar integration
    // - Time preferences
    // - Location
    
    const now = new Date();
    const hour = now.getHours();
    
    return {
      isOnline: Math.random() > 0.5, // 50% chance user is online
      currentStatus: user.status || 'Available',
      preferredTimes: hour < 12 ? ['afternoon', 'evening'] : ['evening', 'tomorrow morning'],
      canMeetToday: hour < 16, // Can meet if before 4 PM
      suggestedDuration: 30 + Math.floor(Math.random() * 60) // 30-90 minutes
    };
  }

  /**
   * Generate availability response from Maya B
   */
  generateAvailabilityResponse(user, status, activity) {
    if (!status.isOnline) {
      return `Hi! I'm ${user.name}'s Maya. They're currently offline, but I can help! For ${activity}, they're usually available ${status.preferredTimes.join(' or ')}. ${status.canMeetToday ? "They could potentially meet today." : "Tomorrow would work better."}`;
    } else if (status.currentStatus === 'Available') {
      return `Great timing! ${user.name} is currently available. For ${activity}, they're free ${status.preferredTimes.join(' or ')}. How long were you thinking?`;
    } else {
      return `${user.name} is currently ${status.currentStatus.toLowerCase()}, but I can check their schedule. They're usually available ${status.preferredTimes.join(' or ')} for ${activity}.`;
    }
  }

  /**
   * Generate time proposal from Maya A
   */
  generateTimeProposal(activity, status) {
    const duration = status.suggestedDuration;
    const timeSlot = status.preferredTimes[0];
    
    return `Perfect! How about ${duration} minutes for ${activity} ${timeSlot}? I can have them send a calendar invite once we confirm the details.`;
  }

  /**
   * Generate final response from Maya B
   */
  generateFinalResponse(activity, status) {
    if (status.canMeetToday) {
      return `That works perfectly! I'll let ${status.isOnline ? 'them know right away' : 'them know when they come online'}. Looking forward to the ${activity}! 🎉`;
    } else {
      return `That timeframe looks good! I'll check with them and get back to you with confirmation. Thanks for reaching out! ☕`;
    }
  }

  /**
   * Generate final conversation result
   */
  generateFinalResult(steps, userA, userB, activity, status) {
    return {
      success: status.canMeetToday,
      summary: `${userA.name} and ${userB.name} ${status.canMeetToday ? 'have arranged' : 'are discussing'} ${activity}`,
      agreedTime: status.canMeetToday ? status.preferredTimes[0] : 'TBD',
      agreedDuration: `${status.suggestedDuration} minutes`,
      nextSteps: status.canMeetToday ? 
        ['Calendar invite to be sent', 'Location to be confirmed'] :
        ['Waiting for confirmation', 'Will follow up when user is online'],
      conversationSummary: `Maya AIs successfully negotiated ${activity} meeting details`,
      participantStatus: {
        [userA.name]: 'Initiated request',
        [userB.name]: status.isOnline ? 'Available and confirmed' : 'Offline - Maya responded autonomously'
      }
    };
  }

  /**
   * Broadcast conversation result to both users
   */
  async broadcastConversationResult(fromUserId, toUserId, result, userA, userB) {
    console.log(`📡 Broadcasting AI conversation result to both users`);

    // Message for initiator (User A)
    const messageForA = {
      type: 'ai_conversation_complete',
      title: `🤖 Maya Conversation Complete`,
      summary: `Your Maya had a conversation with ${userB.name}'s Maya about ${result.finalResult.summary}`,
      result: result.finalResult,
      conversationSteps: result.conversationSteps,
      timestamp: new Date()
    };

    // Message for responder (User B)  
    const messageForB = {
      type: 'ai_conversation_complete',
      title: `🤖 Maya Handled a Request`,
      summary: `Your Maya spoke with ${userA.name}'s Maya and ${result.finalResult.success ? 'arranged' : 'discussed'} a meeting`,
      result: result.finalResult,
      conversationSteps: result.conversationSteps,
      timestamp: new Date()
    };

    // Send to both users
    try {
      const [userADoc, userBDoc] = await Promise.all([
        User.findOne({ userId: fromUserId }),
        User.findOne({ userId: toUserId })
      ]);

      if (userADoc) {
        broadcastToUser(userADoc._id.toString(), 'ai_conversation_complete', messageForA);
      }
      
      if (userBDoc) {
        broadcastToUser(userBDoc._id.toString(), 'ai_conversation_complete', messageForB);
      }

      console.log(`✅ AI conversation results sent to both users`);
    } catch (error) {
      console.error('❌ Error broadcasting conversation result:', error);
    }
  }

  /**
   * Get or create AI for user
   */
  async getOrCreateAI(userId) {
    let ai = await AIAssistant.findByUserId(userId);
    
    if (!ai) {
      const AIInitializationService = require('./aiInitializationService');
      ai = await AIInitializationService.initializeUserAI(userId);
    }
    
    return ai;
  }
}

module.exports = new AIConversationProcessor();
