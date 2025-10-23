const Message = require('../models/Message');
const User = require('../models/userModel');
const Block = require('../models/blockModel');
const { broadcastToUser } = require('../socketManager');
const enhancedNotificationService = require('../services/enhancedNotificationService');

// Send a message
const sendMessage = async (req, res) => {
  try {
    // Log raw request body first
    console.log('📥 [BACKEND] Raw req.body:', JSON.stringify(req.body, null, 2));
    console.log('📥 [BACKEND] req.body.sharedPost:', req.body.sharedPost);
    console.log('📥 [BACKEND] req.body.sharedPost type:', typeof req.body.sharedPost);
    
    const { 
      receiverId, 
      message, 
      messageType = 'text',
      voiceMetadata,
      encryptionData,
      encrypted = false,
      sharedPost,      // ✅ For shared posts
      imageUrl,        // ✅ For images
      fileMetadata     // ✅ For files
    } = req.body;
    const senderId = req.user.userId;
    const senderObjectId = req.user.id; // MongoDB _id of sender
    
    console.log('📥 [BACKEND] After destructuring - sharedPost:', sharedPost);
    console.log('📥 [BACKEND] After destructuring - sharedPost type:', typeof sharedPost);

    console.log('💬 Chat Controller - Send Message:', {
      senderId,
      senderObjectId,
      receiverId,
      messageType,
      messageLength: message?.length,
      hasSharedPost: !!sharedPost,
      hasImageUrl: !!imageUrl,
      hasFileMetadata: !!fileMetadata
    });
    
    // Debug and fix sharedPost data
    if (sharedPost) {
      console.log('📤 [BACKEND] Received sharedPost:', JSON.stringify(sharedPost, null, 2));
      console.log('📤 [BACKEND] sharedPost.postMedia type:', typeof sharedPost.postMedia);
      console.log('📤 [BACKEND] sharedPost.postMedia is array?', Array.isArray(sharedPost.postMedia));
      console.log('📤 [BACKEND] sharedPost.postMedia value:', sharedPost.postMedia);
      
      // Fix: If postMedia is a string, try to parse it
      if (sharedPost.postMedia && typeof sharedPost.postMedia === 'string') {
        try {
          console.log('⚠️ [BACKEND] postMedia is a string, attempting to parse...');
          sharedPost.postMedia = JSON.parse(sharedPost.postMedia);
          console.log('✅ [BACKEND] Successfully parsed postMedia:', sharedPost.postMedia);
        } catch (parseError) {
          console.error('❌ [BACKEND] Failed to parse postMedia string:', parseError);
          // If parsing fails, set to empty array
          sharedPost.postMedia = [];
        }
      }
      
      // Ensure postMedia is an array
      if (!Array.isArray(sharedPost.postMedia)) {
        console.warn('⚠️ [BACKEND] postMedia is not an array, converting to empty array');
        sharedPost.postMedia = [];
      }
    }

    // Validate input
    if (!receiverId || !message) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID and message are required'
      });
    }

    // Check if users have blocked each other
    const blockStatus = await Block.isMutuallyBlocked(senderId, receiverId);
    if (blockStatus.anyBlocked) {
      console.log(`🚫 Message blocked: ${senderId} -> ${receiverId} (users have blocked each other)`);
      return res.status(403).json({
        success: false,
        message: 'Cannot send message to this user'
      });
    }

    // Find receiver and get both userId and _id
    console.log('🔍 Looking up receiver in database with userId:', receiverId);
    
    // First, let's see all users with similar names for debugging
    const allUsers = await User.find({}).select('_id userId name phoneNumber').lean();
    console.log('📊 All users in database:', allUsers.map(u => ({
      mongoId: u._id.toString(),
      userId: u.userId,
      name: u.name,
      phone: u.phoneNumber
    })));
    
    const receiver = await User.findOne({ userId: receiverId }).select('_id userId name phoneNumber');
    if (!receiver) {
      console.log('❌ Receiver not found in database:', receiverId);
      console.log('🔍 Available userIds in database:', allUsers.map(u => u.userId));
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    const receiverObjectId = receiver._id.toString();
    console.log('🎯 Receiver details:', {
      receiverId: receiver.userId,
      receiverObjectId,
      receiverName: receiver.name,
      receiverPhone: receiver.phoneNumber
    });
    
    // Also check what user is currently connected
    console.log('🔗 Currently connected users (from socket manager):');
    // This will help us see if the right user is connected

    // Create new message
    const newMessage = new Message({
      senderId,
      receiverId,
      message,
      messageType,
      timestamp: new Date(),
      status: 'sent',
      sharedPost,      // ✅ Include shared post data
      imageUrl,        // ✅ Include image URL
      fileMetadata     // ✅ Include file metadata
    });

    // Save message to database
    const savedMessage = await newMessage.save();
    console.log('✅ Message saved to database:', savedMessage._id);

    // ENHANCED: Multi-device notification broadcast
    try {
      console.log('📡 Attempting to broadcast message to receiver...');
      console.log('🔍 Broadcasting to receiverId (userId):', receiverId);
      console.log('🔍 Receiver MongoDB ObjectId:', receiverObjectId);
      
      // CRITICAL FIX: Get sender information for notifications
      const sender = await User.findOne({ userId: senderId }).select('name profileImage');
      const senderName = sender ? sender.name : 'Unknown User';
      const senderProfileImage = sender ? sender.profileImage : null;
      
      console.log('👤 Sender info for notification:', { senderId, senderName, senderProfileImage });
      
      const messageData = {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        senderName: senderName, // ✅ ADDED for notifications
        senderProfileImage: senderProfileImage, // ✅ ADDED for notifications
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        timestamp: savedMessage.timestamp,
        status: 'delivered',
        sharedPost: savedMessage.sharedPost,     // ✅ Include shared post
        imageUrl: savedMessage.imageUrl,         // ✅ Include image URL
        fileMetadata: savedMessage.fileMetadata  // ✅ Include file metadata
      };
      
      // Strategy 1: Primary WebSocket broadcast
      const broadcastSuccess = broadcastToUser(receiverId, 'message:new', messageData);
      
      // CRITICAL: Send notification via enhancedNotificationService
      try {
        console.log('🔔 [NOTIFICATION] Sending chat message notification...');
        await enhancedNotificationService.sendChatMessageNotification(
          senderId,
          receiverId,
          savedMessage
        );
        console.log('✅ [NOTIFICATION] Notification sent successfully');
      } catch (notifError) {
        console.error('❌ [NOTIFICATION] Error sending notification:', notifError);
        // Don't fail the message send if notification fails
      }
      
      if (broadcastSuccess) {
        console.log('✅ Message successfully broadcasted via primary WebSocket');
        savedMessage.status = 'delivered';
        await savedMessage.save();
      } else {
        console.log('⚠️ Primary WebSocket failed, trying multi-device broadcast...');
        
        // Strategy 2: Multi-device notification broadcast
        const receiverWithDevices = await User.findOne({ userId: receiverId }).select('deviceTokens');
        if (receiverWithDevices && receiverWithDevices.deviceTokens && receiverWithDevices.deviceTokens.length > 0) {
          console.log(`📱 [MESSAGE] Broadcasting to ${receiverWithDevices.deviceTokens.length} registered device(s)`);
          
          const io = req.app.get('io'); // Get Socket.IO instance
          let deviceNotified = false;
          
          receiverWithDevices.deviceTokens.forEach((device, index) => {
            if (device.isActive) {
              console.log(`📱 [MESSAGE] Notifying device ${index + 1}:`, {
                platform: device.platform,
                tokenPreview: device.token.substring(0, 20) + '...',
                lastActive: device.lastActive
              });
              
              // Emit to device-specific channel
              io.emit(`message:new:${device.token}`, messageData);
              deviceNotified = true;
            }
          });
          
          if (deviceNotified) {
            console.log('✅ [MESSAGE] Notification sent to active devices');
            savedMessage.status = 'delivered';
            await savedMessage.save();
          } else {
            console.log('⚠️ [MESSAGE] No active devices found');
          }
        } else {
          console.log('⚠️ [MESSAGE] Receiver has no registered devices');
        }
      }
    } catch (socketError) {
      console.error('❌ Error broadcasting message:', socketError);
      // Message is still saved, just not delivered in real-time
    }

    res.status(201).json({
      success: true,
      data: savedMessage,
      message: 'Message sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Get chat history with pagination and optimized loading
const getChatHistory = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;
    const userObjectId = req.user.id; // MongoDB _id of current user
    const { page = 1, limit = 50, optimized = 'true' } = req.query;

    console.log('📜 Chat Controller - Get Chat History:', {
      userId,
      userObjectId,
      contactId,
      page,
      limit,
      optimized
    });

    // Validate input
    if (!contactId) {
      return res.status(400).json({
        success: false,
        message: 'Contact ID is required'
      });
    }

    // Verify contact exists
    const contact = await User.findOne({ userId: contactId }).select('_id userId name');
    if (!contact) {
      console.log('❌ Contact not found in database:', contactId);
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    console.log('🎯 Contact details for chat history:', {
      contactId: contact.userId,
      contactObjectId: contact._id.toString(),
      contactName: contact.name
    });

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let messages;
    if (optimized === 'true') {
      // Use optimized loading with threading support
      console.log('🚀 Using optimized message loading with threading support');
      messages = await Message.getConversationOptimized(userId, contactId, skip, parseInt(limit));
    } else {
      // Use traditional loading
      console.log('📜 Using traditional message loading');
      messages = await Message.find({
        $or: [
          { senderId: userId, receiverId: contactId },
          { senderId: contactId, receiverId: userId }
        ]
      })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    }

    // Reverse to get chronological order (oldest first)
    const chronologicalMessages = messages.reverse();

    console.log(`✅ Retrieved ${chronologicalMessages.length} messages from chat history (optimized: ${optimized})`);

    res.status(200).json({
      success: true,
      data: chronologicalMessages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: chronologicalMessages.length
      },
      optimized: optimized === 'true'
    });

  } catch (error) {
    console.error('❌ Error getting chat history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat history',
      error: error.message
    });
  }
};

