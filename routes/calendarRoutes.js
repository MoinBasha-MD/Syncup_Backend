const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const calendarIntegration = require('../utils/calendarIntegration');

// @desc    Get calendar events for a date range
// @route   GET /api/calendar/events
// @access  Private
router.get('/events', protect, async (req, res) => {
  try {
    const { startDate, endDate, provider } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Start date and end date are required' 
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    console.log(`📅 Fetching calendar events from ${start.toISOString()} to ${end.toISOString()}`);
    
    let events = [];
    
    // For now, use mock data from calendarIntegration
    // In production, this would use actual OAuth tokens
    switch (provider) {
      case 'google':
        events = await calendarIntegration.getGoogleCalendarEvents('mock-token', start, end);
        break;
      case 'outlook':
        events = await calendarIntegration.getOutlookCalendarEvents('mock-token', start, end);
        break;
      case 'apple':
        events = await calendarIntegration.getAppleCalendarEvents('mock-token', start, end);
        break;
      default:
        // Get events from all providers
        const [googleEvents, outlookEvents, appleEvents] = await Promise.all([
          calendarIntegration.getGoogleCalendarEvents('mock-token', start, end),
          calendarIntegration.getOutlookCalendarEvents('mock-token', start, end),
          calendarIntegration.getAppleCalendarEvents('mock-token', start, end),
        ]);
        events = [...googleEvents, ...outlookEvents, ...appleEvents];
    }
    
    console.log(`✅ Found ${events.length} calendar events`);
    
    res.json({
      success: true,
      events: events,
      count: events.length,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching calendar events:', error);
    res.status(500).json({ 
      message: 'Server error fetching calendar events',
      error: error.message 
    });
  }
});

// @desc    Map calendar events to status schedules
// @route   POST /api/calendar/map-to-status
// @access  Private
router.post('/map-to-status', protect, async (req, res) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ 
        message: 'Events array is required' 
      });
    }
    
    console.log(`🔄 Mapping ${events.length} calendar events to status schedules`);
    
    const statusSchedules = calendarIntegration.mapEventsToStatusSchedules(events);
    
    console.log(`✅ Mapped to ${statusSchedules.length} status schedules`);
    
    res.json({
      success: true,
      statusSchedules: statusSchedules,
      count: statusSchedules.length
    });
    
  } catch (error) {
    console.error('❌ Error mapping calendar events to status:', error);
    res.status(500).json({ 
      message: 'Server error mapping calendar events',
      error: error.message 
    });
  }
});

// @desc    Get calendar analytics
// @route   GET /api/calendar/analytics
// @access  Private
router.get('/analytics', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Start date and end date are required' 
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    console.log(`📊 Generating calendar analytics from ${start.toISOString()} to ${end.toISOString()}`);
    
    // Get all calendar events
    const [googleEvents, outlookEvents, appleEvents] = await Promise.all([
      calendarIntegration.getGoogleCalendarEvents('mock-token', start, end),
      calendarIntegration.getOutlookCalendarEvents('mock-token', start, end),
      calendarIntegration.getAppleCalendarEvents('mock-token', start, end),
    ]);
    
    const allEvents = [...googleEvents, ...outlookEvents, ...appleEvents];
    
    // Calculate analytics
    const analytics = {
      totalEvents: allEvents.length,
      eventsByProvider: {
        google: googleEvents.length,
        outlook: outlookEvents.length,
        apple: appleEvents.length
      },
      eventsByType: {},
      busyHours: 0,
      freeHours: 0,
      averageEventDuration: 0
    };
    
    // Calculate event types and durations
    let totalDuration = 0;
    allEvents.forEach(event => {
      const duration = (event.end.getTime() - event.start.getTime()) / (1000 * 60 * 60); // hours
      totalDuration += duration;
      
      // Categorize event type
      const title = event.title.toLowerCase();
      let type = 'other';
      if (title.includes('meeting') || title.includes('call')) type = 'meeting';
      else if (title.includes('lunch') || title.includes('dinner')) type = 'meal';
      else if (title.includes('workout') || title.includes('gym')) type = 'exercise';
      else if (title.includes('travel') || title.includes('commute')) type = 'travel';
      
      analytics.eventsByType[type] = (analytics.eventsByType[type] || 0) + 1;
    });
    
    analytics.averageEventDuration = allEvents.length > 0 ? totalDuration / allEvents.length : 0;
    analytics.busyHours = totalDuration;
    
    // Calculate free hours (assuming 16 waking hours per day)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const totalWakingHours = days * 16;
    analytics.freeHours = Math.max(0, totalWakingHours - analytics.busyHours);
    
    console.log(`✅ Calendar analytics generated:`, analytics);
    
    res.json({
      success: true,
      analytics: analytics,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error generating calendar analytics:', error);
    res.status(500).json({ 
      message: 'Server error generating calendar analytics',
      error: error.message 
    });
  }
});

module.exports = router;
