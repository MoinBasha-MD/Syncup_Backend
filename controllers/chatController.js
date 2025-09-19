const Message = require('../models/Message');
const User = require('../models/userModel');
const Block = require('../models/blockModel');
const { broadcastToUser } = require('../socketManager');

// Send a message
const sendMessage = async (req, res) => {
  try {
    const { receiverId, message, messageType = 'text' } = req.body;
    const senderId = req.user.userId;
    const senderObjectId = req.user.id; // MongoDB _id of sender

    console.log('💬 Chat Controller - Send Message:', {
      senderId,
      senderObjectId,
      receiverId,
      messageType,
      messageLength: message?.length
    });

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
      status: 'sent'
    });

    // Save message to database
    const savedMessage = await newMessage.save();
    console.log('✅ Message saved to database:', savedMessage._id);

    // Broadcast message to receiver via WebSocket using MongoDB _id
    try {
      console.log('📡 Attempting to broadcast message to receiver...');
      console.log('🔍 Broadcasting to receiverObjectId:', receiverObjectId);
      
      const broadcastSuccess = broadcastToUser(receiverObjectId, 'message:new', {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        timestamp: savedMessage.timestamp,
        status: 'delivered'
      });
      
      if (broadcastSuccess) {
        console.log('✅ Message successfully broadcasted to receiver via WebSocket');
        // Update message status to delivered
        savedMessage.status = 'delivered';
        await savedMessage.save();
      } else {
        console.log('⚠️ Message not delivered via WebSocket (receiver offline), but saved to database');
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

    // Broadcast read status to sender via WebSocket using MongoDB _id
    try {
      console.log('📡 Broadcasting read receipts to contact...');
      console.log('🔍 Broadcasting to contactObjectId:', contactObjectId);
      
      messageIds.forEach(messageId => {
        const broadcastSuccess = broadcastToUser(contactObjectId, 'message:read', { messageId });
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
        console.log('🔍 Broadcasting to receiverObjectId:', receiverObjectId);
        
        const broadcastSuccess = broadcastToUser(receiverObjectId, 'message:deleted', { messageId });
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
    const { receiverId, message, messageType = 'text', replyToId } = req.body;
    const senderId = req.user.userId;
    const senderObjectId = req.user.id;

    console.log('💬 Chat Controller - Send Reply:', {
      senderId,
      receiverId,
      messageType,
      replyToId,
      messageLength: message?.length
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
      status: 'sent'
    });

    // Save message to database
    const savedMessage = await newMessage.save();
    await savedMessage.populate('replyTo', 'senderId messagePreview timestamp');

    console.log('✅ Reply message saved to database:', savedMessage._id);

    // Broadcast message to receiver
    try {
      const broadcastSuccess = broadcastToUser(receiverObjectId, 'message:new', {
        _id: savedMessage._id,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        message: savedMessage.message,
        messageType: savedMessage.messageType,
        replyTo: savedMessage.replyTo,
        timestamp: savedMessage.timestamp,
        status: 'delivered'
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

module.exports = {
  sendMessage,
  getChatHistory,
  markMessagesAsRead,
  getUnreadCount,
  getAllUnreadCounts,
  deleteMessage,
  toggleReaction,
  searchMessages,
  sendReply
};
