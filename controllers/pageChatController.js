const PageChat = require('../models/PageChat');
const PageMessage = require('../models/PageMessage');
const Page = require('../models/Page');
const { broadcastToUser } = require('../socketManager');
const { constructImageUrl } = require('../middleware/pageImageHandler');

// @desc    Get or create a chat with a page
// @route   POST /api/pages/:pageId/chat
// @access  Private
const getOrCreateChat = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.userId;

    const page = await Page.findById(pageId).select('name username profileImage owner');
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    // Don't allow owner to message their own page
    const isOwner = page.isOwner(req.user._id);
    if (isOwner) {
      return res.status(400).json({ success: false, message: 'Cannot message your own page' });
    }

    const chat = await PageChat.findOrCreate(pageId, userId);

    res.json({
      success: true,
      chatId: chat._id,
      page: {
        _id: page._id,
        name: page.name,
        username: page.username,
        profileImage: page.profileImage,
        profileImageUrl: page.profileImage ? constructImageUrl(page.profileImage) : ''
      }
    });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error creating chat:', error);
    res.status(500).json({ success: false, message: 'Failed to create chat' });
  }
};

// @desc    Send a message to a page
// @route   POST /api/pages/:pageId/chat/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { message, messageType = 'text', imageUrl = null } = req.body;
    const userId = req.user.userId;

    if (!message && !imageUrl) {
      return res.status(400).json({ success: false, message: 'Message or image is required' });
    }

    const page = await Page.findById(pageId).select('name username profileImage owner');
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    // Don't allow owner to send as user to their own page
    const isOwner = page.isOwner(req.user._id);

    const chat = await PageChat.findOrCreate(pageId, userId);

    // Determine sender type
    const senderType = isOwner ? 'page' : 'user';

    const newMessage = await PageMessage.create({
      chatId: chat._id,
      pageId,
      senderId: userId,
      senderType,
      message: message || '',
      messageType,
      imageUrl,
      status: 'sent'
    });

    // Update chat preview
    chat.lastMessage = messageType === 'image' ? '[Image]' : (message || '').substring(0, 100);
    chat.lastMessageAt = new Date();
    if (senderType === 'user') {
      chat.ownerUnreadCount = (chat.ownerUnreadCount || 0) + 1;
    } else {
      chat.userUnreadCount = (chat.userUnreadCount || 0) + 1;
    }
    await chat.save();

    // Broadcast to page owner for real-time delivery
    const ownerId = page.owner ? (typeof page.owner === 'object' ? page.owner._id : page.owner).toString() : null;
    if (ownerId) {
      const messageData = {
        messageId: newMessage._id,
        chatId: chat._id,
        pageId,
        pageName: page.name,
        pageProfileImage: page.profileImage ? constructImageUrl(page.profileImage) : '',
        senderId: userId,
        senderType,
        message: newMessage.message,
        messageType: newMessage.messageType,
        imageUrl: newMessage.imageUrl,
        timestamp: newMessage.timestamp
      };
      broadcastToUser(ownerId, 'page-message:new', messageData);
    }

    // Also broadcast back to sender (for multi-device sync)
    broadcastToUser(userId, 'page-message:sent', {
      messageId: newMessage._id,
      chatId: chat._id,
      pageId,
      message: newMessage.message,
      messageType: newMessage.messageType,
      imageUrl: newMessage.imageUrl,
      timestamp: newMessage.timestamp
    });

    res.json({
      success: true,
      message: {
        _id: newMessage._id,
        chatId: newMessage.chatId,
        senderId: newMessage.senderId,
        senderType: newMessage.senderType,
        message: newMessage.message,
        messageType: newMessage.messageType,
        imageUrl: newMessage.imageUrl,
        timestamp: newMessage.timestamp,
        status: newMessage.status
      }
    });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error sending message:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

