const FeedPost = require('../models/FeedPost');
const User = require('../models/userModel');
const Page = require('../models/Page');

// Create a new feed post
const createFeedPost = async (req, res) => {
  try {
    const { caption, type, mediaUrls, location, privacy, pageId } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!type || !mediaUrls || mediaUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Post type and media are required'
      });
    }

    // Get user info
    const user = await User.findOne({ userId }).select('name profileImage');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Phase 2: Check if posting as page
    let isPagePost = false;
    let page = null;
    if (pageId) {
      page = await Page.findById(pageId);
      if (!page) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      // Check if user can post to this page
      if (!page.canPost(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to post to this page'
        });
      }

      isPagePost = true;
      console.log(`📄 [PAGE POST] User ${userId} posting as page ${page.name}`);
    }

    // Create media items
    const media = mediaUrls.map((url, index) => ({
      type: type === 'carousel' ? (url.includes('.mp4') ? 'video' : 'photo') : type,
      url: url,
      width: 1080,
      height: 1080,
      order: index
    }));

    // Create new feed post
    const newPost = new FeedPost({
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      type,
      caption: caption || '',
      media,
      location: location ? { name: location } : undefined,
      privacy: privacy || 'public',
      // Phase 2: Page post fields
      pageId: pageId || null,
      isPagePost: isPagePost
    });

    await newPost.save();

    // Phase 2: Update page post count if page post
    if (isPagePost && page) {
      await Page.findByIdAndUpdate(pageId, { $inc: { postCount: 1 } });
      console.log(`✅ Page post created for ${page.name}:`, newPost._id);
    } else {
      console.log(`✅ Feed post created by ${user.name}:`, newPost._id);
    }

    // Broadcast to WebSocket (optional - for real-time updates)
    try {
      const { broadcastToUser } = require('../socketManager');
      const currentUser = await User.findOne({ userId }).select('contacts');
      const contactObjectIds = currentUser?.contacts || [];
      const contactUserIds = contactObjectIds.map(id => id.toString());

      const postData = {
        _id: newPost._id,
        userId: newPost.userId,
        userName: newPost.userName,
        userProfileImage: newPost.userProfileImage,
        type: newPost.type,
        caption: newPost.caption,
        media: newPost.media,
        location: newPost.location,
        privacy: newPost.privacy,
        likesCount: newPost.likesCount,
        commentsCount: newPost.commentsCount,
        createdAt: newPost.createdAt
      };

      let successfulBroadcasts = 0;
      contactUserIds.forEach(contactUserId => {
        const success = broadcastToUser(contactUserId, 'feed:new_post', postData);
        if (success) successfulBroadcasts++;
      });

      console.log(`📡 Post broadcast: ${successfulBroadcasts}/${contactUserIds.length} successful`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting post:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: newPost,
      message: 'Post created successfully'
    });

  } catch (error) {
    console.error('❌ Create feed post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: error.message
    });
  }
};

// Get feed posts (Instagram-style with contacts + app connections)
const getFeedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Use Friend model to get accepted friends (device contacts + app connections)
    const Friend = require('../models/Friend');
    const friends = await Friend.getFriends(userId, {
      status: 'accepted',
      includeDeviceContacts: true,
      includeAppConnections: true
    });
    
    // Extract friend user IDs
    const friendUserIds = friends
      .filter(friend => friend && friend.friendUserId)
      .map(friend => friend.friendUserId);
    
    // Phase 2: Get user's followed pages
    const PageFollower = require('../models/PageFollower');
    const followedPages = await PageFollower.find({ userId: req.user._id }).select('pageId');
    const followedPageIds = followedPages.map(f => f.pageId);
    
    // IMPORTANT: Also include pages that the user owns/manages
    const ownedPages = await Page.find({ 
      $or: [
        { owner: req.user._id },
        { 'admins.userId': req.user._id }
      ]
    }).select('_id');
    const ownedPageIds = ownedPages.map(p => p._id);
    
    // Combine followed pages + owned pages
    const allPageIds = [...new Set([...followedPageIds.map(id => id.toString()), ...ownedPageIds.map(id => id.toString())])];
    
    console.log(`📱 Getting feed for user ${userId}:`);
    console.log(`  👥 Friends (from Friend model): ${friendUserIds.length}`);
    console.log(`  📄 Followed pages: ${followedPageIds.length}`);
    console.log(`  👤 Owned/managed pages: ${ownedPageIds.length}`);
    console.log(`  📄 Total pages in feed: ${allPageIds.length}`);

    // Pass friend IDs + all page IDs (followed + owned) to getFeedPosts
    const posts = await FeedPost.getFeedPosts(userId, page, limit, friendUserIds, allPageIds);

    console.log(`✅ Returning ${posts.length} FOR YOU posts (own + friends + pages)`);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get feed posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get feed posts',
      error: error.message
    });
  }
};

