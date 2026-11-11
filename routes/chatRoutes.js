const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const broadcastLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `broadcast:${req.user.userId}`,
  message: { success: false, message: 'Too many broadcast messages, please try again later', code: 'BROADCAST_RATE_LIMIT' },
});
const {
  sendMessage,
  sendBroadcastMessage,
  broadcastCapability,
  broadcastRecipients,
  getConversations,
  getChatHistory,
  markMessagesAsRead,
  getUnreadCount,
  getAllUnreadCounts,
  deleteMessage,
  editMessage,
  toggleReaction,
  searchMessages,
  sendReply,
  testChatConnectivity,
  testNotificationFlow,
  sendVoiceMessage,
  exchangeEncryptionKeys,
  getPublicKey,
  deleteGhostMessages,
  markGhostMessagesViewed, // ✅ FIX #3
  deleteViewedGhostMessages, // ✅ FIX #3
  markBurnViewed,
  cleanupExpiredMessages,
  clearMessages,
  deleteConversation,
  setChatMute,
  getChatMutes
} = require('../controllers/chatController');

// All chat routes require authentication
router.use(protect);

// Send a message
router.post('/send', sendMessage);
router.get('/broadcast-capability', broadcastCapability);
router.get('/broadcast/recipients', broadcastRecipients);
router.post('/broadcast/send', broadcastLimiter, sendBroadcastMessage);

router.get('/conversations', getConversations);

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

// Edit a message
router.put('/message/:messageId', editMessage);

// Toggle message reaction
router.post('/message/:messageId/reaction', toggleReaction);

// Search messages in a conversation
router.get('/search/:contactId', searchMessages);

// Send reply message
router.post('/reply', sendReply);

// Voice message routes
router.post('/voice', sendVoiceMessage);

// Encryption routes
router.post('/encryption/exchange-keys', exchangeEncryptionKeys);
router.get('/encryption/public-key/:userId', getPublicKey);

// Privacy mode routes
router.post('/ghost/delete', deleteGhostMessages);
router.post('/ghost/mark-viewed', markGhostMessagesViewed); // ✅ FIX #3
router.post('/ghost/delete-viewed', deleteViewedGhostMessages); // ✅ FIX #3
router.put('/burn/:messageId/viewed', markBurnViewed);
router.post('/timer/cleanup', cleanupExpiredMessages);

// Clear all messages in a conversation
router.delete('/clear/:contactId', clearMessages);

// Delete entire conversation from chat list
router.delete('/conversation/:contactId', deleteConversation);

// Chat notification mute (suppresses push for this sender)
router.put('/mute/:contactId', setChatMute);
router.get('/mutes', getChatMutes);

module.exports = router;
