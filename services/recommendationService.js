/**
 * Recommendation Service
 * Implements content recommendation algorithm for personalized Explore feed
 */

const UserInteraction = require('../models/UserInteraction');
const UserHashtagPreference = require('../models/UserHashtagPreference');
const FeedPost = require('../models/FeedPost');

class RecommendationService {
  /**
   * Calculate hashtag match score (0-100)
   * Matches post hashtags against user's learned preferences
   * ENHANCED: Stronger scoring for better prioritization
   */
  async calculateHashtagMatchScore(userId, postHashtags) {
    if (!postHashtags || postHashtags.length === 0) return 0;
    
    const userPreferences = await UserHashtagPreference.getTopHashtags(userId, 50);
    
    if (userPreferences.length === 0) return 0;
    
    let matchScore = 0;
    let matchedCount = 0;
    
    postHashtags.forEach(hashtag => {
      const index = userPreferences.findIndex(pref => pref.hashtag === hashtag.toLowerCase());
      
      if (index !== -1) {
        matchedCount++;
        const preference = userPreferences[index];
        
        // ENHANCED SCORING:
        // Top 5: 30 points (was 20)
        // Top 10: 25 points (was 20)
        // Top 20: 15 points (was 10)
        // Top 50: 8 points (was 5)
        if (index < 5) matchScore += 30;
        else if (index < 10) matchScore += 25;
        else if (index < 20) matchScore += 15;
        else matchScore += 8;
        
        // BONUS: If user has high engagement with this hashtag (score > 50), add extra boost
        if (preference.score > 50) {
          matchScore += 10; // Strong interest bonus
        }
      }
    });
    
    // BONUS: Multiple matching hashtags = even stronger signal
    if (matchedCount >= 3) matchScore += 15;
    else if (matchedCount >= 2) matchScore += 10;
    
    // Cap at 100
    return Math.min(matchScore, 100);
  }

  /**
   * Calculate engagement score (0-100)
   * Based on post's likes, comments, shares, views
   */
  calculateEngagementScore(post) {
    const likes = post.likes?.length || 0;
    const comments = post.commentsCount || 0;
    const shares = post.sharesCount || 0;
    const views = post.viewsCount || 0;
    
    // Weighted engagement
    const engagementPoints = (likes * 3) + (comments * 5) + (shares * 7) + (views * 0.1);
    
    // Normalize to 0-100 (assuming max 1000 engagement points is 100 score)
    const baseScore = Math.min((engagementPoints / 1000) * 100, 100);
    
    // Apply recency boost (newer posts get higher engagement score)
    const ageInHours = (Date.now() - new Date(post.createdAt)) / (1000 * 60 * 60);
    const recencyBoost = ageInHours < 24 ? 1.2 : ageInHours < 72 ? 1.1 : 1.0;
    
    return Math.min(baseScore * recencyBoost, 100);
  }

  /**
   * Calculate recency score (0-100)
   * Prioritizes fresh content
   */
  calculateRecencyScore(post) {
    const ageInHours = (Date.now() - new Date(post.createdAt)) / (1000 * 60 * 60);
    
    if (ageInHours < 6) return 100;
    if (ageInHours < 24) return 80;
    if (ageInHours < 72) return 60;
    if (ageInHours < 168) return 40;
    return 20;
  }

  /**
   * Calculate diversity score (0-100)
   * Prevents showing too similar content
   */
  calculateDiversityScore(post, recentlyShownPosts, recentlyShownCreators) {
    let score = 100;
    
    // Penalize if from recently shown creator
    if (recentlyShownCreators.includes(post.userId)) {
      score -= 30;
    }
    
    // Penalize if hashtags overlap too much with recent posts
    const recentHashtags = recentlyShownPosts.flatMap(p => p.hashtags || []);
    const overlapCount = (post.hashtags || []).filter(h => recentHashtags.includes(h)).length;
    
    if (overlapCount > 3) score -= 20;
    else if (overlapCount > 2) score -= 10;
    
    return Math.max(score, 0);
  }

  /**
   * Calculate quality score (0-100)
   * Based on post completeness and richness
   */
  calculateQualityScore(post) {
    let score = 0;
    
    // Has media
    if (post.media && post.media.length > 0) score += 30;
    
    // Has caption
    if (post.caption && post.caption.length > 10) score += 20;
    
    // Has multiple hashtags
    if (post.hashtags && post.hashtags.length >= 3) score += 20;
    
    // High engagement rate (relative to views)
    const views = post.viewsCount || 1;
    const engagements = (post.likes?.length || 0) + (post.commentsCount || 0);
    const engagementRate = engagements / views;
    
    if (engagementRate > 0.1) score += 30;
    else if (engagementRate > 0.05) score += 15;
    
    return Math.min(score, 100);
  }

