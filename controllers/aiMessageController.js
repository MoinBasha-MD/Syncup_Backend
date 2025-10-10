const AIAssistant = require('../models/aiAssistantModel');
const AIConversation = require('../models/aiConversationModel');
const User = require('../models/userModel');
const StatusService = require('../services/statusService');
const { broadcastToUser } = require('../socketManager');
const aiConversationProcessor = require('../services/aiConversationProcessor');

/**
 * AI-to-AI Message Controller
 * Handles communication between AI assistants
 */

// Send AI-to-AI message
const sendAIMessage = async (req, res) => {
  try {
    const { fromUserId, toUserId, messageType, content, context } = req.body;

    // Get sender and receiver AIs, auto-initialize if needed
    let senderAI = await AIAssistant.findByUserId(fromUserId);
    let receiverAI = await AIAssistant.findByUserId(toUserId);

    const AIInitializationService = require('../services/aiInitializationService');

    // Auto-initialize sender AI if it doesn't exist
    if (!senderAI) {
      console.log(`🤖 Sender AI not found for user ${fromUserId}, initializing...`);
      senderAI = await AIInitializationService.initializeUserAI(fromUserId);
      console.log(`✅ Sender AI initialized: ${senderAI.aiName}`);
    }

    // Auto-initialize receiver AI if it doesn't exist
    if (!receiverAI) {
      console.log(`🤖 Receiver AI not found for user ${toUserId}, initializing...`);
      receiverAI = await AIInitializationService.initializeUserAI(toUserId);
      console.log(`✅ Receiver AI initialized: ${receiverAI.aiName}`);
    }

    // AI instances should always be available for autonomous communication
    // Even if user is offline, AI can respond autonomously
    console.log(`🤖 AI-to-AI communication: ${senderAI.aiName} → ${receiverAI.aiName}`);
    console.log(`📱 User online status: Sender=${fromUserId}, Receiver=${toUserId} (not required for AI communication)`);

    // Create or find existing conversation
    let conversation = await AIConversation.findOne({
      $or: [
        {
          'participants.initiatorAI.aiId': senderAI.aiId,
          'participants.responderAI.aiId': receiverAI.aiId
        },
        {
          'participants.initiatorAI.aiId': receiverAI.aiId,
          'participants.responderAI.aiId': senderAI.aiId
        }
      ],
      status: 'active'
    });

    if (!conversation) {
      // Create new conversation
      conversation = new AIConversation({
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
        topic: context?.topic || 'general',
        context: context || {}
      });
      await conversation.save();
    }

    // Add message to conversation
    await conversation.addMessage(
      senderAI.aiId,
      receiverAI.aiId,
      messageType,
      content
    );

    // Broadcast message to receiver via WebSocket
    const aiMessage = {
      type: 'ai_message',
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
      timestamp: new Date()
    };

    // CRITICAL FIX: Convert userId to MongoDB _id for WebSocket broadcasting
    const receiverUser = await User.findOne({ userId: toUserId }).select('_id userId name');
    if (!receiverUser) {
      console.error(`❌ Receiver user not found for userId: ${toUserId}`);
      return res.status(404).json({
        success: false,
        message: 'Receiver user not found'
      });
    }

    const receiverObjectId = receiverUser._id.toString();
    console.log(`🔄 Converting userId ${toUserId} to ObjectId ${receiverObjectId} for WebSocket broadcasting`);

    // Try to send to receiver's WebSocket (if user is online)
    const broadcastSuccess = broadcastToUser(receiverObjectId, 'ai_message_received', aiMessage);
    console.log(`📡 WebSocket broadcast result: ${broadcastSuccess ? 'SUCCESS' : 'FAILED'}`);

    if (!broadcastSuccess) {
      console.log(`📴 User ${receiverUser.name} is offline - AI will respond autonomously`);
      
      // Generate autonomous AI response since user is offline
      try {
        const autonomousResponse = await generateAutonomousAIResponse(receiverAI, aiMessage);
        
        if (autonomousResponse) {
          // Add autonomous response to conversation
          await conversation.addMessage(
            receiverAI.aiId,
            senderAI.aiId,
            'response',
            autonomousResponse
          );

          // Send response back to sender
          const responseMessage = {
            type: 'ai_autonomous_response',
            conversationId: conversation.conversationId,
            fromAI: {
              aiId: receiverAI.aiId,
              name: receiverAI.aiName,
              userId: toUserId
            },
            toAI: {
              aiId: senderAI.aiId,
              name: senderAI.aiName,
              userId: fromUserId
            },
            messageType: 'response',
            content: autonomousResponse,
            timestamp: new Date()
          };

          // Send response back to sender
          const senderUser = await User.findOne({ userId: fromUserId }).select('_id');
          if (senderUser) {
            const senderObjectId = senderUser._id.toString();
            broadcastToUser(senderObjectId, 'ai_response_received', responseMessage);
            console.log(`🤖 Autonomous response sent: ${receiverAI.aiName} → ${senderAI.aiName}`);
          }
        }
      } catch (error) {
        console.error('❌ Error generating autonomous response:', error);
      }
    }

    console.log(`🤖 AI Message sent: ${senderAI.aiName} → ${receiverAI.aiName}`);

    res.json({
      success: true,
      data: {
        conversationId: conversation.conversationId,
        messageId: conversation.messages[conversation.messages.length - 1].messageId
      }
    });

  } catch (error) {
    console.error('Error sending AI message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send AI message',
      error: error.message
    });
  }
};