// @desc    Get messages in a page chat
// @route   GET /api/pages/:pageId/chat/messages
// @access  Private
const getMessages = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { skip = 0, limit = 50 } = req.query;
    const userId = req.user.userId;

    const chat = await PageChat.findOne({ pageId, userId });
    if (!chat) {
      return res.json({ success: true, messages: [] });
    }

    const messages = await PageMessage.getConversation(
      chat._id,
      parseInt(skip),
      parseInt(limit)
    );

    // Mark messages as read
    const page = await Page.findById(pageId).select('owner');
    const isOwner = page && page.isOwner(req.user._id);
    const readerType = isOwner ? 'page' : 'user';

    await PageMessage.markAsRead(chat._id, readerType);

    // Reset unread count for the reader
    if (readerType === 'user') {
      chat.userUnreadCount = 0;
    } else {
      chat.ownerUnreadCount = 0;
    }
    await chat.save();

    res.json({ success: true, messages: messages.reverse() });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error getting messages:', error);
    res.status(500).json({ success: false, message: 'Failed to get messages' });
  }
};

// @desc    Get all page chat conversations for the current user
// @route   GET /api/pages/chat/conversations
// @access  Private
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { skip = 0, limit = 50 } = req.query;

    const conversations = await PageChat.getUserConversations(
      userId,
      parseInt(skip),
      parseInt(limit)
    );

    // Process image URLs
    const processed = conversations.map(conv => {
      if (conv.pageId && typeof conv.pageId === 'object') {
        const page = conv.pageId;
        if (page.profileImage) {
          page.profileImageUrl = constructImageUrl(page.profileImage);
        }
      }
      return conv;
    });

    res.json({ success: true, conversations: processed });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error getting conversations:', error);
    res.status(500).json({ success: false, message: 'Failed to get conversations' });
  }
};

// @desc    Get all page chat conversations for the page owner
// @route   GET /api/pages/chat/owner-conversations
// @access  Private
const getOwnerConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { skip = 0, limit = 50 } = req.query;

    // Find all pages owned by the user
    const pages = await Page.find({ owner: req.user._id }).select('_id');
    const pageIds = pages.map(p => p._id);

    if (pageIds.length === 0) {
      return res.json({ success: true, conversations: [] });
    }

    const conversations = await PageChat.getPageConversations(
      pageIds,
      parseInt(skip),
      parseInt(limit)
    );

    // Populate user info for each conversation
    const User = require('../models/userModel');
    const userIds = conversations.map(c => c.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select('name username profileImage')
      .lean();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u;
    });

    // Process image URLs and attach user info
    const processed = conversations.map(conv => {
      if (conv.pageId && typeof conv.pageId === 'object') {
        const page = conv.pageId;
        if (page.profileImage) {
          page.profileImageUrl = constructImageUrl(page.profileImage);
        }
      }
      const userInfo = userMap[conv.userId];
      if (userInfo) {
        conv.user = {
          _id: userInfo._id,
          name: userInfo.name,
          username: userInfo.username,
          profileImage: userInfo.profileImage,
          profileImageUrl: userInfo.profileImage ? constructImageUrl(userInfo.profileImage) : ''
        };
      }
      return conv;
    });

    res.json({ success: true, conversations: processed });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error getting owner conversations:', error);
    res.status(500).json({ success: false, message: 'Failed to get conversations' });
  }
};

// @desc    Get unread message count for page owner (all their pages)
// @route   GET /api/pages/chat/unread-count
// @access  Private
const getOwnerUnreadCount = async (req, res) => {
  try {
    const pages = await Page.find({ owner: req.user._id }).select('_id');
    const pageIds = pages.map(p => p._id);

    if (pageIds.length === 0) {
      return res.json({ success: true, totalUnread: 0 });
    }

    const result = await PageChat.aggregate([
      { $match: { pageId: { $in: pageIds } } },
      { $group: { _id: null, totalUnread: { $sum: '$ownerUnreadCount' } } }
    ]);

    const totalUnread = result.length > 0 ? result[0].totalUnread : 0;
    res.json({ success: true, totalUnread });
  } catch (error) {
    console.error('❌ [PAGE CHAT] Error getting unread count:', error);
    res.status(500).json({ success: false, message: 'Failed to get unread count' });
  }
};

module.exports = {
  getOrCreateChat,
  sendMessage,
  getMessages,
  getUserConversations,
  getOwnerConversations,
  getOwnerUnreadCount
};
