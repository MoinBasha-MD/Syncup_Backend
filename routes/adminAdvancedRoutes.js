const express = require('express');
const router = express.Router();
const { isAdminAuthenticated } = require('../middleware/adminAuthMiddleware');

// Controllers
const { listAdmins, showCreateAdminForm, createAdmin, showEditAdminForm, updateAdmin, deleteAdmin } = require('../controllers/adminManagementController');
const { showBroadcastForm, sendBroadcast, getBroadcastHistory } = require('../controllers/broadcastController');
const { showStatusManagement, deleteStatusHistory, deleteScheduledStatus, clearOldStatuses } = require('../controllers/statusManagementController');
const { showAnalytics, exportAnalytics } = require('../controllers/analyticsController');
const { showSecurityDashboard, getActivityLogs, unlockAccount, resetLoginAttempts } = require('../controllers/securityController');
const { globalSearch, showSearchPage } = require('../controllers/searchController');
const { showNotifications, getUnreadCount, markAsRead } = require('../controllers/notificationsController');
const { showRolePermissions, updateRolePermissions } = require('../controllers/rolePermissionsController');
const { showActivityTimeline, getActivityFeed } = require('../controllers/activityTimelineController');
const { exportAnalyticsPDF, exportUsersPDF } = require('../controllers/pdfExportController');

// All routes require authentication
router.use(isAdminAuthenticated);

// Admin Users Management
router.get('/admin-users', listAdmins);
router.get('/admin-users/create', showCreateAdminForm);
router.post('/admin-users/create', createAdmin);
router.get('/admin-users/:id/edit', showEditAdminForm);
router.put('/admin-users/:id', updateAdmin);
router.delete('/admin-users/:id', deleteAdmin);

// Broadcast System
router.get('/broadcast', showBroadcastForm);
router.post('/broadcast/send', sendBroadcast);
router.get('/broadcast/history', getBroadcastHistory);

// Status Management
router.get('/status-management', showStatusManagement);
router.delete('/status-management/history/:id', deleteStatusHistory);
router.delete('/status-management/schedule/:id', deleteScheduledStatus);
router.post('/status-management/clear-old', clearOldStatuses);

// Enhanced Analytics
router.get('/analytics-advanced', showAnalytics);
router.get('/analytics/export', exportAnalytics);

// Security & Logs
router.get('/security', showSecurityDashboard);
router.get('/security/logs', getActivityLogs);
router.post('/security/unlock/:id', unlockAccount);
router.post('/security/reset-attempts', resetLoginAttempts);

// Advanced Search
router.get('/search', showSearchPage);
router.get('/api/search', globalSearch);

// Notifications
router.get('/notifications', showNotifications);
router.get('/api/notifications/unread', getUnreadCount);
router.post('/api/notifications/:id/read', markAsRead);

// Role Permissions
router.get('/permissions', showRolePermissions);
router.post('/permissions/update', updateRolePermissions);

// Activity Timeline
router.get('/activity', showActivityTimeline);
router.get('/api/activity/feed', getActivityFeed);

// PDF Export
router.get('/export/analytics-pdf', exportAnalyticsPDF);
router.get('/export/users-pdf', exportUsersPDF);

module.exports = router;