// Process incoming AI message and generate response
const processAIMessage = async (req, res) => {
  try {
    const { conversationId, messageId } = req.body;
    const userId = req.user.userId; // Use userId string instead of MongoDB _id

    // Get conversation and user's AI
    const conversation = await AIConversation.findOne({ conversationId });
    let userAI = await AIAssistant.findByUserId(userId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Auto-initialize AI if it doesn't exist
    if (!userAI) {
      console.log(`🤖 AI assistant not found for user ${userId}, initializing...`);
      
      const AIInitializationService = require('../services/aiInitializationService');
      userAI = await AIInitializationService.initializeUserAI(userId);
      
      console.log(`✅ AI assistant initialized for user ${userId}: ${userAI.aiName}`);
    }

    // Find the message to process
    const message = conversation.messages.find(msg => msg.messageId === messageId);
    if (!message || message.processed) {
      return res.status(400).json({
        success: false,
        message: 'Message not found or already processed'
      });
    }

    // Generate AI response based on message type and content
    let response;
    switch (message.messageType) {
      case 'request':
        response = await generateAvailabilityResponse(userId, userAI, message.content);
        break;
      case 'info':
        response = await generateInfoResponse(userId, userAI, message.content);
        break;
      default:
        response = {
          text: 'Message received and acknowledged.',
          sharedData: {}
        };
    }

    // Add response to conversation
    await conversation.addMessage(
      userAI.aiId,
      message.fromAI,
      'response',
      response
    );

    // Mark original message as processed
    message.processed = true;
    await conversation.save();

    // Send response back via WebSocket
    const senderUserId = conversation.participants.initiatorAI.userId.toString() === userId 
      ? conversation.participants.responderAI.userId 
      : conversation.participants.initiatorAI.userId;

    const responseMessage = {
      type: 'ai_response',
      conversationId: conversation.conversationId,
      fromAI: {
        aiId: userAI.aiId,
        name: userAI.aiName,
        userId: userId
      },
      messageType: 'response',
      content: response,
      timestamp: new Date()
    };

    // CRITICAL FIX: Convert userId to MongoDB _id for WebSocket broadcasting
    const senderUser = await User.findOne({ userId: senderUserId }).select('_id userId name');
    if (!senderUser) {
      console.error(`❌ Sender user not found for userId: ${senderUserId}`);
    } else {
      const senderObjectId = senderUser._id.toString();
      console.log(`🔄 Converting sender userId ${senderUserId} to ObjectId ${senderObjectId} for response broadcasting`);
      
      const broadcastSuccess = broadcastToUser(senderObjectId, 'ai_response_received', responseMessage);
      console.log(`📡 AI Response broadcast result: ${broadcastSuccess ? 'SUCCESS' : 'FAILED'}`);
    }

    console.log(`🤖 AI Response sent: ${userAI.aiName} responded to request`);

    res.json({
      success: true,
      data: {
        response: response.text,
        sharedData: response.sharedData
      }
    });

  } catch (error) {
    console.error('Error processing AI message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process AI message',
      error: error.message
    });
  }
};