// Get single post
const getPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await FeedPost.findById(postId);

    if (!post || !post.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment view count
    await post.incrementViews();

    res.status(200).json({
      success: true,
      data: post
    });

  } catch (error) {
    console.error('❌ Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get post',
      error: error.message
    });
  }
};

// Delete post
const deletePost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    // Find post (don't filter by userId yet - need to check page permissions)
    const post = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or already deleted'
      });
    }

    // Check permissions
    let hasPermission = false;
    
    // If it's a regular user post, check if user owns it
    if (!post.isPagePost) {
      hasPermission = post.userId === userId;
    } else {
      // If it's a page post, check page permissions
      const page = await Page.findById(post.pageId);
      if (page) {
        // Owner and admin can delete any post, editor/contributor can delete own posts
        if (page.isOwner(req.user._id) || page.hasRole(req.user._id, 'admin')) {
          hasPermission = true;
        } else if (page.canPost(req.user._id) && post.userId === userId) {
          hasPermission = true; // Editor/contributor can delete own posts
        }
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this post'
      });
    }

    post.isActive = false;
    await post.save();

    console.log(`🗑️ Post deleted: ${postId} by ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post',
      error: error.message
    });
  }
};

// Toggle like on post
const toggleLike = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;

    const post = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.toggleLike(userId);

    const isLiked = post.likes.includes(userId);

    console.log(`${isLiked ? '❤️' : '💔'} Post ${postId} ${isLiked ? 'liked' : 'unliked'} by ${userId}`);

    // Update page statistics if it's a page post
    if (post.isPagePost && post.pageId) {
      try {
        await Page.findByIdAndUpdate(post.pageId, {
          $inc: { totalLikes: isLiked ? 1 : -1 }
        });
        console.log(`📊 Page ${post.pageId} totalLikes ${isLiked ? 'incremented' : 'decremented'}`);
      } catch (pageError) {
        console.error('❌ Error updating page likes:', pageError);
      }
    }

    // BROADCAST LIKE UPDATE TO ALL USERS IN REAL-TIME
    try {
      const { broadcastToAll } = require('../socketManager');
      
      // Get user info for the person who liked
      const user = await User.findOne({ userId }).select('name profileImage');
      
      // Broadcast to ALL connected users (not just connections)
      broadcastToAll('post:like_update', {
        postId: post._id,
        userId: userId,
        userName: user?.name || 'Unknown',
        userProfileImage: user?.profileImage,
        isLiked: isLiked,
        likesCount: post.likesCount,
        likes: post.likes // Send full likes array for accurate sync
      });
      
      console.log(`📡 Like update broadcasted to all users for post ${postId}`);
      
      // Also notify post owner if someone else liked their post
      if (isLiked && post.userId !== userId) {
        const { broadcastToUser } = require('../socketManager');
        broadcastToUser(post.userId, 'post:new_like', {
          postId: post._id,
          userId: userId,
          userName: user?.name || 'Unknown',
          userProfileImage: user?.profileImage
        });
      }
    } catch (broadcastError) {
      console.error('❌ Error broadcasting like update:', broadcastError);
    }

    res.status(200).json({
      success: true,
      data: {
        isLiked,
        likesCount: post.likesCount,
        likes: post.likes
      }
    });

  } catch (error) {
    console.error('❌ Toggle like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// Update/Edit post
const updatePost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { caption, location, privacy } = req.body;

    // Find post (don't filter by userId yet - need to check page permissions)
    const post = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check permissions
    let hasPermission = false;
    
    // If it's a regular user post, check if user owns it
    if (!post.isPagePost) {
      hasPermission = post.userId === userId;
    } else {
      // If it's a page post, check page permissions
      const page = await Page.findById(post.pageId);
      if (page) {
        // Owner and admin can edit any post, editor/contributor can edit own posts
        if (page.isOwner(req.user._id) || page.hasRole(req.user._id, 'admin')) {
          hasPermission = true;
        } else if (page.canPost(req.user._id) && post.userId === userId) {
          hasPermission = true; // Editor/contributor can edit own posts
        }
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this post'
      });
    }

    // Update allowed fields
    if (caption !== undefined) post.caption = caption;
    if (location !== undefined) post.location = location ? { name: location } : undefined;
    if (privacy !== undefined) post.privacy = privacy;

    // Re-extract hashtags and mentions from updated caption
    if (caption !== undefined) {
      post.hashtags = post.extractHashtags();
      post.mentions = post.extractMentions();
    }

    await post.save();

    console.log(`✏️ Post updated: ${postId} by ${userId}`);

    res.status(200).json({
      success: true,
      data: post,
      message: 'Post updated successfully'
    });

  } catch (error) {
    console.error('❌ Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post',
      error: error.message
    });
  }
};

// Repost (share) a post
const repostPost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const { caption } = req.body; // Optional caption for repost

    // Find original post
    const originalPost = await FeedPost.findOne({
      _id: postId,
      isActive: true
    });

    if (!originalPost) {
      return res.status(404).json({
        success: false,
        message: 'Original post not found'
      });
    }

    // Check if user already reposted this
    const existingRepost = await FeedPost.findOne({
      userId: userId,
      originalPostId: postId,
      isActive: true
    });

    if (existingRepost) {
      return res.status(400).json({
        success: false,
        message: 'You have already reposted this'
      });
    }

    // Get user info
    const User = require('../models/userModel');
    const user = await User.findOne({ userId }).select('name profileImage');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create repost
    const repost = new FeedPost({
      userId,
      userName: user.name,
      userProfileImage: user.profileImage,
      type: originalPost.type,
      caption: caption || `Reposted from @${originalPost.userName}`,
      media: originalPost.media,
      location: originalPost.location,
      privacy: 'public', // Reposts are always public
      originalPostId: originalPost._id,
      originalUserId: originalPost.userId,
      isRepost: true
    });

    await repost.save();

    // Increment shares count on original post
    originalPost.sharesCount += 1;
    await originalPost.save();

    console.log(`🔄 Post reposted: ${postId} by ${userId}`);

    // Broadcast to WebSocket (optional - for real-time updates)
    try {
      const { broadcastToUser } = require('../socketManager');
      const currentUser = await User.findOne({ userId }).select('contacts appConnections');
      
      // Get all connection userIds
      const contactObjectIds = currentUser?.contacts || [];
      const appConnections = currentUser?.appConnections || [];
      
      const contactUsers = await User.find({ 
        _id: { $in: contactObjectIds } 
      }).select('userId');
      
      const contactUserIds = contactUsers.map(u => u.userId);
      const appConnectionUserIds = appConnections.map(conn => conn.userId).filter(Boolean);
      const allConnectionUserIds = [...new Set([...contactUserIds, ...appConnectionUserIds])];

      const repostData = {
        _id: repost._id,
        userId: repost.userId,
        userName: repost.userName,
        userProfileImage: repost.userProfileImage,
        type: repost.type,
        caption: repost.caption,
        media: repost.media,
        location: repost.location,
        privacy: repost.privacy,
        isRepost: true,
        originalPostId: originalPost._id,
        likesCount: repost.likesCount,
        commentsCount: repost.commentsCount,
        createdAt: repost.createdAt
      };

      let successfulBroadcasts = 0;
      allConnectionUserIds.forEach(connectionUserId => {
        const success = broadcastToUser(connectionUserId, 'feed:new_post', repostData);
        if (success) successfulBroadcasts++;
      });

      console.log(`📡 Repost broadcast: ${successfulBroadcasts}/${allConnectionUserIds.length} successful`);
    } catch (broadcastError) {
      console.error('❌ Error broadcasting repost:', broadcastError);
    }

    res.status(201).json({
      success: true,
      data: repost,
      message: 'Post reposted successfully'
    });

  } catch (error) {
    console.error('❌ Repost error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to repost',
      error: error.message
    });
  }
};

// Get user's posts
const getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const posts = await FeedPost.getUserPosts(userId, page, limit);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get user posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user posts',
      error: error.message
    });
  }
};

// Toggle bookmark on post
const toggleBookmark = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.params;
    const mongoose = require('mongoose');

    // Validate postId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID format'
      });
    }

    // Check if post exists
    const post = await FeedPost.findOne({ _id: postId, isActive: true });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize savedPosts if it doesn't exist
    if (!user.savedPosts) {
      user.savedPosts = [];
    }

    // Clean up invalid ObjectIds from savedPosts
    user.savedPosts = user.savedPosts.filter(savedPost => {
      try {
        return mongoose.Types.ObjectId.isValid(savedPost);
      } catch (err) {
        return false;
      }
    });

    // Toggle bookmark
    const postObjectId = post._id;
    const bookmarkIndex = user.savedPosts.findIndex(
      savedPost => savedPost.toString() === postObjectId.toString()
    );

    let isBookmarked;
    if (bookmarkIndex > -1) {
      // Remove bookmark
      user.savedPosts.splice(bookmarkIndex, 1);
      isBookmarked = false;
      console.log(`🔖 Post ${postId} unbookmarked by ${userId}`);
    } else {
      // Add bookmark
      user.savedPosts.push(postObjectId);
      isBookmarked = true;
      console.log(`🔖 Post ${postId} bookmarked by ${userId}`);
    }

    await user.save();

    res.status(200).json({
      success: true,
      data: {
        isBookmarked,
        savedPostsCount: user.savedPosts.length
      }
    });

  } catch (error) {
    console.error('❌ Toggle bookmark error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle bookmark',
      error: error.message
    });
  }
};

// Get user's saved/bookmarked posts
const getSavedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const mongoose = require('mongoose');

    // Get user to get saved post IDs
    const user = await User.findOne({ userId }).select('savedPosts');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.savedPosts || user.savedPosts.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0
        }
      });
    }

    // Filter out invalid ObjectIds
    const validPostIds = user.savedPosts.filter(postId => {
      try {
        return mongoose.Types.ObjectId.isValid(postId);
      } catch (err) {
        console.warn(`⚠️ Invalid ObjectId in savedPosts: ${postId}`);
        return false;
      }
    });

    if (validPostIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0
        }
      });
    }

    // Get the saved posts
    const savedPosts = await FeedPost.find({
      _id: { $in: validPostIds },
      isActive: true
    })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

    console.log(`📚 Retrieved ${savedPosts.length} saved posts for ${userId} (${validPostIds.length} valid IDs)`);

    res.status(200).json({
      success: true,
      data: savedPosts,
      pagination: {
        page,
        limit,
        total: validPostIds.length
      }
    });

  } catch (error) {
    console.error('❌ Get saved posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved posts',
      error: error.message
    });
  }
};

// Get posts user has liked
const getLikedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Find posts where user has liked
    const likedPosts = await FeedPost.find({
      likes: userId,
      isActive: true
    })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

    const total = await FeedPost.countDocuments({
      likes: userId,
      isActive: true
    });

    console.log(`❤️ Retrieved ${likedPosts.length} liked posts for ${userId}`);

    res.status(200).json({
      success: true,
      data: likedPosts,
      pagination: {
        page,
        limit,
        total
      }
    });

  } catch (error) {
    console.error('❌ Get liked posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get liked posts',
      error: error.message
    });
  }
};

// Get posts user has commented on
const getCommentedPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const Comment = require('../models/Comment');

    // Find unique post IDs where user has commented
    const comments = await Comment.find({
      userId: userId,
      isActive: true
    }).distinct('postId');

    // Get the posts
    const commentedPosts = await FeedPost.find({
      _id: { $in: comments },
      isActive: true
    })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

    console.log(`💬 Retrieved ${commentedPosts.length} commented posts for ${userId}`);

    res.status(200).json({
      success: true,
      data: commentedPosts,
      pagination: {
        page,
        limit,
        total: comments.length
      }
    });

  } catch (error) {
    console.error('❌ Get commented posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get commented posts',
      error: error.message
    });
  }
};

// Get view statistics for user's posts
const getPostViewStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all user's posts with view counts
    const posts = await FeedPost.find({
      userId: userId,
      isActive: true
    })
    .select('caption media viewsCount createdAt')
    .sort({ createdAt: -1 })
    .lean();

    // Calculate total views
    const totalViews = posts.reduce((sum, post) => sum + (post.viewsCount || 0), 0);

    console.log(`👁️ Retrieved view stats for ${userId}: ${totalViews} total views`);

    res.status(200).json({
      success: true,
      data: {
        totalPosts: posts.length,
        totalViews: totalViews,
        posts: posts.map(post => ({
          _id: post._id,
          caption: post.caption,
          thumbnail: post.media && post.media[0] ? post.media[0].url : null,
          viewsCount: post.viewsCount || 0,
          createdAt: post.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('❌ Get view stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get view statistics',
      error: error.message
    });
  }
};

// Get posts for a specific page (Phase 2)
const getPagePosts = async (req, res) => {
  try {
    const { pageId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    console.log(`📄 Getting posts for page: ${pageId}`);

    const posts = await FeedPost.getPagePosts(pageId, page, limit);

    console.log(`✅ Returning ${posts.length} page posts`);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get page posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get page posts',
      error: error.message
    });
  }
};

// Get explore posts (public posts from non-friends)
const getExplorePosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const usePersonalization = req.query.personalized !== 'false'; // Default to personalized

    // Use Friend model to get accepted friends to exclude from explore
    const Friend = require('../models/Friend');
    const friends = await Friend.getFriends(userId, {
      status: 'accepted',
      includeDeviceContacts: true,
      includeAppConnections: true
    });
    
    // Extract friend user IDs to exclude
    const friendUserIds = friends
      .filter(friend => friend && friend.friendUserId)
      .map(friend => friend.friendUserId);
    
    // Get user's followed pages to exclude from explore
    const PageFollower = require('../models/PageFollower');
    const followedPages = await PageFollower.find({ userId: req.user._id }).select('pageId');
    const followedPageIds = followedPages.map(f => f.pageId);
    
    // Also include pages that the user owns/manages
    const ownedPages = await Page.find({ 
      $or: [
        { owner: req.user._id },
        { 'admins.userId': req.user._id }
      ]
    }).select('_id');
    const ownedPageIds = ownedPages.map(p => p._id);
    
    // Combine followed pages + owned pages
    const allPageIds = [...new Set([...followedPageIds.map(id => id.toString()), ...ownedPageIds.map(id => id.toString())])];
    
    console.log(`🔍 Getting EXPLORE feed for user ${userId}:`);
    console.log(`  👥 Excluding friends (from Friend model): ${friendUserIds.length}`);
    console.log(`  📄 Excluding followed/owned pages: ${allPageIds.length}`);
    console.log(`  🎯 Personalization: ${usePersonalization ? 'ENABLED' : 'DISABLED'}`);

    let posts;
    
    if (usePersonalization) {
      // Use personalized recommendation algorithm
      const recommendationService = require('../services/recommendationService');
      posts = await recommendationService.getPersonalizedExploreFeed(
        userId,
        page,
        limit,
        friendUserIds,
        allPageIds
      );
    } else {
      // Fallback to basic chronological feed
      posts = await FeedPost.getExplorePosts(userId, page, limit, friendUserIds, allPageIds);
    }

    console.log(`✅ Returning ${posts.length} EXPLORE posts (${usePersonalization ? 'personalized' : 'chronological'})`);

    res.status(200).json({
      success: true,
      data: posts,
      personalized: usePersonalization,
      pagination: {
        page,
        limit,
        total: posts.length
      }
    });

  } catch (error) {
    console.error('❌ Get explore posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get explore posts',
      error: error.message
    });
  }
};

// Track user interaction with post (for recommendation algorithm)
const trackInteraction = async (req, res) => {
  try {
    const { postId } = req.params;
    const { interactionType, watchTime } = req.body;
    const userId = req.user._id;

    // Validate interaction type
    const validTypes = ['view', 'like', 'comment', 'share', 'save', 'skip'];
    if (!validTypes.includes(interactionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid interaction type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const recommendationService = require('../services/recommendationService');
    const interaction = await recommendationService.trackInteraction(
      userId,
      postId,
      interactionType,
      { watchTime: watchTime || 0 }
    );

    res.status(200).json({
      success: true,
      message: 'Interaction tracked successfully',
      data: interaction
    });

  } catch (error) {
    console.error('❌ Track interaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track interaction',
      error: error.message
    });
  }
};

// Get user's interests (top hashtags)
const getUserInterests = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 20;

    const recommendationService = require('../services/recommendationService');
    const interests = await recommendationService.getUserInterests(userId, limit);

    res.status(200).json({
      success: true,
      data: interests
    });

  } catch (error) {
    console.error('❌ Get user interests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user interests',
      error: error.message
    });
  }
};

// Get trending hashtags
const getTrendingHashtags = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const days = parseInt(req.query.days) || 7;

    const recommendationService = require('../services/recommendationService');
    const trending = await recommendationService.getTrendingHashtags(limit, days);

    res.status(200).json({
      success: true,
      data: trending
    });

  } catch (error) {
    console.error('❌ Get trending hashtags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trending hashtags',
      error: error.message
    });
  }
};

module.exports = {
  createPost: createFeedPost,
  getFeedPosts,
  getExplorePosts,  // NEW: Explore feed endpoint
  getPostById: getPost,
  updatePost,
  deletePost: deletePost,
  repostPost,
  toggleLike,
  toggleBookmark,
  getSavedPosts,
  getUserPosts,
  getLikedPosts,
  getCommentedPosts,
  getPostViewStats,
  getPagePosts,  // Phase 2
  trackInteraction,  // NEW: Track user interactions
  getUserInterests,  // NEW: Get user's learned interests
  getTrendingHashtags  // NEW: Get trending hashtags
};
