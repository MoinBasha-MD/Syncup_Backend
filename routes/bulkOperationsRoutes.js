const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { validate, statusValidationRules } = require('../middleware/securityMiddleware');
const { cache, invalidateCache } = require('../middleware/cacheMiddleware');

/**
 * Bulk operations controller for status templates and schedules
 */
const bulkOperationsController = (req, res) => {
  const statusService = req.container.resolve('statusService');
  
  // Route handlers
  return {
    // Bulk create status templates
    bulkCreateTemplates: async (req, res, next) => {
      try {
        const templates = await statusService.bulkCreateTemplates(req.user._id, req.body);
        res.status(201).json({
          success: true,
          count: templates.length,
          data: templates
        });
      } catch (error) {
        next(error);
      }
    },
    
    // Bulk create status schedules
    bulkCreateSchedules: async (req, res, next) => {
      try {
        const schedules = await statusService.bulkCreateSchedules(req.user._id, req.body);
        res.status(201).json({
          success: true,
          count: schedules.length,
          data: schedules
        });
      } catch (error) {
        next(error);
      }
    },
    
    // Sync status with calendar
    syncWithCalendar: async (req, res, next) => {
      try {
        const { calendarType, accessToken, startDate, endDate } = req.body;
        
        // Get calendar integration service
        const calendarIntegration = require('../utils/calendarIntegration');
        
        // Get calendar events based on type
        let events;
        switch (calendarType) {
          case 'google':
            events = await calendarIntegration.getGoogleCalendarEvents(
              accessToken,
              new Date(startDate),
              new Date(endDate)
            );
            break;
          case 'outlook':
            events = await calendarIntegration.getOutlookCalendarEvents(
              accessToken,
              new Date(startDate),
              new Date(endDate)
            );
            break;
          case 'apple':
            events = await calendarIntegration.getAppleCalendarEvents(
              accessToken,
              new Date(startDate),
              new Date(endDate)
            );
            break;
          default:
            return res.status(400).json({
              success: false,
              message: 'Invalid calendar type'
            });
        }
        
        // Map events to status schedules
        const schedules = calendarIntegration.mapEventsToStatusSchedules(events);
        
        // Create schedules
        const createdSchedules = await statusService.syncStatusWithCalendar(req.user._id, events);
        
        // Send notification
        const notificationManager = require('../utils/notificationManager');
        await notificationManager.sendCalendarSyncNotification(req.user, createdSchedules);
        
        res.status(201).json({
          success: true,
          count: createdSchedules.length,
          data: createdSchedules
        });
      } catch (error) {
        next(error);
      }
    },
    
    // Get status suggestions
    getStatusSuggestions: async (req, res, next) => {
      try {
        // Get status suggestions service
        const statusSuggestions = require('../utils/statusSuggestions');
        
        // Get suggestions
        const suggestions = await statusSuggestions.getSuggestions(req.user._id);
        
        res.status(200).json({
          success: true,
          data: suggestions
        });
      } catch (error) {
        next(error);
      }
    }
  };
};

// Create controller with dependency injection
const createController = (req, res, next) => {
  const controller = bulkOperationsController(req, res);
  return controller;
};

// Bulk create templates route
router.post(
  '/templates/bulk',
  protect,
  validate(statusValidationRules.bulkCreate),
  invalidateCache('status/templates*'),
  (req, res, next) => createController(req, res).bulkCreateTemplates(req, res, next)
);

// Bulk create schedules route
router.post(
  '/schedules/bulk',
  protect,
  validate(statusValidationRules.bulkCreate),
  invalidateCache('status/schedules*'),
  (req, res, next) => createController(req, res).bulkCreateSchedules(req, res, next)
);

// Sync with calendar route
router.post(
  '/sync/calendar',
  protect,
  invalidateCache('status/schedules*'),
  (req, res, next) => createController(req, res).syncWithCalendar(req, res, next)
);

// Get status suggestions route
router.get(
  '/suggestions',
  protect,
  cache(300), // Cache for 5 minutes
  (req, res, next) => createController(req, res).getStatusSuggestions(req, res, next)
);

module.exports = router;
