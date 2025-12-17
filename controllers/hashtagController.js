const FeedPost = require('../models/FeedPost');

/**
 * Validate and clean hashtag
 */
const validateHashtag = (tag) => {
  const cleanTag = tag.replace(/^#/, '').toLowerCase();
  // Only alphanumeric, 2-30 characters
  if (!/^[a-z0-9]{2,30}$/.test(cleanTag)) {
    throw new Error('Invalid hashtag format');
  }
  return cleanTag;
};

/**
 * Get trending hashtags
 */
exports.getTrendingHashtags = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const timeframe = parseInt(req.query.timeframe) || 7; // days

    // Calculate date for timeframe
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframe);

    // Aggregate hashtags from recent posts
    const trendingTags = await FeedPost.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          privacy: 'public', // Only count public posts
        }
      },
      {
        $unwind: '$hashtags'
      },
      {
        $group: {
          _id: '$hashtags',
          count: { $sum: 1 },
          recentPosts: { $push: '$_id' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: limit
      },
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1,
          popularity: {
            $multiply: [
              { $divide: ['$count', 100] },
              1
            ]
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: trendingTags,
      timeframe: `${timeframe} days`,
    });
  } catch (error) {
    console.error('Error fetching trending hashtags:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending hashtags',
      error: error.message,
    });
  }
};

/**
 * Search posts by hashtag
 */
exports.searchByHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    // Find posts with this hashtag
    const posts = await FeedPost.find({
      hashtags: cleanTag,
      $or: [
        { privacy: 'public' },
        { userId: req.user._id }, // User's own posts
        { 
          privacy: 'friends',
          userId: { $in: req.user.friends || [] } // Friends' posts
        }
      ]
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name profileImage username')
      .lean();

    // Get total count
    const total = await FeedPost.countDocuments({
      hashtags: cleanTag,
      $or: [
        { privacy: 'public' },
        { userId: req.user._id },
        { 
          privacy: 'friends',
          userId: { $in: req.user.friends || [] }
        }
      ]
    });

    res.json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      hashtag: cleanTag,
    });
  } catch (error) {
    console.error('Error searching by hashtag:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to search posts',
      error: error.message,
    });
  }
};

/**
 * Get related hashtags
 */
exports.getRelatedHashtags = async (req, res) => {
  try {
    const { tag } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    // Find posts with this hashtag
    const posts = await FeedPost.find({
      hashtags: cleanTag,
      privacy: 'public',
    })
      .select('hashtags')
      .limit(100)
      .lean();

    // Collect all hashtags from these posts
    const hashtagCounts = {};
    posts.forEach(post => {
      post.hashtags.forEach(t => {
        if (t !== cleanTag) {
          hashtagCounts[t] = (hashtagCounts[t] || 0) + 1;
        }
      });
    });

    // Sort by count and return top results
    const relatedTags = Object.entries(hashtagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({
        tag,
        count,
        relevance: posts.length > 0 ? count / posts.length : 0,
      }));

    res.json({
      success: true,
      data: relatedTags,
      baseTag: cleanTag,
    });
  } catch (error) {
    console.error('Error fetching related hashtags:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch related hashtags',
      error: error.message,
    });
  }
};

/**
 * Get hashtag statistics
 */
exports.getHashtagStats = async (req, res) => {
  try {
    const { tag } = req.params;
    
    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    // Get post count
    const postCount = await FeedPost.countDocuments({
      hashtags: cleanTag,
      privacy: 'public',
    });

    // Get usage over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const usageOverTime = await FeedPost.aggregate([
      {
        $match: {
          hashtags: cleanTag,
          privacy: 'public',
          createdAt: { $gte: thirtyDaysAgo },
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Get top posts with this hashtag
    const topPosts = await FeedPost.find({
      hashtags: cleanTag,
      privacy: 'public',
    })
      .sort({ likesCount: -1, viewsCount: -1 })
      .limit(5)
      .populate('userId', 'name profileImage username')
      .lean();

    res.json({
      success: true,
      data: {
        tag: cleanTag,
        totalPosts: postCount,
        usageOverTime,
        topPosts,
      },
    });
  } catch (error) {
    console.error('Error fetching hashtag stats:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hashtag statistics',
      error: error.message,
    });
  }
};
