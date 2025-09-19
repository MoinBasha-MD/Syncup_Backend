const express = require('express');
const router = express.Router();
const aiMessageController = require('../controllers/aiMessageController');
const { protect } = require('../middleware/authMiddleware');

// All AI message routes require authentication
router.use(protect);

/**
 * @route POST /api/ai/message/send
 * @desc Send AI-to-AI message
 * @access Private
 */
router.post('/send', aiMessageController.sendAIMessage);

/**
 * @route POST /api/ai/message/process
 * @desc Process incoming AI message and generate response
 * @access Private
 */
router.post('/process', aiMessageController.processAIMessage);

/**
 * @route GET /api/ai/conversations
 * @desc Get AI conversations for current user
 * @access Private
 */
router.get('/conversations', aiMessageController.getAIConversations);

/**
 * @route GET /api/ai/privacy
 * @desc Get AI privacy settings
 * @access Private
 */
router.get('/privacy', aiMessageController.getAIPrivacySettings);

/**
 * @route PUT /api/ai/privacy
 * @desc Update AI privacy settings
 * @access Private
 */
router.put('/privacy', aiMessageController.updateAIPrivacySettings);

module.exports = router;
