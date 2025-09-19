const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  addEntry,
  getConversation,
  summarizeConversation,
  clearConversation
} = require('../controllers/diyaMemoryController');

// @desc    Add a memory entry to a conversation
// @route   POST /api/diya/memory/entry
// @access  Private
router.post('/memory/entry', protect, addEntry);

// @desc    Get a conversation memory by conversationId
// @route   GET /api/diya/memory/:conversationId
// @access  Private
router.get('/memory/:conversationId', protect, getConversation);

// @desc    Summarize a conversation
// @route   POST /api/diya/memory/:conversationId/summarize
// @access  Private
router.post('/memory/:conversationId/summarize', protect, summarizeConversation);

// @desc    Clear a conversation memory
// @route   DELETE /api/diya/memory/:conversationId
// @access  Private
router.delete('/memory/:conversationId', protect, clearConversation);

module.exports = router;