  /**
   * Calculate overall relevance score for a post
   * Combines all scoring components with weights
   * ENHANCED: Increased hashtag weight for stronger personalization
   */
  async calculatePostRelevanceScore(userId, post, context = {}) {
    const { recentlyShownPosts = [], recentlyShownCreators = [] } = context;
    
    // Calculate all components
    const hashtagScore = await this.calculateHashtagMatchScore(userId, post.hashtags);
    const engagementScore = this.calculateEngagementScore(post);
    const recencyScore = this.calculateRecencyScore(post);
    const diversityScore = this.calculateDiversityScore(post, recentlyShownPosts, recentlyShownCreators);
    const qualityScore = this.calculateQualityScore(post);
    
    // ENHANCED WEIGHTS: Hashtag match now dominates (55% vs 40%)
    const relevanceScore = 
      (hashtagScore * 0.55) +      // 55% weight on hashtag match (INCREASED from 40%)
      (engagementScore * 0.20) +   // 20% weight on engagement (reduced from 25%)
      (recencyScore * 0.15) +      // 15% weight on recency (reduced from 20%)
      (diversityScore * 0.07) +    // 7% weight on diversity (reduced from 10%)
      (qualityScore * 0.03);       // 3% weight on quality (reduced from 5%)
    
    return {
      totalScore: relevanceScore,
      breakdown: {
        hashtagScore,
        engagementScore,
        recencyScore,
        diversityScore,
        qualityScore
      }
    };
  }

