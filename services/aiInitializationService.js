const AIAssistant = require('../models/aiAssistantModel');
const User = require('../models/userModel');

/**
 * AI Initialization Service
 * Handles AI creation and setup for new users
 */

class AIInitializationService {
  
  /**
   * Initialize AI for a new user during registration
   */
  static async initializeUserAI(userId, preferences = {}) {
    try {
      console.log(`🤖 Initializing AI for new user: ${userId}`);
      
      // Check if AI already exists
      const existingAI = await AIAssistant.findByUserId(userId);
      if (existingAI) {
        console.log(`✅ AI already exists for user ${userId}: ${existingAI.aiName}`);
        return existingAI;
      }
      
      // Get user details
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      // Create new AI with default settings
      const aiData = {
        userId,
        aiName: preferences.aiName || 'Diya',
        personality: preferences.personality || 'friendly',
        privacySettings: {
          // Default privacy settings - conservative approach
          shareStatus: true,
          shareCalendarAvailability: true,
          shareTimePreferences: false,
          shareGeneralLocation: false,
          shareSpecificLocation: false,
          shareTravelStatus: true,
          shareActivityPreferences: false,
          shareDietaryInfo: false,
          shareInterests: false,
          shareResponseStyle: false,
          shareUrgencyPreferences: true,
          shareContactMethods: false,
          shareWorkHours: true,
          shareMeetingPreferences: false,
          shareProjectAvailability: false
        },
        learningData: {
          communicationStyle: 'adaptive',
          commonPhrases: [],
          responsePatterns: {},
          userPreferences: preferences.userPreferences || {}
        }
      };
      
      const newAI = new AIAssistant(aiData);
      await newAI.save();
      
      console.log(`🎉 AI successfully created for user ${user.name}: ${newAI.aiName} (${newAI.aiId})`);
      
      return newAI;
      
    } catch (error) {
      console.error('Error initializing user AI:', error);
      throw error;
    }
  }
  
  /**
   * Bulk initialize AIs for existing users who don't have one
   */
  static async initializeExistingUsers() {
    try {
      console.log('🔄 Starting bulk AI initialization for existing users...');
      
      // Find users without AI assistants
      const existingAIUserIds = await AIAssistant.distinct('userId');
      const usersWithoutAI = await User.find({
        _id: { $nin: existingAIUserIds },
        isActive: true
      }).select('_id name');
      
      console.log(`📊 Found ${usersWithoutAI.length} users without AI assistants`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const user of usersWithoutAI) {
        try {
          await this.initializeUserAI(user._id);
          successCount++;
          console.log(`✅ AI initialized for ${user.name} (${successCount}/${usersWithoutAI.length})`);
        } catch (error) {
          errorCount++;
          console.error(`❌ Failed to initialize AI for ${user.name}:`, error.message);
        }
      }
      
      console.log(`🎯 Bulk initialization complete: ${successCount} success, ${errorCount} errors`);
      
      return {
        total: usersWithoutAI.length,
        success: successCount,
        errors: errorCount
      };
      
    } catch (error) {
      console.error('Error in bulk AI initialization:', error);
      throw error;
    }
  }
  
  /**
   * Update AI privacy settings with user preferences
   */
  static async updateAIPrivacySettings(userId, privacyUpdates) {
    try {
      const ai = await AIAssistant.findByUserId(userId);
      if (!ai) {
        throw new Error('AI assistant not found');
      }
      
      // Merge with existing settings
      ai.privacySettings = {
        ...ai.privacySettings,
        ...privacyUpdates
      };
      
      await ai.save();
      
      console.log(`🔒 Privacy settings updated for AI ${ai.aiName} (${userId})`);
      
      return ai.privacySettings;
      
    } catch (error) {
      console.error('Error updating AI privacy settings:', error);
      throw error;
    }
  }
  
  /**
   * Get AI configuration for a user
   */
  static async getAIConfig(userId) {
    try {
      const ai = await AIAssistant.findByUserId(userId);
      if (!ai) {
        // Initialize AI if it doesn't exist
        return await this.initializeUserAI(userId);
      }
      
      return ai;
      
    } catch (error) {
      console.error('Error getting AI config:', error);
      throw error;
    }
  }
  
  /**
   * Update AI learning data based on user interactions
   */
  static async updateAILearning(userId, learningUpdate) {
    try {
      const ai = await AIAssistant.findByUserId(userId);
      if (!ai) {
        throw new Error('AI assistant not found');
      }
      
      // Update learning data
      if (learningUpdate.communicationStyle) {
        ai.learningData.communicationStyle = learningUpdate.communicationStyle;
      }
      
      if (learningUpdate.commonPhrases) {
        ai.learningData.commonPhrases = [
          ...new Set([...ai.learningData.commonPhrases, ...learningUpdate.commonPhrases])
        ];
      }
      
      if (learningUpdate.responsePatterns) {
        ai.learningData.responsePatterns = {
          ...ai.learningData.responsePatterns,
          ...learningUpdate.responsePatterns
        };
      }
      
      if (learningUpdate.userPreferences) {
        ai.learningData.userPreferences = {
          ...ai.learningData.userPreferences,
          ...learningUpdate.userPreferences
        };
      }
      
      await ai.save();
      
      console.log(`🧠 Learning data updated for AI ${ai.aiName} (${userId})`);
      
      return ai.learningData;
      
    } catch (error) {
      console.error('Error updating AI learning:', error);
      throw error;
    }
  }
  
  /**
   * Get AI statistics
   */
  static async getAIStats() {
    try {
      const totalAIs = await AIAssistant.countDocuments();
      const activeAIs = await AIAssistant.countDocuments({ isActive: true });
      const onlineAIs = await AIAssistant.countDocuments({ isOnline: true });
      
      const personalityStats = await AIAssistant.aggregate([
        { $group: { _id: '$personality', count: { $sum: 1 } } }
      ]);
      
      return {
        total: totalAIs,
        active: activeAIs,
        online: onlineAIs,
        personalities: personalityStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      };
      
    } catch (error) {
      console.error('Error getting AI stats:', error);
      throw error;
    }
  }
}

module.exports = AIInitializationService;
