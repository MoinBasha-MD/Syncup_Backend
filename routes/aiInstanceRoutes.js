const express = require('express');
const router = express.Router();
const AIInstanceController = require('../controllers/aiInstanceController');
const AIAuthMiddleware = require('../middleware/aiAuthMiddleware');
const { protect } = require('../middleware/authMiddleware'); // Existing user auth middleware

// AI Instance Management Routes

/**
 * @route   POST /api/ai/register
 * @desc    Register a new AI instance for a user
 * @access  Private (User authentication required)
 */
router.post('/register', 
  protect, // User authentication
  AIInstanceController.registerAI
);

/**
 * @route   GET /api/ai/instance/:userId
 * @desc    Get AI instance by user ID
 * @access  Private (User authentication required)
 */
router.get('/instance/:userId', 
  protect, // User authentication
  AIInstanceController.getAIByUser
);

/**
 * @route   PUT /api/ai/instance/:aiId
 * @desc    Update AI instance settings
 * @access  Private (AI authentication required)
 */
router.put('/instance/:aiId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.logActivity, // Log AI activity
  AIInstanceController.updateAIInstance
);

/**
 * @route   DELETE /api/ai/instance/:aiId
 * @desc    Deactivate AI instance
 * @access  Private (AI authentication required)
 */
router.delete('/instance/:aiId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.logActivity, // Log AI activity
  AIInstanceController.deactivateAI
);

/**
 * @route   GET /api/ai/status/:aiId
 * @desc    Get AI status
 * @access  Public (for other AIs to check status)
 */
router.get('/status/:aiId', 
  AIInstanceController.getAIStatus
);

/**
 * @route   PUT /api/ai/status/:aiId
 * @desc    Update AI status
 * @access  Private (AI authentication required)
 */
router.put('/status/:aiId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.requireStatus(['online', 'offline', 'busy', 'away']), // Validate current status
  AIAuthMiddleware.logActivity, // Log AI activity
  AIInstanceController.updateAIStatus
);

/**
 * @route   GET /api/ai/capabilities/:aiId
 * @desc    Get AI capabilities
 * @access  Public (for other AIs to check capabilities)
 */
router.get('/capabilities/:aiId', 
  AIInstanceController.getAICapabilities
);

/**
 * @route   PUT /api/ai/capabilities/:aiId
 * @desc    Update AI capabilities
 * @access  Private (AI authentication required)
 */
router.put('/capabilities/:aiId', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.logActivity, // Log AI activity
  AIInstanceController.updateAICapabilities
);

/**
 * @route   GET /api/ai/search
 * @desc    Search for AI instances
 * @access  Private (AI authentication required)
 * @query   status, canSchedule, canAccessCalendar, canMakeReservations, privacyLevel, responseStyle, limit
 */
router.get('/search', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIInstanceController.searchAIs
);

/**
 * @route   GET /api/ai/stats/:aiId
 * @desc    Get AI statistics
 * @access  Private (AI authentication required - own stats only, or admin)
 */
router.get('/stats/:aiId', 
  AIAuthMiddleware.authenticateUserAndAI, // Both user and AI authentication
  AIInstanceController.getAIStats
);

/**
 * @route   GET /api/ai/registry/stats
 * @desc    Get registry statistics
 * @access  Private (Admin only)
 */
router.get('/registry/stats', 
  protect, // User authentication
  AIInstanceController.getRegistryStats
);

/**
 * @route   POST /api/ai/heartbeat
 * @desc    AI heartbeat endpoint
 * @access  Private (AI authentication required)
 */
router.post('/heartbeat', 
  AIAuthMiddleware.authenticateAI, // AI authentication
  AIAuthMiddleware.rateLimit({ maxRequests: 120, windowMs: 60 * 1000 }), // 2 requests per second max
  AIInstanceController.heartbeat
);

module.exports = router;
