const FeedPost = require('../models/FeedPost');
const User = require('../models/userModel');

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

/**
 * Auto-complete hashtags while typing
 */
exports.autocompleteHashtags = async (req, res) => {
  try {
    const { q } = req.query;
    const limit = parseInt(req.query.limit) || 10;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const cleanQuery = q.toLowerCase().replace(/^#/, '');

    // Find hashtags that match the query
    const matchingHashtags = await FeedPost.aggregate([
      {
        $match: {
          privacy: 'public',
          hashtags: { $regex: `^${cleanQuery}`, $options: 'i' },
        },
      },
      { $unwind: '$hashtags' },
      {
        $match: {
          hashtags: { $regex: `^${cleanQuery}`, $options: 'i' },
        },
      },
      {
        $group: {
          _id: '$hashtags',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $project: {
          tag: '$_id',
          count: 1,
          _id: 0,
        },
      },
    ]);

    res.json({
      success: true,
      data: matchingHashtags,
    });
  } catch (error) {
    console.error('Error in autocomplete:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to autocomplete hashtags',
      error: error.message,
    });
  }
};

/**
 * Follow a hashtag
 */
exports.followHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    const userId = req.user._id;

    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    // Check if already following
    const user = await User.findById(userId);
    const alreadyFollowing = user.followedHashtags.some(
      (h) => h.tag.toLowerCase() === cleanTag
    );

    if (alreadyFollowing) {
      return res.json({
        success: true,
        message: 'Already following this hashtag',
        isFollowing: true,
      });
    }

    // Add to followed hashtags
    user.followedHashtags.push({
      tag: cleanTag,
      followedAt: new Date(),
    });

    await user.save();

    res.json({
      success: true,
      message: 'Hashtag followed successfully',
      isFollowing: true,
      tag: cleanTag,
    });
  } catch (error) {
    console.error('Error following hashtag:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to follow hashtag',
      error: error.message,
    });
  }
};

/**
 * Unfollow a hashtag
 */
exports.unfollowHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    const userId = req.user._id;

    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    // Remove from followed hashtags
    const user = await User.findById(userId);
    user.followedHashtags = user.followedHashtags.filter(
      (h) => h.tag.toLowerCase() !== cleanTag
    );

    await user.save();

    res.json({
      success: true,
      message: 'Hashtag unfollowed successfully',
      isFollowing: false,
      tag: cleanTag,
    });
  } catch (error) {
    console.error('Error unfollowing hashtag:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to unfollow hashtag',
      error: error.message,
    });
  }
};

/**
 * Get user's followed hashtags
 */
exports.getFollowedHashtags = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select('followedHashtags');

    // Get post counts for each followed hashtag
    const hashtagsWithCounts = await Promise.all(
      user.followedHashtags.map(async (h) => {
        const count = await FeedPost.countDocuments({
          hashtags: h.tag,
          privacy: 'public',
        });

        return {
          tag: h.tag,
          followedAt: h.followedAt,
          postCount: count,
        };
      })
    );

    res.json({
      success: true,
      data: hashtagsWithCounts,
    });
  } catch (error) {
    console.error('Error fetching followed hashtags:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch followed hashtags',
      error: error.message,
    });
  }
};

/**
 * Check if user is following a hashtag
 */
exports.isFollowingHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    const userId = req.user._id;

    // Validate hashtag format
    const cleanTag = validateHashtag(tag);

    const user = await User.findById(userId).select('followedHashtags');
    const isFollowing = user.followedHashtags.some(
      (h) => h.tag.toLowerCase() === cleanTag
    );

    res.json({
      success: true,
      isFollowing,
      tag: cleanTag,
    });
  } catch (error) {
    console.error('Error checking follow status:', error);
    if (error.message === 'Invalid hashtag format') {
      return res.status(400).json({
        success: false,
        message: 'Invalid hashtag format. Use only letters and numbers (2-30 characters).',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to check follow status',
      error: error.message,
    });
  }
};