// Generate availability response
const generateAvailabilityResponse = async (userId, userAI, requestContent) => {
  try {
    // Check user's current status
    const user = await User.findById(userId);
    const currentStatus = user.status || 'Available';
    
    // Check privacy settings
    const canShareStatus = userAI.canShare('shareStatus');
    const canShareCalendar = userAI.canShare('shareCalendarAvailability');
    const canShareLocation = userAI.canShare('shareGeneralLocation');

    let response = {
      text: '',
      sharedData: {}
    };

    if (!canShareStatus) {
      response.text = "I'm not able to share availability information at this time.";
      return response;
    }

    // Basic availability check
    const isAvailable = currentStatus === 'Available';
    response.sharedData.availability = isAvailable;
    response.sharedData.status = currentStatus;

    if (isAvailable) {
      response.text = `Great news! ${user.name || 'User'} is currently available.`;
      
      // Add calendar info if allowed
      if (canShareCalendar) {
        // TODO: Integrate with calendar service
        response.text += " They're free for the next 2 hours.";
        response.sharedData.timeSlots = ['next 2 hours'];
      }
      
      // Add location info if allowed
      if (canShareLocation) {
        // TODO: Get user location
        response.text += " They're currently in the downtown area.";
        response.sharedData.location = 'downtown area';
      }
    } else {
      response.text = `${user.name || 'User'} is currently ${currentStatus.toLowerCase()}.`;
      
      if (canShareCalendar) {
        response.text += " They might be available later today.";
      }
    }

    return response;

  } catch (error) {
    console.error('Error generating availability response:', error);
    return {
      text: "I'm having trouble checking availability right now.",
      sharedData: {}
    };
  }
};

// Generate info response
const generateInfoResponse = async (userId, userAI, requestContent) => {
  try {
    const user = await User.findById(userId);
    
    return {
      text: `Thank you for the information. ${userAI.aiName} has received your message.`,
      sharedData: {
        acknowledged: true,
        timestamp: new Date()
      }
    };
  } catch (error) {
    console.error('Error generating info response:', error);
    return {
      text: "Message received.",
      sharedData: {}
    };
  }
};

// Get AI conversations for a user
const getAIConversations = async (req, res) => {
  try {
    const userId = req.user.userId; // Use userId string instead of MongoDB _id
    let userAI = await AIAssistant.findByUserId(userId);

    // Auto-initialize AI if it doesn't exist
    if (!userAI) {
      console.log(`🤖 AI assistant not found for user ${userId}, initializing...`);
      
      const AIInitializationService = require('../services/aiInitializationService');
      userAI = await AIInitializationService.initializeUserAI(userId);
      
      console.log(`✅ AI assistant initialized for user ${userId}: ${userAI.aiName}`);
    }

    const conversations = await AIConversation.findByAI(userAI.aiId)
      .populate('participants.initiatorAI.userId', 'name profileImage')
      .populate('participants.responderAI.userId', 'name profileImage')
      .limit(50);

    res.json({
      success: true,
      data: conversations
    });

  } catch (error) {
    console.error('Error getting AI conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get AI conversations',
      error: error.message
    });
  }
};

