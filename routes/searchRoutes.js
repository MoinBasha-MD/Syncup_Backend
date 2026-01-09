const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/userModel');
const Page = require('../models/Page');
const PageFollower = require('../models/PageFollower');
const Friend = require('../models/Friend');

// @route   POST /api/search/unified
// @desc    Unified search for people, pages, and suggestions
// @access  Private
router.post('/unified', protect, async (req, res) => {
  try {
    const { query, types = ['all'], limit = 4 } = req.body;
    const userId = req.user._id.toString(); // Convert to string for Friend model compatibility

    console.log(`🔍 [UNIFIED SEARCH] Query: "${query}", Types: ${types}, User: ${userId}`);

    const results = {
      people: { results: [], total: 0 },
      pages: { results: [], total: 0 },
      suggestions: { results: [], total: 0 },
      nearby: { results: [], total: 0 }
    };

    // If no query, return suggestions only
    if (!query || query.trim().length < 2) {
      // Get suggestions (mutual friends, recommended pages, nearby friends)
      const suggestions = await getSuggestions(userId, limit);
      results.suggestions = suggestions;
      
      return res.json({
        success: true,
        data: results
      });
    }

    const searchQuery = query.trim();
    const searchTypes = types.includes('all') ? ['people', 'pages'] : types;

    // Search People
    if (searchTypes.includes('people')) {
      const peopleResults = await searchPeople(userId, searchQuery, limit);
      results.people = peopleResults;
    }

    // Search Pages
    if (searchTypes.includes('pages')) {
      const pageResults = await searchPages(userId, searchQuery, limit);
      results.pages = pageResults;
    }

    console.log(`✅ [UNIFIED SEARCH] Found: ${results.people.total} people, ${results.pages.total} pages`);

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('❌ [UNIFIED SEARCH] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Search failed'
    });
  }
});

// @route   POST /api/search/pages
// @desc    Search for pages
// @access  Private
router.post('/pages', protect, async (req, res) => {
  try {
    const { query, category, limit = 20, offset = 0 } = req.body;
    const userId = req.user._id;

    console.log(`🔍 [PAGE SEARCH] Query: "${query}", Category: ${category}, User: ${userId}`);

    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        data: {
          results: [],
          total: 0,
          hasMore: false
        }
      });
    }

    const searchQuery = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
        { bio: { $regex: query, $options: 'i' } }
      ],
      isPublic: true
    };

    if (category) {
      searchQuery.category = category;
    }

    // Get total count
    const total = await Page.countDocuments(searchQuery);

    // Get pages
    const pages = await Page.find(searchQuery)
      .sort({ followerCount: -1, isVerified: -1 })
      .skip(offset)
      .limit(limit)
      .select('name username profileImage followerCount category isVerified')
      .lean();

    // Check if user is following each page
    const pageIds = pages.map(p => p._id);
    const followedPages = await PageFollower.find({
      userId: userId,
      pageId: { $in: pageIds }
    }).select('pageId').lean();

    const followedPageIds = new Set(followedPages.map(f => f.pageId.toString()));

    const results = pages.map(page => ({
      pageId: page._id,
      name: page.name,
      username: page.username,
      profileImage: page.profileImage,
      followerCount: page.followerCount,
      category: page.category,
      isFollowing: followedPageIds.has(page._id.toString()),
      isVerified: page.isVerified || false,
      subtitle: `${formatFollowerCount(page.followerCount)} followers • ${page.category || 'General'}`
    }));

    console.log(`✅ [PAGE SEARCH] Found ${results.length} pages (total: ${total})`);

    res.json({
      success: true,
      data: {
        results,
        total,
        hasMore: offset + results.length < total
      }
    });

  } catch (error) {
    console.error('❌ [PAGE SEARCH] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Page search failed'
    });
  }
});

// @route   GET /api/search/suggestions
// @desc    Get personalized suggestions
// @access  Private
router.get('/suggestions', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 10;

    console.log(`✨ [SUGGESTIONS] Getting suggestions for user: ${userId}`);

    const suggestions = await getSuggestions(userId, limit);

    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    console.error('❌ [SUGGESTIONS] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get suggestions'
    });
  }
});