// Mark messages as read
const markMessagesAsRead = async (req, res) => {
  try {
    const { contactId, messageIds } = req.body;
    const userId = req.user.userId;
    const userObjectId = req.user.id; // MongoDB _id of current user

    console.log('👁️ Chat Controller - Mark Messages as Read:', {
      userId,
      userObjectId,
      contactId,
      messageCount: messageIds?.length
    });

    // Validate input
    if (!contactId || !messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        success: false,
        message: 'Contact ID and message IDs array are required'
      });
    }

    // Find contact and get both userId and _id
    const contact = await User.findOne({ userId: contactId }).select('_id userId name');
    if (!contact) {
      console.log('❌ Contact not found in database:', contactId);
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    const contactObjectId = contact._id.toString();
    console.log('🎯 Contact details for read receipt:', {
      contactId: contact.userId,
      contactObjectId,
      contactName: contact.name
    });

    // Mark messages as read in database
    const updateResult = await Message.updateMany(
      {
        _id: { $in: messageIds },
        receiverId: userId,
        senderId: contactId
      },
      {
        $set: { status: 'read' }
      }
    );

    console.log(`✅ Marked ${updateResult.modifiedCount} messages as read`);

    // Broadcast read status to sender via WebSocket using userId (NOT MongoDB _id)
    try {
      console.log('📡 Broadcasting read receipts to contact...');
      console.log('🔍 Broadcasting to contactId (userId):', contactId);
      console.log('🔍 Contact MongoDB ObjectId:', contactObjectId);
      
      messageIds.forEach(messageId => {
        const broadcastSuccess = broadcastToUser(contactId, 'message:read', { messageId });
        if (broadcastSuccess) {
          console.log(`✅ Read receipt broadcasted for message ${messageId}`);
        } else {
          console.log(`⚠️ Read receipt not delivered for message ${messageId} (contact offline)`);
        }
      });
      
      console.log('📡 Read status broadcasting completed');
    } catch (socketError) {
      console.error('❌ Error broadcasting read status:', socketError);
    }

    res.status(200).json({
      success: true,
      data: {
        markedCount: updateResult.modifiedCount
      },
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: error.message
    });
  }
};