// Get AI privacy settings
const getAIPrivacySettings = async (req, res) => {
  try {
    const userId = req.user.userId; // Use userId string instead of MongoDB _id

    let userAI = await AIAssistant.findByUserId(userId);
    
    // Auto-initialize AI if it doesn't exist
    if (!userAI) {
      console.log(`🤖 AI assistant not found for user ${userId}, initializing...`);
      
      const AIInitializationService = require('../services/aiInitializationService');
      userAI = await AIInitializationService.initializeUserAI(userId);
      
      console.log(`✅ AI assistant initialized for user ${userId}: ${userAI.aiName}`);
    }

    console.log(`🔒 AI Privacy settings retrieved for user ${userId}`);

    res.json({
      success: true,
      data: userAI.privacySettings || {}
    });

  } catch (error) {
    console.error('Error getting AI privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get privacy settings',
      error: error.message
    });
  }
};

// Update AI privacy settings
const updateAIPrivacySettings = async (req, res) => {
  try {
    const userId = req.user.userId; // Use userId string instead of MongoDB _id
    const { privacySettings } = req.body;

    let userAI = await AIAssistant.findByUserId(userId);
    
    // Auto-initialize AI if it doesn't exist
    if (!userAI) {
      console.log(`🤖 AI assistant not found for user ${userId}, initializing...`);
      
      const AIInitializationService = require('../services/aiInitializationService');
      userAI = await AIInitializationService.initializeUserAI(userId);
      
      console.log(`✅ AI assistant initialized for user ${userId}: ${userAI.aiName}`);
    }

    // Update privacy settings
    userAI.privacySettings = { ...userAI.privacySettings, ...privacySettings };
    await userAI.save();

    console.log(`🔒 AI Privacy settings updated for user ${userId}`);

    res.json({
      success: true,
      data: userAI.privacySettings
    });

  } catch (error) {
    console.error('Error updating AI privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update privacy settings',
      error: error.message
    });
  }
};

// Generate autonomous AI response when user is offline
const generateAutonomousAIResponse = async (receiverAI, incomingMessage) => {
  try {
    console.log(`🤖 Generating autonomous response from ${receiverAI.aiName}`);
    
    const { messageType, content, context } = incomingMessage;
    
    // Basic autonomous responses based on message type
    switch (messageType) {
      case 'request':
        // Handle availability requests autonomously
        if (context?.activity) {
          const activity = context.activity;
          return {
            text: `Hi! I'm ${receiverAI.aiName}, the AI assistant. My user is currently offline, but I can help! For ${activity}, they're usually available in the afternoons. I'll let them know about your request and they'll get back to you when they're online.`,
            sharedData: {
              autonomous: true,
              suggestedTimes: ['afternoon', 'evening'],
              userOffline: true,
              willNotifyUser: true
            }
          };
        }
        break;
        
      case 'info':
        return {
          text: `Thank you for the message! I'm ${receiverAI.aiName}, responding on behalf of my user who is currently offline. I'll make sure they see this when they return.`,
          sharedData: {
            autonomous: true,
            userOffline: true,
            messageReceived: true
          }
        };
        
      default:
        return {
          text: `Hello! I'm ${receiverAI.aiName}. My user is offline right now, but I'll let them know you reached out. They'll respond when they're back online.`,
          sharedData: {
            autonomous: true,
            userOffline: true
          }
        };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error generating autonomous AI response:', error);
    return null;
  }
};

// Process complete AI-to-AI conversation
const processCompleteAIConversation = async (req, res) => {
  try {
    const { fromUserId, toUserId, activity, timeframe, urgency } = req.body;

    console.log(`🎭 Processing complete AI conversation: ${fromUserId} → ${toUserId} for ${activity}`);

    // Use the AI conversation processor
    const result = await aiConversationProcessor.processAIConversation(
      fromUserId,
      toUserId,
      activity,
      { timeframe, urgency }
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'AI conversation completed successfully',
        data: {
          conversationId: result.conversationId,
          summary: result.result.finalResult.summary,
          steps: result.result.conversationSteps.length
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'AI conversation failed',
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Error processing complete AI conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process AI conversation',
      error: error.message
    });
  }
};

module.exports = {
  sendAIMessage,
  processAIMessage,
  processCompleteAIConversation,
  getAIConversations,
  getAIPrivacySettings,
  updateAIPrivacySettings
};