// Helper: Search People
async function searchPeople(userId, query, limit) {
  try {
    const searchQuery = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: userId }
    };

    const total = await User.countDocuments(searchQuery);

    const users = await User.find(searchQuery)
      .limit(limit)
      .select('name username profileImage')
      .lean();

    // Get friendship status for each user
    const userIds = users.map(u => u._id.toString()); // Convert to strings for Friend model
    
    console.log(`🔍 [SEARCH DEBUG] Checking friendships for userId: ${userId}`);
    console.log(`🔍 [SEARCH DEBUG] Checking against userIds:`, userIds);
    
    const friendships = await Friend.find({
      $or: [
        { userId: userId, friendUserId: { $in: userIds } },
        { userId: { $in: userIds }, friendUserId: userId }
      ],
      isDeleted: { $ne: true }
    }).lean();
    
    console.log(`🔍 [SEARCH DEBUG] Found ${friendships.length} friendships`);

    console.log(`🔍 [SEARCH DEBUG] Found ${friendships.length} friendship records:`, 
      friendships.map(f => ({ 
        from: f.userId.toString(), 
        to: f.friendUserId.toString(), 
        status: f.status 
      })));

    const friendshipMap = new Map();
    friendships.forEach(f => {
      // Friend model stores userId/friendUserId as strings
      const otherUserId = f.userId === userId 
        ? f.friendUserId 
        : f.userId;
      console.log(`✅ [SEARCH DEBUG] Mapping ${otherUserId} -> status: ${f.status}`);
      friendshipMap.set(otherUserId, f.status);
    });

    // Get mutual friends count
    const results = await Promise.all(users.map(async (user) => {
      const userIdStr = user._id.toString();
      const status = friendshipMap.get(userIdStr);
      
      console.log(`👤 [SEARCH DEBUG] User: ${user.name} (${userIdStr}), Status: ${status || 'null'}`);
      
      // Count mutual friends
      const mutualCount = await Friend.countDocuments({
        $or: [
          { userId: userId, friendUserId: { $in: await getMutualFriendIds(userId, user._id) } },
          { userId: { $in: await getMutualFriendIds(userId, user._id) }, friendUserId: userId }
        ],
        status: 'accepted'
      });

      let badge = null;
      let actionText = 'Connect';
      
      if (status === 'accepted') {
        badge = 'Connected';
        actionText = 'Message';
      } else if (status === 'pending') {
        badge = 'Pending';
        actionText = 'Pending';
      }

      return {
        id: user._id,
        type: 'person',
        name: user.name,
        username: user.username,
        profileImage: user.profileImage,
        subtitle: mutualCount > 0 ? `${mutualCount} mutual friend${mutualCount > 1 ? 's' : ''}` : 'Connect to see more',
        badge,
        action: {
          text: actionText,
          type: status === 'accepted' ? 'message' : 'connect'
        },
        mutualConnectionsCount: mutualCount
      };
    }));

    return { results, total };
  } catch (error) {
    console.error('❌ [SEARCH PEOPLE] Error:', error);
    return { results: [], total: 0 };
  }
}

// Helper: Search Pages
async function searchPages(userId, query, limit) {
  try {
    const searchQuery = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } },
        { bio: { $regex: query, $options: 'i' } }
      ],
      isPublic: true
    };

    const total = await Page.countDocuments(searchQuery);

    const pages = await Page.find(searchQuery)
      .sort({ followerCount: -1, isVerified: -1 })
      .limit(limit)
      .select('name username profileImage followerCount category isVerified')
      .lean();

    // Check if user is following
    const pageIds = pages.map(p => p._id);
    const followedPages = await PageFollower.find({
      userId: userId,
      pageId: { $in: pageIds }
    }).select('pageId').lean();

    const followedPageIds = new Set(followedPages.map(f => f.pageId.toString()));

    const results = pages.map(page => ({
      id: page._id,
      type: 'page',
      name: page.name,
      username: page.username,
      profileImage: page.profileImage,
      subtitle: `${formatFollowerCount(page.followerCount)} followers • ${page.category || 'General'}`,
      badge: page.isVerified ? 'Verified' : null,
      action: {
        text: followedPageIds.has(page._id.toString()) ? 'Following' : 'Follow',
        type: followedPageIds.has(page._id.toString()) ? 'unfollow' : 'follow'
      },
      isFollowing: followedPageIds.has(page._id.toString())
    }));

    return { results, total };
  } catch (error) {
    console.error('❌ [SEARCH PAGES] Error:', error);
    return { results: [], total: 0 };
  }
}

