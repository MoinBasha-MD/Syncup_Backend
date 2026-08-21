const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getOrCreateChat,
  sendMessage,
  getMessages,
  getUserConversations,
  getOwnerConversations,
  getOwnerUnreadCount
} = require('../controllers/pageChatController');

// All routes require authentication
router.use(protect);

// --- Owner inbox routes (must be before /:pageId to avoid param conflicts) ---

// Get all conversations for the current user (pages they've messaged)
router.get('/chat/conversations', getUserConversations);

// Get all conversations for the page owner (users who messaged their pages)
router.get('/chat/owner-conversations', getOwnerConversations);

// Get unread message count for page owner
router.get('/chat/unread-count', getOwnerUnreadCount);

// --- Per-page chat routes ---

// Get or create a chat with a specific page
router.post('/:pageId/chat', getOrCreateChat);

// Send a message to a specific page
router.post('/:pageId/chat/messages', sendMessage);

// Get messages in a chat with a specific page
router.get('/:pageId/chat/messages', getMessages);

module.exports = router;
