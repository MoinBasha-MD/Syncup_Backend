const winston = require('winston');
const User = require('../../models/userModel');
const Message = require('../../models/Message');
const Post = require('../../models/postModel');

// Configure logger for Search Agent
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/search-agent.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class SearchAgent {
  constructor() {
    this.agentId = null;
    this.isActive = false;
    this.searchIndex = new Map(); // In-memory search index
    this.searchCache = new Map(); // Cache for frequent searches
    this.searchHistory = new Map(); // User search history
    
    this.metrics = {
      searchesProcessed: 0,
      indexUpdates: 0,
      cacheHits: 0,
      averageSearchTime: 0,
      indexSize: 0
    };
    
    this.config = {
      maxCacheSize: 1000,
      cacheExpiry: 5 * 60 * 1000, // 5 minutes
      indexUpdateInterval: 10 * 60 * 1000, // 10 minutes
      maxSearchResults: 50
    };
  }

  /**
   * Initialize the search agent
   */
  async initialize(agentId) {
    this.agentId = agentId;
    this.isActive = true;
    
    logger.info(`🔍 Search Agent ${agentId} initialized`);
    
    // Build initial search index
    await this.buildSearchIndex();
    
    // Start periodic index updates
    this.startPeriodicIndexing();
  }

  /**
   * Process a search task
   */
  async processTask(payload, context) {
    const startTime = Date.now();
    
    try {
      const { action, data } = payload;
      let result;
      
      switch (action) {
        case 'search_users':
          result = await this.searchUsers(data, context);
          break;
        case 'search_messages':
          result = await this.searchMessages(data, context);
          break;
        case 'search_posts':
          result = await this.searchPosts(data, context);
          break;
        case 'global_search':
          result = await this.globalSearch(data, context);
          break;
        case 'update_index':
          result = await this.updateSearchIndex(data, context);
          break;
        case 'get_search_suggestions':
          result = await this.getSearchSuggestions(data, context);
          break;
        default:
          throw new Error(`Unknown search action: ${action}`);
      }
      
      const searchTime = Date.now() - startTime;
      this.updateMetrics(searchTime, true);
      
      return result;
      
    } catch (error) {
      const searchTime = Date.now() - startTime;
      this.updateMetrics(searchTime, false);
      
      logger.error(`❌ Search task failed:`, error);
      throw error;
    }
  }

  /**
   * Search for users
   */
  async searchUsers(data, context) {
    const { query, filters = {}, limit = 20, userId } = data;
    
    try {
      // Check cache first
      const cacheKey = `users:${query}:${JSON.stringify(filters)}:${limit}`;
      if (this.searchCache.has(cacheKey)) {
        const cached = this.searchCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.config.cacheExpiry) {
          this.metrics.cacheHits++;
          return cached.data;
        }
      }
      
      // Build search criteria
      const searchCriteria = {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
          { phoneNumber: { $regex: query, $options: 'i' } }
        ]
      };
      
      // Apply filters
      if (filters.isActive !== undefined) {
        searchCriteria.isActive = filters.isActive;
      }
      
      if (filters.accountType) {
        searchCriteria.accountType = filters.accountType;
      }
      
      // Execute search
      const users = await User.find(searchCriteria)
        .select('userId name email profilePicture isActive accountType createdAt')
        .limit(limit)
        .lean();
      
      // Enhance results with relevance scoring
      const enhancedResults = users.map(user => ({
        ...user,
        relevanceScore: this.calculateUserRelevance(user, query),
        matchedFields: this.getMatchedFields(user, query)
      }));
      
      // Sort by relevance
      enhancedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      const result = {
        query,
        results: enhancedResults,
        totalFound: enhancedResults.length,
        searchTime: Date.now() - Date.now(),
        filters: filters,
        success: true
      };
      
      // Cache the result
      this.searchCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      // Update user search history
      if (userId) {
        this.updateSearchHistory(userId, 'users', query);
      }
      
      return result;
      
    } catch (error) {
      logger.error('❌ User search failed:', error);
      throw error;
    }
  }

  /**
   * Search for messages
   */
  async searchMessages(data, context) {
    const { query, userId, filters = {}, limit = 20 } = data;
    
    try {
      const cacheKey = `messages:${userId}:${query}:${JSON.stringify(filters)}:${limit}`;
      if (this.searchCache.has(cacheKey)) {
        const cached = this.searchCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.config.cacheExpiry) {
          this.metrics.cacheHits++;
          return cached.data;
        }
      }
      
      // Build search criteria
      const searchCriteria = {
        $and: [
          {
            $or: [
              { senderId: userId },
              { receiverId: userId }
            ]
          },
          {
            $or: [
              { content: { $regex: query, $options: 'i' } },
              { messageType: { $regex: query, $options: 'i' } }
            ]
          }
        ]
      };
      
      // Apply date filters
      if (filters.startDate || filters.endDate) {
        searchCriteria.timestamp = {};
        if (filters.startDate) {
          searchCriteria.timestamp.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          searchCriteria.timestamp.$lte = new Date(filters.endDate);
        }
      }
      
      // Execute search
      const messages = await Message.find(searchCriteria)
        .populate('senderId', 'name profilePicture')
        .populate('receiverId', 'name profilePicture')
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
      
      const result = {
        query,
        userId,
        results: messages.map(msg => ({
          ...msg,
          relevanceScore: this.calculateMessageRelevance(msg, query),
          snippet: this.generateMessageSnippet(msg.content, query)
        })),
        totalFound: messages.length,
        filters: filters,
        success: true
      };
      
      // Cache the result
      this.searchCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      this.updateSearchHistory(userId, 'messages', query);
      
      return result;
      
    } catch (error) {
      logger.error('❌ Message search failed:', error);
      throw error;
    }
  }

  /**
   * Global search across all content types
   */
  async globalSearch(data, context) {
    const { query, userId, categories = ['users', 'messages', 'posts'], limit = 10 } = data;
    
    try {
      const results = {
        query,
        categories: {},
        totalResults: 0,
        searchTime: 0,
        success: true
      };
      
      const searchPromises = [];
      
      // Search users
      if (categories.includes('users')) {
        searchPromises.push(
          this.searchUsers({ query, limit }, context)
            .then(res => ({ type: 'users', data: res }))
        );
      }
      
      // Search messages
      if (categories.includes('messages') && userId) {
        searchPromises.push(
          this.searchMessages({ query, userId, limit }, context)
            .then(res => ({ type: 'messages', data: res }))
        );
      }
      
      // Search posts
      if (categories.includes('posts')) {
        searchPromises.push(
          this.searchPosts({ query, limit }, context)
            .then(res => ({ type: 'posts', data: res }))
        );
      }
      
      // Execute all searches in parallel
      const searchResults = await Promise.all(searchPromises);
      
      // Combine results
      searchResults.forEach(result => {
        results.categories[result.type] = result.data;
        results.totalResults += result.data.results?.length || 0;
      });
      
      // Generate unified results with cross-category relevance
      results.unified = this.generateUnifiedResults(searchResults, query, limit);
      
      this.updateSearchHistory(userId, 'global', query);
      
      return results;
      
    } catch (error) {
      logger.error('❌ Global search failed:', error);
      throw error;
    }
  }

  /**
   * Get search suggestions based on history and trends
   */
  async getSearchSuggestions(data, context) {
    const { userId, query = '', limit = 5 } = data;
    
    try {
      const suggestions = [];
      
      // Get user's search history
      const userHistory = this.searchHistory.get(userId) || [];
      
      // Add recent searches
      const recentSearches = userHistory
        .filter(search => search.query.toLowerCase().includes(query.toLowerCase()))
        .slice(-3)
        .map(search => ({
          type: 'recent',
          query: search.query,
          category: search.category,
          frequency: search.frequency || 1
        }));
      
      suggestions.push(...recentSearches);
      
      // Add popular searches (simulated)
      const popularSearches = [
        { type: 'popular', query: 'user profile', category: 'users' },
        { type: 'popular', query: 'recent messages', category: 'messages' },
        { type: 'popular', query: 'latest posts', category: 'posts' }
      ].filter(search => 
        search.query.toLowerCase().includes(query.toLowerCase())
      );
      
      suggestions.push(...popularSearches);
      
      // Add auto-complete suggestions
      if (query.length > 2) {
        const autoComplete = await this.generateAutoComplete(query);
        suggestions.push(...autoComplete);
      }
      
      return {
        query,
        suggestions: suggestions.slice(0, limit),
        userId,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Search suggestions failed:', error);
      throw error;
    }
  }

  /**
   * Analyze search data for insights
   */
  async analyzeData(payload, context) {
    const { analysisType, data } = payload;
    
    try {
      let result;
      
      switch (analysisType) {
        case 'search_trends':
          result = await this.analyzeSearchTrends(data);
          break;
        case 'search_performance':
          result = await this.analyzeSearchPerformance(data);
          break;
        case 'user_search_behavior':
          result = await this.analyzeUserSearchBehavior(data);
          break;
        default:
          throw new Error(`Unknown analysis type: ${analysisType}`);
      }
      
      return result;
      
    } catch (error) {
      logger.error('❌ Search analysis failed:', error);
      throw error;
    }
  }

  /**
   * Monitor search system performance
   */
  async monitorSystem(payload, context) {
    try {
      const monitoring = {
        searchIndex: {
          size: this.metrics.indexSize,
          lastUpdate: this.lastIndexUpdate || 'Never',
          updateInterval: this.config.indexUpdateInterval
        },
        cache: {
          size: this.searchCache.size,
          hitRate: this.calculateCacheHitRate(),
          maxSize: this.config.maxCacheSize
        },
        performance: {
          averageSearchTime: this.metrics.averageSearchTime,
          searchesProcessed: this.metrics.searchesProcessed,
          indexUpdates: this.metrics.indexUpdates
        },
        systemHealth: {
          memoryUsage: process.memoryUsage().heapUsed,
          activeSearches: this.getActiveSearchCount()
        }
      };
      
      // Generate alerts
      const alerts = [];
      
      if (monitoring.cache.hitRate < 0.3) {
        alerts.push({
          type: 'low_cache_hit_rate',
          severity: 'warning',
          value: monitoring.cache.hitRate
        });
      }
      
      if (monitoring.performance.averageSearchTime > 1000) {
        alerts.push({
          type: 'slow_search_performance',
          severity: 'warning',
          value: monitoring.performance.averageSearchTime
        });
      }
      
      monitoring.alerts = alerts;
      
      return monitoring;
      
    } catch (error) {
      logger.error('❌ Search monitoring failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the search agent
   */
  async healthCheck() {
    return {
      status: this.isActive ? 'healthy' : 'inactive',
      indexSize: this.metrics.indexSize,
      cacheSize: this.searchCache.size,
      searchHistory: this.searchHistory.size,
      metrics: this.metrics,
      lastActivity: new Date()
    };
  }

  // Helper methods

  /**
   * Build search index
   */
  async buildSearchIndex() {
    try {
      logger.info('🔍 Building search index...');
      
      // Index users
      const users = await User.find({}, 'userId name email phoneNumber').lean();
      users.forEach(user => {
        const indexKey = `user:${user.userId}`;
        this.searchIndex.set(indexKey, {
          type: 'user',
          id: user.userId,
          searchableText: `${user.name} ${user.email} ${user.phoneNumber}`.toLowerCase(),
          data: user
        });
      });
      
      this.metrics.indexSize = this.searchIndex.size;
      this.lastIndexUpdate = new Date();
      
      logger.info(`✅ Search index built with ${this.metrics.indexSize} entries`);
      
    } catch (error) {
      logger.error('❌ Search index building failed:', error);
    }
  }

  /**
   * Start periodic indexing
   */
  startPeriodicIndexing() {
    setInterval(async () => {
      try {
        await this.buildSearchIndex();
        this.metrics.indexUpdates++;
      } catch (error) {
        logger.error('❌ Periodic index update failed:', error);
      }
    }, this.config.indexUpdateInterval);
  }

  /**
   * Calculate user relevance score
   */
  calculateUserRelevance(user, query) {
    let score = 0;
    const queryLower = query.toLowerCase();
    
    if (user.name?.toLowerCase().includes(queryLower)) score += 10;
    if (user.email?.toLowerCase().includes(queryLower)) score += 8;
    if (user.phoneNumber?.includes(query)) score += 6;
    
    // Boost active users
    if (user.isActive) score += 2;
    
    return score;
  }

  /**
   * Update search history
   */
  updateSearchHistory(userId, category, query) {
    if (!this.searchHistory.has(userId)) {
      this.searchHistory.set(userId, []);
    }
    
    const history = this.searchHistory.get(userId);
    const existing = history.find(h => h.query === query && h.category === category);
    
    if (existing) {
      existing.frequency = (existing.frequency || 1) + 1;
      existing.lastSearched = new Date();
    } else {
      history.push({
        query,
        category,
        frequency: 1,
        firstSearched: new Date(),
        lastSearched: new Date()
      });
    }
    
    // Keep only last 50 searches
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
  }

  /**
   * Update agent metrics
   */
  updateMetrics(searchTime, success) {
    if (success) {
      this.metrics.searchesProcessed++;
    }
    
    const totalSearches = this.metrics.searchesProcessed;
    this.metrics.averageSearchTime = 
      ((this.metrics.averageSearchTime * (totalSearches - 1)) + searchTime) / totalSearches;
  }

  /**
   * Calculate cache hit rate
   */
  calculateCacheHitRate() {
    const totalRequests = this.metrics.searchesProcessed;
    return totalRequests > 0 ? this.metrics.cacheHits / totalRequests : 0;
  }
}

module.exports = SearchAgent;
