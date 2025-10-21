const express = require('express');
const router = express.Router();
const {
  initializeAgentSystem,
  submitTask,
  getTaskStatus,
  getUserTasks,
  cancelTask,
  getSystemStatus,
  getAgentMetrics,
  restartAgentSystem,
  shutdownAgentSystem
} = require('../controllers/agentController');
const { protect } = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/securityMiddleware');

// Apply rate limiting to all agent routes
router.use(apiLimiter);

// System management routes (admin only)
router.post('/system/initialize', protect, initializeAgentSystem);
router.post('/system/restart', protect, restartAgentSystem);
router.post('/system/shutdown', protect, shutdownAgentSystem);
router.get('/system/status', protect, getSystemStatus);
router.get('/system/metrics', protect, getAgentMetrics);

// Task management routes
router.post('/tasks', protect, submitTask);
router.get('/tasks/:taskId', protect, getTaskStatus);
router.delete('/tasks/:taskId', protect, cancelTask);
router.get('/users/:userId/tasks', protect, getUserTasks);

module.exports = router;