// Get unread message count for a specific contact
const getUnreadCount = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;
    const userObjectId = req.user.id; // MongoDB _id of current user

    console.log('🔢 Chat Controller - Get Unread Count:', {
      userId,
      userObjectId,
      contactId
    });

    // Verify contact exists
    const contact = await User.findOne({ userId: contactId }).select('_id userId name');
    if (!contact) {
      console.log('❌ Contact not found in database:', contactId);
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    console.log('🎯 Contact details for unread count:', {
      contactId: contact.userId,
      contactObjectId: contact._id.toString(),
      contactName: contact.name
    });

    // Count unread messages from the contact using userId (stored in message documents)
    const unreadCount = await Message.countDocuments({
      senderId: contactId,
      receiverId: userId,
      status: { $ne: 'read' }
    });

    console.log(`✅ Unread count for ${contactId}: ${unreadCount}`);

    res.status(200).json({
      success: true,
      data: {
        contactId,
        unreadCount
      }
    });

  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error.message
    });
  }
};

// Get all unread message counts
const getAllUnreadCounts = async (req, res) => {
  try {
    const userId = req.user.userId;

    const counts = await Message.getAllUnreadCounts(userId);

    res.status(200).json({
      success: true,
      data: counts,
      message: 'All unread counts retrieved successfully'
    });

  } catch (error) {
    console.error('Error getting all unread counts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread counts',
      error: error.message
    });
  }
};

