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
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/securityMiddleware');

// Apply rate limiting to all agent routes
router.use(apiLimiter);

// System management routes (admin only)
router.post('/system/initialize', protect, requireAdmin, initializeAgentSystem);
router.post('/system/restart', protect, requireAdmin, restartAgentSystem);
router.post('/system/shutdown', protect, requireAdmin, shutdownAgentSystem);
router.get('/system/status', protect, requireAdmin, getSystemStatus);
router.get('/system/metrics', protect, requireAdmin, getAgentMetrics);

// Task management routes (submission is admin-only; reads/cancels are scoped
// to the owning user inside the controller)
router.post('/tasks', protect, requireAdmin, submitTask);
router.get('/tasks/:taskId', protect, getTaskStatus);
router.delete('/tasks/:taskId', protect, cancelTask);
router.get('/users/:userId/tasks', protect, getUserTasks);

module.exports = router;