// Helper: Get Suggestions
async function getSuggestions(userId, limit) {
  try {
    const suggestions = {
      results: [],
      total: 0
    };

    // Get user's friends
    const userFriends = await Friend.find({
      $or: [
        { userId: userId, status: 'accepted' },
        { friendUserId: userId, status: 'accepted' }
      ]
    }).lean();

    const friendIds = userFriends.map(f => 
      f.userId.toString() === userId.toString() ? f.friendUserId : f.userId
    );

    // Get friends of friends (potential connections)
    const friendsOfFriends = await Friend.find({
      $or: [
        { userId: { $in: friendIds }, status: 'accepted' },
        { friendUserId: { $in: friendIds }, status: 'accepted' }
      ]
    }).lean();

    const potentialFriendIds = new Set();
    friendsOfFriends.forEach(f => {
      const otherId = f.userId.toString();
      const friendId = f.friendUserId.toString();
      if (otherId !== userId.toString() && !friendIds.includes(otherId)) {
        potentialFriendIds.add(otherId);
      }
      if (friendId !== userId.toString() && !friendIds.includes(friendId)) {
        potentialFriendIds.add(friendId);
      }
    });

    // Get user details for suggestions
    const suggestedUsers = await User.find({
      _id: { $in: Array.from(potentialFriendIds).slice(0, limit) }
    })
    .select('name username profileImage')
    .lean();

    // Count mutual friends for each suggestion
    const results = await Promise.all(suggestedUsers.map(async (user) => {
      const mutualCount = await countMutualFriends(userId, user._id);

      return {
        id: user._id,
        type: 'suggestion',
        name: user.name,
        username: user.username,
        profileImage: user.profileImage,
        subtitle: `${mutualCount} mutual friend${mutualCount > 1 ? 's' : ''}`,
        badge: null,
        action: {
          text: 'Connect',
          type: 'connect'
        },
        mutualConnectionsCount: mutualCount
      };
    }));

    suggestions.results = results;
    suggestions.total = results.length;

    return suggestions;
  } catch (error) {
    console.error('❌ [GET SUGGESTIONS] Error:', error);
    return { results: [], total: 0 };
  }
}

// Helper: Get mutual friend IDs
async function getMutualFriendIds(userId1, userId2) {
  try {
    const user1Friends = await Friend.find({
      $or: [
        { userId: userId1, status: 'accepted' },
        { friendUserId: userId1, status: 'accepted' }
      ]
    }).lean();

    const user1FriendIds = user1Friends.map(f => 
      f.userId.toString() === userId1.toString() ? f.friendUserId.toString() : f.userId.toString()
    );

    const user2Friends = await Friend.find({
      $or: [
        { userId: userId2, status: 'accepted' },
        { friendUserId: userId2, status: 'accepted' }
      ]
    }).lean();

    const user2FriendIds = user2Friends.map(f => 
      f.userId.toString() === userId2.toString() ? f.friendUserId.toString() : f.userId.toString()
    );

    return user1FriendIds.filter(id => user2FriendIds.includes(id));
  } catch (error) {
    console.error('❌ [GET MUTUAL FRIEND IDS] Error:', error);
    return [];
  }
}

// Helper: Count mutual friends
async function countMutualFriends(userId1, userId2) {
  try {
    const mutualIds = await getMutualFriendIds(userId1, userId2);
    return mutualIds.length;
  } catch (error) {
    console.error('❌ [COUNT MUTUAL FRIENDS] Error:', error);
    return 0;
  }
}

// Helper: Format follower count
function formatFollowerCount(count) {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

module.exports = router;