// Delete a message
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;
    const userObjectId = req.user.id; // MongoDB _id of current user

    console.log('🗑️ Chat Controller - Delete Message:', {
      userId,
      userObjectId,
      messageId
    });

    // Find and delete the message (only if user is the sender)
    const deletedMessage = await Message.findOneAndDelete({
      _id: messageId,
      senderId: userId
    });

    if (!deletedMessage) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or you are not authorized to delete it'
      });
    }

    console.log('✅ Message deleted successfully');

    // Find receiver and get MongoDB _id for broadcasting
    try {
      const receiver = await User.findOne({ userId: deletedMessage.receiverId }).select('_id userId name');
      if (receiver) {
        const receiverObjectId = receiver._id.toString();
        console.log('🎯 Receiver details for deletion broadcast:', {
          receiverId: receiver.userId,
          receiverObjectId,
          receiverName: receiver.name
        });
        
        console.log('📡 Broadcasting message deletion to receiver...');
        console.log('🔍 Broadcasting to receiverId (userId):', receiver.userId);
        console.log('🔍 Receiver MongoDB ObjectId:', receiverObjectId);
        
        const broadcastSuccess = broadcastToUser(receiver.userId, 'message:deleted', { messageId });
        if (broadcastSuccess) {
          console.log('✅ Message deletion successfully broadcasted via WebSocket');
        } else {
          console.log('⚠️ Message deletion not delivered via WebSocket (receiver offline)');
        }
      } else {
        console.log('❌ Receiver not found for deletion broadcast:', deletedMessage.receiverId);
      }
    } catch (socketError) {
      console.error('❌ Error broadcasting message deletion:', socketError);
    }

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: error.message
    });
  }
};

