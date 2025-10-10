const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
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
} = require('../controllers/chatController');

// All chat routes require authentication
router.use(protect);

// Send a message
router.post('/send', sendMessage);

// Get chat history with a specific contact
router.get('/history/:contactId', getChatHistory);

// Mark messages as read
router.put('/read', markMessagesAsRead);

// Get unread message count for a specific contact
router.get('/unread/:contactId', getUnreadCount);

// Get all unread message counts
router.get('/unread', getAllUnreadCounts);

// Delete a message
router.delete('/message/:messageId', deleteMessage);

// Toggle message reaction
router.post('/message/:messageId/reaction', toggleReaction);

// Search messages in a conversation
router.get('/search/:contactId', searchMessages);

// Send reply message
router.post('/reply', sendReply);

// Test chat system connectivity
router.get('/test-connectivity', testChatConnectivity);

// Test notification flow end-to-end
router.post('/test-notification', testNotificationFlow);

// Voice message routes
router.post('/voice', sendVoiceMessage);

// Encryption routes
router.post('/encryption/exchange-keys', exchangeEncryptionKeys);
router.get('/encryption/public-key/:userId', getPublicKey);

module.exports = router;
