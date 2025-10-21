const winston = require('winston');
const User = require('../../models/userModel');
const Message = require('../../models/Message');
const Post = require('../../models/postModel');
const StatusHistory = require('../../models/statusHistoryModel');

// Configure logger for Personalization Agent
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/personalization-agent.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class PersonalizationAgent {
  constructor() {
    this.agentId = null;
    this.isActive = false;
    this.userProfiles = new Map(); // User behavior profiles
    this.preferences = new Map(); // User preferences
    this.recommendations = new Map(); // Generated recommendations
    
    this.metrics = {
      profilesGenerated: 0,
      recommendationsCreated: 0,
      preferencesLearned: 0,
      averageProcessingTime: 0,
      accuracyScore: 0
    };
    
    this.config = {
      learningWindow: 30, // days
      minInteractions: 10,
      recommendationLimit: 20,
      profileUpdateInterval: 24 * 60 * 60 * 1000 // 24 hours
    };
  }

  /**
   * Initialize the personalization agent
   */
  async initialize(agentId) {
    this.agentId = agentId;
    this.isActive = true;
    
    logger.info(`🎯 Personalization Agent ${agentId} initialized`);
    
    // Load existing user profiles
    await this.loadUserProfiles();
    
    // Start periodic profile updates
    this.startPeriodicUpdates();
  }

  /**
   * Process a personalization task
   */
  async processTask(payload, context) {
    const startTime = Date.now();
    
    try {
      const { action, data } = payload;
      let result;
      
      switch (action) {
        case 'generate_user_profile':
          result = await this.generateUserProfile(data, context);
          break;
        case 'update_preferences':
          result = await this.updateUserPreferences(data, context);
          break;
        case 'get_recommendations':
          result = await this.getPersonalizedRecommendations(data, context);
          break;
        case 'learn_from_interaction':
          result = await this.learnFromInteraction(data, context);
          break;
        case 'customize_content':
          result = await this.customizeContent(data, context);
          break;
        case 'predict_behavior':
          result = await this.predictUserBehavior(data, context);
          break;
        default:
          throw new Error(`Unknown personalization action: ${action}`);
      }
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      
      return result;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      logger.error(`❌ Personalization task failed:`, error);
      throw error;
    }
  }

  /**
   * Generate comprehensive user profile
   */
  async generateUserProfile(data, context) {
    const { userId, includeRecommendations = true } = data;
    
    try {
      // Get user data
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Analyze user behavior patterns
      const behaviorAnalysis = await this.analyzeUserBehavior(userId);
      
      // Generate interest profile
      const interests = await this.extractUserInterests(userId);
      
      // Analyze communication patterns
      const communicationStyle = await this.analyzeCommunicationStyle(userId);
      
      // Determine user preferences
      const preferences = await this.inferUserPreferences(userId);
      
      // Create comprehensive profile
      const profile = {
        userId,
        generatedAt: new Date(),
        behavior: behaviorAnalysis,
        interests: interests,
        communication: communicationStyle,
        preferences: preferences,
        demographics: {
          accountAge: Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24)),
          activityLevel: behaviorAnalysis.activityLevel,
          engagementScore: behaviorAnalysis.engagementScore
        },
        personality: await this.inferPersonalityTraits(userId, behaviorAnalysis),
        recommendations: includeRecommendations ? await this.generateRecommendations(userId) : null
      };
      
      // Store profile
      this.userProfiles.set(userId, profile);
      this.metrics.profilesGenerated++;
      
      logger.info(`👤 Generated profile for user ${userId}`);
      
      return {
        profile,
        confidence: this.calculateProfileConfidence(profile),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ User profile generation failed:', error);
      throw error;
    }
  }

  /**
   * Get personalized recommendations
   */
  async getPersonalizedRecommendations(data, context) {
    const { userId, type = 'all', limit = 10 } = data;
    
    try {
      // Get or generate user profile
      let profile = this.userProfiles.get(userId);
      if (!profile) {
        const profileResult = await this.generateUserProfile({ userId }, context);
        profile = profileResult.profile;
      }
      
      const recommendations = {
        userId,
        type,
        generatedAt: new Date(),
        items: []
      };
      
      // Generate different types of recommendations
      if (type === 'all' || type === 'connections') {
        const connectionRecs = await this.recommendConnections(userId, profile);
        recommendations.items.push(...connectionRecs.map(rec => ({ ...rec, type: 'connection' })));
      }
      
      if (type === 'all' || type === 'content') {
        const contentRecs = await this.recommendContent(userId, profile);
        recommendations.items.push(...contentRecs.map(rec => ({ ...rec, type: 'content' })));
      }
      
      if (type === 'all' || type === 'features') {
        const featureRecs = await this.recommendFeatures(userId, profile);
        recommendations.items.push(...featureRecs.map(rec => ({ ...rec, type: 'feature' })));
      }
      
      // Sort by relevance score
      recommendations.items.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      
      // Limit results
      recommendations.items = recommendations.items.slice(0, limit);
      
      // Store recommendations
      this.recommendations.set(userId, recommendations);
      this.metrics.recommendationsCreated++;
      
      return {
        recommendations,
        profile: {
          interests: profile.interests,
          preferences: profile.preferences
        },
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Personalized recommendations failed:', error);
      throw error;
    }
  }

  /**
   * Learn from user interaction
   */
  async learnFromInteraction(data, context) {
    const { userId, interactionType, target, feedback, metadata = {} } = data;
    
    try {
      // Get existing profile
      let profile = this.userProfiles.get(userId) || { preferences: {}, interests: [] };
      
      // Update based on interaction type
      switch (interactionType) {
        case 'like':
          await this.updateInterestFromLike(userId, target, metadata);
          break;
        case 'share':
          await this.updateInterestFromShare(userId, target, metadata);
          break;
        case 'message':
          await this.updateCommunicationPreferences(userId, target, metadata);
          break;
        case 'search':
          await this.updateSearchPreferences(userId, target, metadata);
          break;
        case 'recommendation_click':
          await this.updateRecommendationFeedback(userId, target, 'positive');
          break;
        case 'recommendation_dismiss':
          await this.updateRecommendationFeedback(userId, target, 'negative');
          break;
      }
      
      // Update learning metrics
      this.metrics.preferencesLearned++;
      
      return {
        userId,
        interactionType,
        learned: true,
        profileUpdated: true,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Learning from interaction failed:', error);
      throw error;
    }
  }

  /**
   * Customize content for user
   */
  async customizeContent(data, context) {
    const { userId, contentType, content, options = {} } = data;
    
    try {
      // Get user profile
      const profile = this.userProfiles.get(userId);
      if (!profile) {
        return { content, customized: false, reason: 'No profile available' };
      }
      
      let customizedContent = { ...content };
      
      // Apply customizations based on content type
      switch (contentType) {
        case 'feed':
          customizedContent = await this.customizeFeed(content, profile, options);
          break;
        case 'notifications':
          customizedContent = await this.customizeNotifications(content, profile, options);
          break;
        case 'ui':
          customizedContent = await this.customizeUI(content, profile, options);
          break;
        case 'recommendations':
          customizedContent = await this.customizeRecommendations(content, profile, options);
          break;
      }
      
      return {
        userId,
        contentType,
        originalContent: content,
        customizedContent,
        customizations: this.getAppliedCustomizations(content, customizedContent),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Content customization failed:', error);
      throw error;
    }
  }

  /**
   * Analyze user data for personalization insights
   */
  async analyzeData(payload, context) {
    const { analysisType, userId, data } = payload;
    
    try {
      let result;
      
      switch (analysisType) {
        case 'behavior_patterns':
          result = await this.analyzeUserBehavior(userId);
          break;
        case 'preference_evolution':
          result = await this.analyzePreferenceEvolution(userId);
          break;
        case 'engagement_optimization':
          result = await this.analyzeEngagementOptimization(userId);
          break;
        default:
          throw new Error(`Unknown analysis type: ${analysisType}`);
      }
      
      return result;
      
    } catch (error) {
      logger.error('❌ Personalization analysis failed:', error);
      throw error;
    }
  }

  /**
   * Monitor personalization system
   */
  async monitorSystem(payload, context) {
    try {
      const monitoring = {
        profiles: {
          total: this.userProfiles.size,
          generated: this.metrics.profilesGenerated,
          averageAge: this.calculateAverageProfileAge()
        },
        recommendations: {
          total: this.recommendations.size,
          created: this.metrics.recommendationsCreated,
          averageRelevance: this.calculateAverageRelevance()
        },
        learning: {
          interactionsLearned: this.metrics.preferencesLearned,
          accuracyScore: this.metrics.accuracyScore,
          improvementRate: this.calculateImprovementRate()
        },
        performance: {
          averageProcessingTime: this.metrics.averageProcessingTime,
          memoryUsage: process.memoryUsage().heapUsed,
          profileUpdateRate: this.calculateProfileUpdateRate()
        }
      };
      
      // Generate alerts
      const alerts = [];
      
      if (monitoring.learning.accuracyScore < 0.7) {
        alerts.push({
          type: 'low_accuracy_score',
          severity: 'warning',
          value: monitoring.learning.accuracyScore
        });
      }
      
      if (monitoring.performance.averageProcessingTime > 2000) {
        alerts.push({
          type: 'slow_processing',
          severity: 'warning',
          value: monitoring.performance.averageProcessingTime
        });
      }
      
      monitoring.alerts = alerts;
      
      return monitoring;
      
    } catch (error) {
      logger.error('❌ Personalization monitoring failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the personalization agent
   */
  async healthCheck() {
    return {
      status: this.isActive ? 'healthy' : 'inactive',
      userProfiles: this.userProfiles.size,
      recommendations: this.recommendations.size,
      preferences: this.preferences.size,
      metrics: this.metrics,
      lastActivity: new Date()
    };
  }

  // Helper methods

  /**
   * Analyze user behavior patterns
   */
  async analyzeUserBehavior(userId) {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (this.config.learningWindow * 24 * 60 * 60 * 1000));
      
      // Get user activity data
      const [messages, posts, statusUpdates] = await Promise.all([
        Message.find({
          $or: [{ senderId: userId }, { receiverId: userId }],
          timestamp: { $gte: startDate, $lte: endDate }
        }).lean(),
        Post.find({
          userId,
          createdAt: { $gte: startDate, $lte: endDate }
        }).lean(),
        StatusHistory.find({
          userId,
          timestamp: { $gte: startDate, $lte: endDate }
        }).lean()
      ]);
      
      // Analyze patterns
      const behavior = {
        activityLevel: this.calculateActivityLevel(messages, posts, statusUpdates),
        engagementScore: this.calculateEngagementScore(messages, posts),
        communicationFrequency: messages.length,
        contentCreationRate: posts.length,
        statusUpdateFrequency: statusUpdates.length,
        peakActivityHours: this.findPeakActivityHours(messages, posts, statusUpdates),
        preferredContentTypes: this.analyzeContentPreferences(posts),
        socialInteractionStyle: this.analyzeSocialStyle(messages)
      };
      
      return behavior;
      
    } catch (error) {
      logger.error('❌ Behavior analysis failed:', error);
      return {};
    }
  }

  /**
   * Load existing user profiles
   */
  async loadUserProfiles() {
    try {
      // In a real implementation, this would load from database
      logger.info('📋 Loading existing user profiles...');
      
      // For now, we'll start with empty profiles
      logger.info('✅ User profiles loaded');
      
    } catch (error) {
      logger.error('❌ Failed to load user profiles:', error);
    }
  }

  /**
   * Start periodic profile updates
   */
  startPeriodicUpdates() {
    setInterval(async () => {
      try {
        // Update profiles for active users
        const activeUsers = Array.from(this.userProfiles.keys()).slice(0, 10); // Limit to prevent overload
        
        for (const userId of activeUsers) {
          await this.generateUserProfile({ userId, includeRecommendations: false }, {});
        }
        
        logger.info(`🔄 Updated ${activeUsers.length} user profiles`);
        
      } catch (error) {
        logger.error('❌ Periodic profile update failed:', error);
      }
    }, this.config.profileUpdateInterval);
  }

  /**
   * Calculate activity level
   */
  calculateActivityLevel(messages, posts, statusUpdates) {
    const totalActivity = messages.length + posts.length + statusUpdates.length;
    
    if (totalActivity >= 100) return 'high';
    if (totalActivity >= 50) return 'medium';
    if (totalActivity >= 10) return 'low';
    return 'minimal';
  }

  /**
   * Calculate engagement score
   */
  calculateEngagementScore(messages, posts) {
    const messageScore = Math.min(messages.length / 10, 50);
    const postScore = Math.min(posts.length * 5, 50);
    
    return Math.round(messageScore + postScore);
  }

  /**
   * Update agent metrics
   */
  updateMetrics(processingTime, success) {
    if (success) {
      const totalTasks = this.metrics.profilesGenerated + this.metrics.recommendationsCreated;
      this.metrics.averageProcessingTime = 
        ((this.metrics.averageProcessingTime * totalTasks) + processingTime) / (totalTasks + 1);
    }
  }

  /**
   * Calculate profile confidence
   */
  calculateProfileConfidence(profile) {
    let confidence = 0;
    
    if (profile.behavior?.activityLevel !== 'minimal') confidence += 0.3;
    if (profile.interests?.length > 0) confidence += 0.3;
    if (profile.communication?.style) confidence += 0.2;
    if (profile.preferences && Object.keys(profile.preferences).length > 0) confidence += 0.2;
    
    return Math.round(confidence * 100) / 100;
  }
}

module.exports = PersonalizationAgent;