// Toggle message reaction
const toggleReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.userId;
    const userObjectId = req.user.id;

    console.log('😀 Chat Controller - Toggle Reaction:', {
      userId,
      messageId,
      emoji
    });

    // Validate input
    if (!messageId || !emoji) {
      return res.status(400).json({
        success: false,
        message: 'Message ID and emoji are required'
      });
    }

    // Toggle the reaction
    const updatedMessage = await Message.toggleReaction(messageId, userId, emoji);

    console.log('✅ Reaction toggled successfully');

    // Broadcast reaction update to both sender and receiver
    try {
      const senderUser = await User.findOne({ userId: updatedMessage.senderId }).select('_id');
      const receiverUser = await User.findOne({ userId: updatedMessage.receiverId }).select('_id');
      
      const reactionData = {
        messageId: updatedMessage._id,
        reactions: updatedMessage.reactions,
        updatedBy: userId
      };

      if (senderUser && senderUser._id.toString() !== userObjectId) {
        broadcastToUser(senderUser._id.toString(), 'message:reaction', reactionData);
      }
      if (receiverUser && receiverUser._id.toString() !== userObjectId) {
        broadcastToUser(receiverUser._id.toString(), 'message:reaction', reactionData);
      }
    } catch (broadcastError) {
      console.error('❌ Error broadcasting reaction:', broadcastError);
    }

    res.status(200).json({
      success: true,
      data: {
        messageId: updatedMessage._id,
        reactions: updatedMessage.reactions
      },
      message: 'Reaction updated successfully'
    });

  } catch (error) {
    console.error('❌ Error toggling reaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle reaction',
      error: error.message
    });
  }
};

// Search messages
const searchMessages = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { query, limit = 20 } = req.query;
    const userId = req.user.userId;

    console.log('🔍 Chat Controller - Search Messages:', {
      userId,
      contactId,
      query,
      limit
    });

    // Validate input
    if (!contactId || !query) {
      return res.status(400).json({
        success: false,
        message: 'Contact ID and search query are required'
      });
    }

    // Verify contact exists
    const contact = await User.findOne({ userId: contactId }).select('_id userId name');
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    // Search messages
    const messages = await Message.searchMessages(userId, contactId, query, parseInt(limit));

    console.log(`✅ Found ${messages.length} messages matching search query`);

    res.status(200).json({
      success: true,
      data: messages,
      query,
      total: messages.length
    });

  } catch (error) {
    console.error('❌ Error searching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search messages',
      error: error.message
    });
  }
};

// Send reply message
const sendReply = async (req, res) => {
  try {
    const { 
      receiverId, 
      message, 
      messageType = 'text', 
      replyToId,
      sharedPost,      // ✅ For shared posts
      imageUrl,        // ✅ For images
      fileMetadata     // ✅ For files
    } = req.body;
    const senderId = req.user.userId;
    const senderObjectId = req.user.id;

    console.log('💬 Chat Controller - Send Reply:', {
      senderId,
      receiverId,
      messageType,
      replyToId,
      messageLength: message?.length,
      hasSharedPost: !!sharedPost
    });

    // Validate input
    if (!receiverId || !message || !replyToId) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID, message, and reply-to message ID are required'
      });
    }

    // Verify reply-to message exists
    const replyToMessage = await Message.findById(replyToId);
    if (!replyToMessage) {
      return res.status(404).json({
        success: false,
        message: 'Reply-to message not found'
      });
    }

    // Find receiver
    const receiver = await User.findOne({ userId: receiverId }).select('_id userId name');
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    const receiverObjectId = receiver._id.toString();

    // Create new reply message
    const newMessage = new Message({
      senderId,
      receiverId,
      message,
      messageType,
      replyTo: replyToId,
      timestamp: new Date(),
      status: 'sent',
      sharedPost,      // ✅ Include shared post data
      imageUrl,        // ✅ Include image URL
      fileMetadata     // ✅ Include file metadata
    });

    // Save message to database
    const savedMessage = await newMessage.save();
    await savedMessage.populate('replyTo', 'senderId messagePreview timestamp');

    console.log('✅ Reply message saved to database:', savedMessage._id);

    // Broadcast message to receiver using userId (NOT MongoDB _id)
    try {
      console.log('📡 Broadcasting reply message to receiver...');
      console.log('🔍 Broadcasting to receiverId (userId):', receiverId);
      console.log('🔍 Receiver MongoDB ObjectId:', receiverObjectId);
      
      // Get sender information for notifications
      const sender = await User.findOne({ userId: senderId }).select('name profileImage');
      const senderName = sender ? sender.name : 'Unknown User';
      const senderProfileImage = sender ? sender.profileImage : null;
      
      const broadcastSuccess = broadcastToUser(receiverId, 'message:new', {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        senderName: senderName, // ✅ ADDED for notifications
        senderProfileImage: senderProfileImage, // ✅ ADDED for notifications
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        replyTo: savedMessage.replyTo,
        timestamp: savedMessage.timestamp,
        status: 'delivered',
        sharedPost: savedMessage.sharedPost,     // ✅ Include shared post
        imageUrl: savedMessage.imageUrl,         // ✅ Include image URL
        fileMetadata: savedMessage.fileMetadata  // ✅ Include file metadata
      });
      
      if (broadcastSuccess) {
        savedMessage.status = 'delivered';
        await savedMessage.save();
      }
    } catch (socketError) {
      console.error('❌ Error broadcasting reply:', socketError);
    }

    res.status(201).json({
      success: true,
      data: savedMessage,
      message: 'Reply sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reply',
      error: error.message
    });
  }
};

