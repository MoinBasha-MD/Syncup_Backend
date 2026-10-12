/**
 * Calendar Integration
 * Handles integration with calendar services to sync status with calendar events
 */
const { mapEventToStatus } = require('../services/calendar/statusMapping');

class CalendarIntegration {
  /**
   * Get events from Google Calendar using a raw OAuth access token.
   * @param {string} accessToken - Google OAuth access token
   * @param {Date} startDate - Start date for events
   * @param {Date} endDate - End date for events
   * @returns {Promise<Array>} - Calendar events
   */
  async getGoogleCalendarEvents(accessToken, startDate, endDate) {
    try {
      const axios = require('axios');
      const response = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          maxResults: 250,
          singleEvents: true,
          orderBy: 'startTime',
        },
        timeout: 20000,
      });
      return (response.data.items || []).map(item => ({
        id: item.id,
        title: item.summary || '(no title)',
        start: new Date((item.start || {}).dateTime || `${(item.start || {}).date}T00:00:00Z`),
        end: new Date((item.end || {}).dateTime || `${(item.end || {}).date}T00:00:00Z`),
        recurring: !!(item.recurrence || []).length,
        source: 'google',
      }));
    } catch (error) {
      console.error('Error fetching Google Calendar events:', error.message);
      return [];
    }
  }

  /**
   * Get events from Microsoft Outlook Calendar using a raw access token.
   * @param {string} accessToken - Microsoft OAuth access token
   * @param {Date} startDate - Start date for events
   * @param {Date} endDate - End date for events
   * @returns {Promise<Array>} - Calendar events
   */
  async getOutlookCalendarEvents(accessToken, startDate, endDate) {
    try {
      const axios = require('axios');
      const response = await axios.get('https://graph.microsoft.com/v1.0/me/calendarView', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          startDateTime: startDate.toISOString(),
          endDateTime: endDate.toISOString(),
          $top: 100,
        },
        timeout: 20000,
      });
      return (response.data.value || []).map(item => ({
        id: item.id,
        title: item.subject || '(no title)',
        start: new Date(`${(item.start || {}).dateTime}Z`),
        end: new Date(`${(item.end || {}).dateTime}Z`),
        recurring: !!item.recurrence,
        source: 'outlook',
      }));
    } catch (error) {
      console.error('Error fetching Outlook Calendar events:', error.message);
      return [];
    }
  }

  /**
   * Apple calendar is covered by on-device calendar sync — nothing to fetch here.
   */
  async getAppleCalendarEvents(accessToken, startDate, endDate) {
    return [];
  }

  /**
   * Map calendar events to status schedules
   * @param {Array} events - Calendar events
   * @returns {Array} - Status schedules
   */
  mapEventsToStatusSchedules(events) {
    return events.map(event => {
      const { status, customStatus } = mapEventToStatus(event);
      return {
        status,
        customStatus,
        startTime: event.start,
        endTime: event.end,
        repeat: event.recurring ? 'weekly' : 'none',
        active: true
      };
    });
  }
}

const instance = new CalendarIntegration();
module.exports = instance;
module.exports.mapEventsToStatusSchedules = instance.mapEventsToStatusSchedules.bind(instance);