  /**
   * Get personalized explore feed for user
   */
  async getPersonalizedExploreFeed(userId, page = 1, limit = 20, excludeUserIds = [], excludePageIds = []) {
    console.log(`🎯 [RECOMMENDATION] Getting personalized feed for user ${userId}`);
    
    // ✅ WEEK 1 FIX: Get posts user has already seen (last 30 days)
    const UserSeenPost = require('../models/UserSeenPost');
    const seenPostIds = await UserSeenPost.getSeenPostIds(userId);
    console.log(`👁️ [RECOMMENDATION] Excluding ${seenPostIds.length} already seen posts`);
    
    // Check if user has interaction history
    const userInteractions = await UserInteraction.getUserInteractions(userId, 30, 100);
    const hasHistory = userInteractions.length > 0;
    
    console.log(`📊 [RECOMMENDATION] User has ${userInteractions.length} interactions in last 30 days`);
    
    // Get candidate posts (public posts from non-friends, excluding seen posts)
    const candidateLimit = limit * 5; // Get more candidates for scoring
    const candidatePosts = await FeedPost.find({
      _id: { $nin: seenPostIds }, // ✅ WEEK 1 FIX: Exclude seen posts
      isActive: true,
      privacy: 'public',
      userId: { $nin: [userId, ...excludeUserIds] },
      $or: [
        // Regular user posts (not page posts)
        {
          $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }],
          userId: { $nin: excludeUserIds }
        },
        // ✅ WEEK 2 FIX: Page posts - ONLY PUBLIC ones (exclude followers-only and custom)
        {
          isPagePost: true,
          pageId: { $nin: excludePageIds },
          $or: [
            { pageVisibility: 'public' },
            { pageVisibility: { $exists: false } } // Backward compatibility for old posts
          ]
          // This excludes: pageVisibility: 'followers' and pageVisibility: 'custom'
        }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(candidateLimit)
    .populate('pageId', 'name username profileImage isVerified')
    .lean();
    
    console.log(`📦 [RECOMMENDATION] Found ${candidatePosts.length} candidate posts (after excluding seen)`);
    
    // If user has no history, use trending/popular content
    if (!hasHistory) {
      console.log(`🆕 [RECOMMENDATION] New user - using trending content`);
      return this.getTrendingContent(candidatePosts, page, limit);
    }
    
    // Get recently shown posts for diversity calculation
    const recentlyShownPosts = candidatePosts.slice(0, 10);
    const recentlyShownCreators = recentlyShownPosts.map(p => p.userId);
    
    // Score all candidate posts
    const scoredPosts = await Promise.all(
      candidatePosts.map(async (post) => {
        const scoring = await this.calculatePostRelevanceScore(userId, post, {
          recentlyShownPosts,
          recentlyShownCreators
        });
        
        return {
          ...post,
          _relevanceScore: scoring.totalScore,
          _scoreBreakdown: scoring.breakdown
        };
      })
    );
    
    // Sort by relevance score
    scoredPosts.sort((a, b) => b._relevanceScore - a._relevanceScore);
    
    // Paginate
    const skip = (page - 1) * limit;
    const paginatedPosts = scoredPosts.slice(skip, skip + limit);
    
    console.log(`✅ [RECOMMENDATION] Returning ${paginatedPosts.length} personalized posts`);
    
    // Log top post score breakdown for debugging
    if (paginatedPosts.length > 0) {
      console.log(`🎯 [RECOMMENDATION] Top post score:`, paginatedPosts[0]._scoreBreakdown);
    }
    
    // ✅ WEEK 1 FIX: Track these posts as shown to user
    if (paginatedPosts.length > 0) {
      const postIds = paginatedPosts.map(p => p._id);
      const UserSeenPost = require('../models/UserSeenPost');
      
      // Track asynchronously (don't wait)
      UserSeenPost.trackViewsBatch(userId, postIds, { 
        source: 'explore',
        sessionId: Date.now().toString()
      }).catch(err => {
        console.error('❌ [RECOMMENDATION] Error tracking shown posts:', err);
      });
      
      console.log(`👁️ [RECOMMENDATION] Tracking ${postIds.length} posts as shown to user ${userId}`);
    }
    
    return paginatedPosts;
  }

  /**
   * Get trending content for new users (cold start)
   */
  getTrendingContent(posts, page = 1, limit = 20) {
    // Sort by engagement (likes + comments + shares)
    const trending = posts.map(post => ({
      ...post,
      _engagementScore: (post.likes?.length || 0) + (post.commentsCount || 0) + (post.sharesCount || 0)
    }))
    .sort((a, b) => b._engagementScore - a._engagementScore);
    
    // Paginate
    const skip = (page - 1) * limit;
    return trending.slice(skip, skip + limit);
  }

  /**
   * Track user interaction with post
   */
  async trackInteraction(userId, postId, interactionType, metadata = {}) {
    try {
      // Get post to extract hashtags
      const post = await FeedPost.findById(postId).select('hashtags').lean();
      
      if (!post) {
        console.error(`❌ [RECOMMENDATION] Post ${postId} not found`);
        return null;
      }
      
      // Create interaction record
      const interaction = await UserInteraction.create({
        userId,
        postId,
        interactionType,
        hashtags: post.hashtags || [],
        watchTime: metadata.watchTime || 0
      });
      
      console.log(`✅ [RECOMMENDATION] Tracked ${interactionType} interaction for user ${userId} on post ${postId}`);
      
      // Update hashtag preferences asynchronously (don't wait)
      this.updateHashtagPreferences(userId, post.hashtags, interaction.engagementScore)
        .catch(err => console.error('❌ [RECOMMENDATION] Error updating hashtag preferences:', err));
      
      return interaction;
    } catch (error) {
      console.error('❌ [RECOMMENDATION] Error tracking interaction:', error);
      throw error;
    }
  }

  /**
   * Update user's hashtag preferences based on interaction
   */
  async updateHashtagPreferences(userId, hashtags, engagementScore) {
    if (!hashtags || hashtags.length === 0) return;
    
    await UserHashtagPreference.updateFromInteraction(userId, hashtags, engagementScore);
    
    console.log(`✅ [RECOMMENDATION] Updated hashtag preferences for user ${userId}`);
  }

  /**
   * Apply decay to user's hashtag preferences (run periodically)
   */
  async applyDecayToAllUsers() {
    console.log(`🔄 [RECOMMENDATION] Applying decay to all user preferences...`);
    
    const users = await UserHashtagPreference.distinct('userId');
    
    for (const userId of users) {
      await UserHashtagPreference.applyDecayToUser(userId);
    }
    
    console.log(`✅ [RECOMMENDATION] Applied decay to ${users.length} users`);
  }

  /**
   * Get user's top interests (for display in settings)
   */
  async getUserInterests(userId, limit = 20) {
    const preferences = await UserHashtagPreference.find({ userId })
      .sort({ score: -1 })
      .limit(limit)
      .lean();
    
    return preferences.map(pref => ({
      hashtag: pref.hashtag,
      score: Math.round(pref.score),
      interactionCount: pref.interactionCount,
      isCoreInterest: pref.isCoreInterest || false
    }));
  }

  /**
   * Get trending hashtags globally
   */
  async getTrendingHashtags(limit = 20, days = 7) {
    return await UserHashtagPreference.getTrendingHashtags(limit, days);
  }
}

module.exports = new RecommendationService();