// @desc    Test chat system connectivity and user lookup
// @route   GET /api/chat/test-connectivity
// @access  Private
const testChatConnectivity = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const currentUserObjectId = req.user.id;
    
    console.log('🧪 [CHAT TEST] Testing chat system connectivity...');
    console.log('🧪 Current user:', { userId: currentUserId, objectId: currentUserObjectId });
    
    // Test 1: Check all users in database
    const allUsers = await User.find({}).select('_id userId name phoneNumber').lean();
    console.log('🧪 [TEST 1] All users in database:', allUsers.length);
    
    // Test 2: Check WebSocket connections
    const { getUserSockets } = require('../socketManager');
    const userSockets = getUserSockets();
    const connectedUsers = Array.from(userSockets.keys());
    console.log('🧪 [TEST 2] Connected WebSocket users:', connectedUsers.length, connectedUsers);
    
    // Test 3: Check if current user is connected
    const isCurrentUserConnected = userSockets.has(currentUserId);
    console.log('🧪 [TEST 3] Current user WebSocket status:', isCurrentUserConnected);
    
    // Test 4: Find potential chat partners
    const otherUsers = allUsers.filter(user => user.userId !== currentUserId);
    console.log('🧪 [TEST 4] Potential chat partners:', otherUsers.length);
    
    // Test 5: Check recent messages
    const recentMessages = await Message.find({
      $or: [
        { senderId: currentUserId },
        { receiverId: currentUserId }
      ]
    }).sort({ timestamp: -1 }).limit(5).lean();
    
    console.log('🧪 [TEST 5] Recent messages:', recentMessages.length);
    
    res.status(200).json({
      success: true,
      data: {
        currentUser: {
          userId: currentUserId,
          objectId: currentUserObjectId,
          isConnectedToWebSocket: isCurrentUserConnected
        },
        statistics: {
          totalUsers: allUsers.length,
          connectedUsers: connectedUsers.length,
          potentialChatPartners: otherUsers.length,
          recentMessages: recentMessages.length
        },
        connectedUserIds: connectedUsers,
        potentialPartners: otherUsers.map(u => ({
          userId: u.userId,
          name: u.name,
          isConnected: connectedUsers.includes(u.userId)
        })),
        recentMessagesSample: recentMessages.map(m => ({
          id: m._id,
          from: m.senderId,
          to: m.receiverId,
          message: m.message.substring(0, 50) + (m.message.length > 50 ? '...' : ''),
          status: m.status,
          timestamp: m.timestamp
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ [CHAT TEST] Error testing chat connectivity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test chat connectivity',
      error: error.message
    });
  }
};

// @desc    Test notification flow end-to-end
// @route   POST /api/chat/test-notification
// @access  Private
const testNotificationFlow = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const currentUserObjectId = req.user.id;
    const { targetUserId } = req.body;
    
    console.log('🧪 [NOTIFICATION TEST] Testing notification flow...');
    console.log('🧪 Current user:', { userId: currentUserId, objectId: currentUserObjectId });
    console.log('🧪 Target user:', targetUserId);
    
    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'targetUserId is required for notification test'
      });
    }
    
    // Find target user
    const targetUser = await User.findOne({ userId: targetUserId }).select('_id userId name phoneNumber');
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }
    
    console.log('🧪 Target user found:', {
      userId: targetUser.userId,
      objectId: targetUser._id.toString(),
      name: targetUser.name
    });
    
    // Check WebSocket connections
    const { getUserSockets } = require('../socketManager');
    const userSockets = getUserSockets();
    const isTargetConnected = userSockets.has(targetUserId);
    const isCurrentUserConnected = userSockets.has(currentUserId);
    
    console.log('🧪 WebSocket status:', {
      currentUserConnected: isCurrentUserConnected,
      targetUserConnected: isTargetConnected,
      totalConnected: userSockets.size
    });
    
    // Create a test message
    const testMessage = new Message({
      senderId: currentUserId,
      receiverId: targetUserId,
      message: `🧪 Test notification message from ${req.user.name || 'Test User'} at ${new Date().toLocaleTimeString()}`,
      messageType: 'text',
      timestamp: new Date(),
      status: 'sent'
    });
    
    // Save test message
    const savedMessage = await testMessage.save();
    console.log('🧪 Test message saved:', savedMessage._id);
    
    // Test WebSocket broadcasting (this should trigger frontend notifications)
    let broadcastResult = false;
    try {
      console.log('🧪 Testing WebSocket broadcast to target user...');
      const { broadcastToUser } = require('../socketManager');
      
      broadcastResult = broadcastToUser(targetUserId, 'message:new', {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        timestamp: savedMessage.timestamp,
        status: 'delivered'
      });
      
      console.log('🧪 Broadcast result:', broadcastResult);
      
      if (broadcastResult) {
        // Update message status
        savedMessage.status = 'delivered';
        await savedMessage.save();
      }
    } catch (broadcastError) {
      console.error('🧪 Broadcast error:', broadcastError);
    }
    
    res.status(200).json({
      success: true,
      data: {
        testMessage: {
          id: savedMessage._id,
          senderId: savedMessage.senderId,
          receiverId: savedMessage.receiverId,
          message: savedMessage.message,
          timestamp: savedMessage.timestamp,
          status: savedMessage.status
        },
        connectivity: {
          currentUserConnected: isCurrentUserConnected,
          targetUserConnected: isTargetConnected,
          broadcastSuccessful: broadcastResult
        },
        targetUser: {
          userId: targetUser.userId,
          name: targetUser.name,
          isConnected: isTargetConnected
        }
      },
      message: `Test notification ${broadcastResult ? 'sent successfully' : 'failed to send (user offline)'}`
    });
    
  } catch (error) {
    console.error('❌ [NOTIFICATION TEST] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test notification flow',
      error: error.message
    });
  }
};

