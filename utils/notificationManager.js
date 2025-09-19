/**
 * Notification Manager
 * Handles sending notifications to users about status changes
 */
const User = require('../models/userModel');
const { BadRequestError } = require('./errorClasses');

class NotificationManager {
  /**
   * Send a notification about an upcoming status change
   * @param {Object} user - User object
   * @param {Object} statusSchedule - Status schedule object
   * @returns {Promise<Object>} - Notification result
   */
  async sendStatusChangeNotification(user, statusSchedule) {
    try {
      // In a real implementation, this would integrate with:
      // - Push notifications
      // - Email notifications
      // - SMS notifications
      // - In-app notifications
      
      // For now, we'll just log the notification
      console.log(`[NOTIFICATION] Status change for user ${user.name} (${user._id})`);
      console.log(`Status will change to: ${statusSchedule.status}`);
      console.log(`At: ${new Date(statusSchedule.startTime).toLocaleString()}`);
      
      return {
        success: true,
        userId: user._id,
        notificationType: 'status_change',
        message: `Your status will change to ${statusSchedule.status} at ${new Date(statusSchedule.startTime).toLocaleString()}`,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw new BadRequestError('Failed to send notification');
    }
  }

  /**
   * Send a notification about a status expiration
   * @param {Object} user - User object
   * @returns {Promise<Object>} - Notification result
   */
  async sendStatusExpirationNotification(user) {
    try {
      // Log the notification
      console.log(`[NOTIFICATION] Status expired for user ${user.name} (${user._id})`);
      console.log(`Status changed to: available`);
      
      return {
        success: true,
        userId: user._id,
        notificationType: 'status_expiration',
        message: `Your status has expired and changed to available`,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw new BadRequestError('Failed to send notification');
    }
  }

  /**
   * Send a notification about a status suggestion
   * @param {Object} user - User object
   * @param {Object} suggestion - Status suggestion object
   * @returns {Promise<Object>} - Notification result
   */
  async sendStatusSuggestionNotification(user, suggestion) {
    try {
      // Log the notification
      console.log(`[NOTIFICATION] Status suggestion for user ${user.name} (${user._id})`);
      console.log(`Suggested status: ${suggestion.status}`);
      
      return {
        success: true,
        userId: user._id,
        notificationType: 'status_suggestion',
        message: `Based on your patterns, we suggest changing your status to ${suggestion.status}`,
        suggestion,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw new BadRequestError('Failed to send notification');
    }
  }

  /**
   * Send a notification about a calendar sync
   * @param {Object} user - User object
   * @param {Array} schedules - Created schedules
   * @returns {Promise<Object>} - Notification result
   */
  async sendCalendarSyncNotification(user, schedules) {
    try {
      // Log the notification
      console.log(`[NOTIFICATION] Calendar sync for user ${user.name} (${user._id})`);
      console.log(`Created ${schedules.length} status schedules`);
      
      return {
        success: true,
        userId: user._id,
        notificationType: 'calendar_sync',
        message: `Successfully synced ${schedules.length} events from your calendar`,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      throw new BadRequestError('Failed to send notification');
    }
  }
}

module.exports = new NotificationManager();
