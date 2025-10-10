const express = require('express');
const router = express.Router();
const AICommunicationController = require('../controllers/aiCommunicationController');
const AIAuthMiddleware = require('../middleware/aiAuthMiddleware');

// AI-to-AI Communication Routes

/**
 * @route   POST /api/ai/message/send
 * @desc    Send message to another AI
 * @access  Private (AI authentication required)
 */
router.post('/message/send', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.requireStatus(['online', 'busy']), // Must be online or busy
  AIAuthMiddleware.checkCommunicationPermissions, // Check if communication is allowed
  AIAuthMiddleware.rateLimit({ maxRequests: 50, windowMs: 60 * 1000 }), // 50 messages per minute
  AIAuthMiddleware.logActivity, // Log AI activity
  AICommunicationController.sendMessage
);

/**
 * @route   POST /api/ai/message/broadcast
 * @desc    Broadcast message to group AIs
 * @access  Private (AI authentication required)
 */
router.post('/message/broadcast', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.requireStatus(['online', 'busy']), // Must be online or busy
  AIAuthMiddleware.requireCapabilities(['canSchedule']), // Must have scheduling capability for group coordination
  AIAuthMiddleware.rateLimit({ maxRequests: 10, windowMs: 60 * 1000 }), // 10 broadcasts per minute
  AIAuthMiddleware.logActivity, // Log AI activity
  AICommunicationController.broadcastMessage
);

/**
 * @route   GET /api/ai/message/inbox/:aiId
 * @desc    Get pending messages for AI
 * @access  Private (AI authentication required - own inbox only)
 */
router.get('/message/inbox/:aiId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.rateLimit({ maxRequests: 120, windowMs: 60 * 1000 }), // 2 requests per second
  AICommunicationController.getInbox
);

/**
 * @route   PUT /api/ai/message/process/:messageId
 * @desc    Mark message as processed
 * @access  Private (AI authentication required)
 */
router.put('/message/process/:messageId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.requireStatus(['online', 'busy']), // Must be online or busy
  AIAuthMiddleware.rateLimit({ maxRequests: 100, windowMs: 60 * 1000 }), // 100 processes per minute
  AIAuthMiddleware.logActivity, // Log AI activity
  AICommunicationController.processMessage
);

/**
 * @route   GET /api/ai/conversation/:conversationId
 * @desc    Get conversation details
 * @access  Private (AI authentication required - participants only)
 */
router.get('/conversation/:conversationId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.rateLimit({ maxRequests: 60, windowMs: 60 * 1000 }), // 1 request per second
  AICommunicationController.getConversation
);

/**
 * @route   POST /api/ai/conversation/create
 * @desc    Create new AI conversation
 * @access  Private (AI authentication required)
 */
router.post('/conversation/create', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.requireStatus(['online', 'busy']), // Must be online or busy
  AIAuthMiddleware.checkCommunicationPermissions, // Check if communication is allowed
  AIAuthMiddleware.rateLimit({ maxRequests: 30, windowMs: 60 * 1000 }), // 30 conversations per minute
  AIAuthMiddleware.logActivity, // Log AI activity
  AICommunicationController.createConversation
);

/**
 * @route   PUT /api/ai/conversation/:conversationId/close
 * @desc    Close conversation
 * @access  Private (AI authentication required - participants only)
 */
router.put('/conversation/:conversationId/close', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.rateLimit({ maxRequests: 60, windowMs: 60 * 1000 }), // 1 request per second
  AIAuthMiddleware.logActivity, // Log AI activity
  AICommunicationController.closeConversation
);

/**
 * @route   GET /api/ai/communication/stats
 * @desc    Get AI communication statistics
 * @access  Private (AI authentication required - own stats only)
 */
router.get('/communication/stats', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.rateLimit({ maxRequests: 10, windowMs: 60 * 1000 }), // 10 requests per minute
  AICommunicationController.getCommunicationStats
);

module.exports = router;