// Send voice message
const sendVoiceMessage = async (req, res) => {
  try {
    const { receiverId, voiceUrl, duration, waveform, encrypted = false, encryptionData } = req.body;
    const senderId = req.user.userId;

    console.log('🎤 [VOICE MESSAGE] Sending voice message:', {
      senderId,
      receiverId,
      duration,
      encrypted
    });

    // Validate input
    if (!receiverId || !voiceUrl || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID, voice URL, and duration are required'
      });
    }

    // Check if users have blocked each other
    const blockStatus = await Block.isMutuallyBlocked(senderId, receiverId);
    if (blockStatus.anyBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Cannot send voice message to this user'
      });
    }

    // Create voice message
    const messageData = {
      senderId,
      receiverId,
      message: encrypted ? encryptionData?.encryptedContent || '[Voice Message]' : '[Voice Message]',
      messageType: 'voice',
      voiceMetadata: {
        duration,
        waveform: waveform || [],
        fileUrl: voiceUrl
      },
      encrypted,
      encryptionData: encrypted ? encryptionData : undefined,
      timestamp: new Date()
    };

    const newMessage = new Message(messageData);
    const savedMessage = await newMessage.save();

    console.log('✅ [VOICE MESSAGE] Voice message saved:', savedMessage._id);

    // Broadcast to receiver via WebSocket
    try {
      // Get sender information for notifications
      const sender = await User.findOne({ userId: senderId }).select('name profileImage');
      const senderName = sender ? sender.name : 'Unknown User';
      const senderProfileImage = sender ? sender.profileImage : null;
      
      const broadcastResult = await broadcastToUser(receiverId, 'message:new', {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        senderName: senderName, // ✅ ADDED for notifications
        senderProfileImage: senderProfileImage, // ✅ ADDED for notifications
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        voiceMetadata: savedMessage.voiceMetadata,
        encrypted: savedMessage.encrypted,
        encryptionData: savedMessage.encryptionData,
        timestamp: savedMessage.timestamp,
        status: 'delivered'
      });

      if (broadcastResult) {
        savedMessage.status = 'delivered';
        await savedMessage.save();
      }
    } catch (broadcastError) {
      console.error('❌ [VOICE MESSAGE] Broadcast error:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: savedMessage,
      message: 'Voice message sent successfully'
    });

  } catch (error) {
    console.error('❌ [VOICE MESSAGE] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send voice message',
      error: error.message
    });
  }
};

