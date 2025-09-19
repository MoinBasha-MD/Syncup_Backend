/**
 * Status Suggestions
 * Provides ML-based status suggestions based on user patterns
 */
const StatusHistory = require('../models/statusHistoryModel');
const { BadRequestError } = require('./errorClasses');

class StatusSuggestions {
  /**
   * Get status suggestions based on user's history
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - Status suggestions
   */
  async getSuggestions(userId) {
    try {
      // Get user's status history
      const statusHistory = await StatusHistory.find({ user: userId })
        .sort({ startTime: -1 })
        .limit(100);
      
      if (statusHistory.length === 0) {
        return {
          suggestions: [],
          confidence: 0,
          message: 'Not enough history to generate suggestions'
        };
      }
      
      // Analyze patterns based on time of day
      const timeBasedSuggestions = await this.analyzeTimePatterns(statusHistory);
      
      // Analyze patterns based on day of week
      const dayBasedSuggestions = await this.analyzeDayPatterns(statusHistory);
      
      // Analyze patterns based on duration
      const durationBasedSuggestions = await this.analyzeDurationPatterns(statusHistory);
      
      // Combine suggestions with confidence scores
      const combinedSuggestions = this.combineSuggestions([
        timeBasedSuggestions,
        dayBasedSuggestions,
        durationBasedSuggestions
      ]);
      
      return {
        suggestions: combinedSuggestions.slice(0, 3), // Return top 3 suggestions
        confidence: combinedSuggestions.length > 0 ? combinedSuggestions[0].confidence : 0,
        message: combinedSuggestions.length > 0 
          ? 'Suggestions based on your usage patterns' 
          : 'Not enough patterns detected to make suggestions'
      };
    } catch (error) {
      console.error('Error generating status suggestions:', error);
      throw new BadRequestError('Failed to generate status suggestions');
    }
  }

  /**
   * Analyze time-based patterns
   * @param {Array} history - Status history
   * @returns {Promise<Array>} - Time-based suggestions
   */
  async analyzeTimePatterns(history) {
    // Group statuses by hour of day
    const hourlyPatterns = {};
    
    history.forEach(entry => {
      const hour = new Date(entry.startTime).getHours();
      
      if (!hourlyPatterns[hour]) {
        hourlyPatterns[hour] = {};
      }
      
      if (!hourlyPatterns[hour][entry.status]) {
        hourlyPatterns[hour][entry.status] = 0;
      }
      
      hourlyPatterns[hour][entry.status]++;
    });
    
    // Find most common status for each hour
    const currentHour = new Date().getHours();
    const suggestions = [];
    
    // Check current hour
    if (hourlyPatterns[currentHour]) {
      const statuses = Object.keys(hourlyPatterns[currentHour]);
      
      statuses.forEach(status => {
        const count = hourlyPatterns[currentHour][status];
        const total = statuses.reduce((sum, s) => sum + hourlyPatterns[currentHour][s], 0);
        const confidence = count / total;
        
        suggestions.push({
          status,
          confidence: Math.round(confidence * 100) / 100,
          reason: `You're usually ${status} at this time of day`,
          type: 'time'
        });
      });
    }
    
    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze day-based patterns
   * @param {Array} history - Status history
   * @returns {Promise<Array>} - Day-based suggestions
   */
  async analyzeDayPatterns(history) {
    // Group statuses by day of week
    const dayPatterns = {};
    
    history.forEach(entry => {
      const day = new Date(entry.startTime).getDay();
      
      if (!dayPatterns[day]) {
        dayPatterns[day] = {};
      }
      
      if (!dayPatterns[day][entry.status]) {
        dayPatterns[day][entry.status] = 0;
      }
      
      dayPatterns[day][entry.status]++;
    });
    
    // Find most common status for current day
    const currentDay = new Date().getDay();
    const suggestions = [];
    
    // Check current day
    if (dayPatterns[currentDay]) {
      const statuses = Object.keys(dayPatterns[currentDay]);
      
      statuses.forEach(status => {
        const count = dayPatterns[currentDay][status];
        const total = statuses.reduce((sum, s) => sum + dayPatterns[currentDay][s], 0);
        const confidence = count / total;
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        suggestions.push({
          status,
          confidence: Math.round(confidence * 100) / 100,
          reason: `You're often ${status} on ${days[currentDay]}s`,
          type: 'day'
        });
      });
    }
    
    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze duration-based patterns
   * @param {Array} history - Status history
   * @returns {Promise<Array>} - Duration-based suggestions
   */
  async analyzeDurationPatterns(history) {
    // Group by status and calculate average duration
    const durationPatterns = {};
    
    history.forEach(entry => {
      if (!durationPatterns[entry.status]) {
        durationPatterns[entry.status] = {
          totalDuration: 0,
          count: 0
        };
      }
      
      durationPatterns[entry.status].totalDuration += entry.duration;
      durationPatterns[entry.status].count++;
    });
    
    // Calculate average durations
    const suggestions = [];
    
    Object.keys(durationPatterns).forEach(status => {
      const pattern = durationPatterns[status];
      const avgDuration = Math.round(pattern.totalDuration / pattern.count);
      
      // Calculate confidence based on frequency
      const confidence = pattern.count / history.length;
      
      suggestions.push({
        status,
        duration: avgDuration,
        confidence: Math.round(confidence * 100) / 100,
        reason: `You typically stay ${status} for about ${avgDuration} minutes`,
        type: 'duration'
      });
    });
    
    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Combine suggestions from different analyses
   * @param {Array} suggestionSets - Sets of suggestions
   * @returns {Array} - Combined suggestions
   */
  combineSuggestions(suggestionSets) {
    // Flatten all suggestions
    const allSuggestions = suggestionSets.flat();
    
    // Group by status
    const groupedSuggestions = {};
    
    allSuggestions.forEach(suggestion => {
      if (!groupedSuggestions[suggestion.status]) {
        groupedSuggestions[suggestion.status] = {
          status: suggestion.status,
          confidence: 0,
          reasons: [],
          duration: suggestion.duration || null
        };
      }
      
      // Combine confidence scores with weights
      // Time-based patterns have highest weight
      const weight = suggestion.type === 'time' ? 0.5 : 
                    suggestion.type === 'day' ? 0.3 : 0.2;
      
      groupedSuggestions[suggestion.status].confidence += suggestion.confidence * weight;
      
      // Add reason if not already included
      if (!groupedSuggestions[suggestion.status].reasons.includes(suggestion.reason)) {
        groupedSuggestions[suggestion.status].reasons.push(suggestion.reason);
      }
    });
    
    // Convert back to array and sort by confidence
    const combined = Object.values(groupedSuggestions);
    
    // Normalize confidence scores
    combined.forEach(suggestion => {
      suggestion.confidence = Math.min(Math.round(suggestion.confidence * 100) / 100, 1);
    });
    
    return combined.sort((a, b) => b.confidence - a.confidence);
  }
}

module.exports = new StatusSuggestions();
