const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const analyticsController = require('../controllers/docSpaceAnalyticsController');

// All routes require authentication
router.use(protect);

// Analytics routes (specific routes before parameterized routes)
router.get('/analytics/timeline', analyticsController.getAccessTimeline);
router.get('/analytics/stats', analyticsController.getOverallStats);
router.get('/analytics/:documentId', analyticsController.getDocumentAnalytics);

// Access tracking
router.post('/track-access', analyticsController.trackAccess);

// Access control
router.put('/documents/:documentId/access-control', analyticsController.updateAccessControl);

// Organization
router.put('/documents/:documentId/organize', analyticsController.organizeDocument);

module.exports = router;