// Exchange encryption keys
const exchangeEncryptionKeys = async (req, res) => {
  try {
    const { contactUserId, publicKey } = req.body;
    const currentUserId = req.user.userId;

    console.log('🔐 [ENCRYPTION] Key exchange request:', {
      currentUserId,
      contactUserId
    });

    // Validate input
    if (!contactUserId || !publicKey) {
      return res.status(400).json({
        success: false,
        message: 'Contact user ID and public key are required'
      });
    }

    // Verify contact user exists
    const contactUser = await User.findOne({ userId: contactUserId });
    if (!contactUser) {
      return res.status(404).json({
        success: false,
        message: 'Contact user not found'
      });
    }

    // Store the public key exchange (in a real app, you'd have a separate KeyExchange model)
    // For now, we'll just return success and let the frontend handle key derivation
    
    res.status(200).json({
      success: true,
      message: 'Encryption keys exchanged successfully',
      data: {
        contactUserId,
        keyExchangeTimestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ [ENCRYPTION] Key exchange error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to exchange encryption keys',
      error: error.message
    });
  }
};

// Get user's public key
const getPublicKey = async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log('🔐 [ENCRYPTION] Public key request for user:', userId);

    // In a real implementation, you'd store and retrieve actual public keys
    // For now, we'll generate a mock public key based on user ID
    const mockPublicKey = require('crypto')
      .createHash('sha256')
      .update(userId + 'public_key_salt')
      .digest('hex');

    res.status(200).json({
      success: true,
      data: {
        userId,
        publicKey: mockPublicKey,
        keyType: 'ECDH-P256',
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ [ENCRYPTION] Get public key error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public key',
      error: error.message
    });
  }
};

module.exports = {
  sendMessage,
  getChatHistory,
  markMessagesAsRead,
  getUnreadCount,
  getAllUnreadCounts,
  deleteMessage,
  toggleReaction,
  searchMessages,
  sendReply,
  testChatConnectivity,
  testNotificationFlow,
  sendVoiceMessage,
  exchangeEncryptionKeys,
  getPublicKey
};
