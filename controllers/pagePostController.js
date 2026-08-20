const PagePost = require('../models/PagePost');
const Page = require('../models/Page');
const FeedPost = require('../models/FeedPost');
const PageFollower = require('../models/PageFollower');
const Comment = require('../models/Comment');
const User = require('../models/userModel');
const enhancedNotificationService = require('../services/enhancedNotificationService');

// Resolve the string `userId` (not Mongo _id) of a Page's owner, used to key
// sockets/FCM/Notification records the same way the rest of the app does.
async function getPageOwnerUserId(page) {
  try {
    if (!page || !page.owner) return null;
    const owner = await User.findById(page.owner).select('userId');
    return owner ? owner.userId : null;
  } catch (error) {
    console.error('❌ [PAGE POST] Error resolving page owner:', error);
    return null;
  }
}

// ✅ PHASE 1: Create a new page post with visibility controls
const createPagePost = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { 
      content, 
      media, 
      scheduledFor, 
      hashtags, 
      showHashtags,
      visibility = 'public', // ✅ PHASE 1: New field
      targetAudience, // ✅ PHASE 1: New field
      music
    } = req.body;

    console.log('📝 [PAGE POST] Creating post for page:', pageId);
    console.log('📝 [PAGE POST] Visibility:', visibility);
    console.log('📝 [PAGE POST] Target Audience:', targetAudience);

    // Find page
    const page = await Page.findById(pageId);
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

    // ✅ PHASE 1: Validate visibility
    if (!['public', 'followers', 'custom'].includes(visibility)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid visibility option. Must be: public, followers, or custom'
      });
    }

    // ✅ PHASE 1: Validate custom targeting
    if (visibility === 'custom' && !targetAudience) {
      return res.status(400).json({
        success: false,
        message: 'Target audience required for custom visibility'
      });
    }

    // Create post
    const post = new PagePost({
      page: pageId,
      author: req.user._id,
      content,
      media: media || [],
      hashtags: hashtags || [],
      showHashtags: showHashtags !== undefined ? showHashtags : false,
      visibility, // ✅ PHASE 1
      targetAudience: targetAudience || { enabled: false }, // ✅ PHASE 1
      scheduledFor: scheduledFor || null,
      status: scheduledFor ? 'scheduled' : 'published', // ✅ PHASE 1
      isPublished: !scheduledFor,
      publishedAt: scheduledFor ? null : new Date(),
      music: music || undefined
    });

    await post.save();

    // Update page post count atomically
    await Page.findByIdAndUpdate(pageId, { $inc: { postCount: 1 } });

    console.log('✅ [PAGE POST] Post created successfully:', post._id);

    // ✅ PHASE 1: Handle distribution based on visibility
    if (!scheduledFor) {
      await distributePagePost(post, page, visibility, targetAudience);

      // Notify page followers in real-time about the new post
      try {
        const { broadcastToUser } = require('../socketManager');
        const followers = await PageFollower.find({ pageId: page._id }).select('userId');
        const postPayload = {
          pagePostId: post._id,
          pageId: page._id,
          pageName: page.name,
          pageUsername: page.username,
          pageProfileImage: page.profileImage,
          visibility,
          createdAt: post.createdAt
        };

        followers.forEach(follower => {
          broadcastToUser(follower.userId.toString(), 'page:new_post', postPayload);
        });

        console.log(`📡 [PAGE POST] Notified ${followers.length} followers about new post`);
      } catch (broadcastError) {
        console.error('❌ [PAGE POST] Error broadcasting to followers:', broadcastError);
      }
    } else {
      console.log('📅 [PAGE POST] Post scheduled for:', scheduledFor);
      // TODO Phase 2: Schedule for later distribution
    }

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error creating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: error.message
    });
  }
};

// ✅ PHASE 1: Distribution logic for page posts
async function distributePagePost(post, page, visibility, targetAudience) {
  console.log(`📢 [DISTRIBUTION] Starting distribution for post ${post._id}`);
  console.log(`📢 [DISTRIBUTION] Visibility: ${visibility}`);
  
  try {
    if (visibility === 'public') {
      // PUBLIC DISTRIBUTION - Single FeedPost for all users
      console.log('📢 [DISTRIBUTION] Creating public FeedPost (visible to everyone)');
      
      // ✅ FIX: Normalize media format (convert 'image' to 'photo', add dimensions)
      const normalizedMedia = (post.media || []).map((item, index) => ({
        type: item.type === 'image' ? 'photo' : item.type,
        url: item.url,
        thumbnail: item.thumbnail,
        width: item.width || 1080,
        height: item.height || 1080,
        duration: item.duration,
        order: item.order !== undefined ? item.order : index
      }));
      
      const feedPost = new FeedPost({
        userId: post.author,
        userName: page.name, // ✅ FIX: Add required userName field
        userProfileImage: page.profileImage,
        caption: post.content || '', // ✅ FIX: Ensure content is not undefined
        media: normalizedMedia,
        hashtags: post.hashtags || [],
        showHashtags: post.showHashtags,
        music: post.music || undefined,
        privacy: 'public',
        isPagePost: true,
        pageId: page._id,
        pagePostId: post._id,
        pageVisibility: 'public', // ✅ PHASE 1
        type: normalizedMedia.length > 0 ? 
          (normalizedMedia.length > 1 ? 'carousel' : (normalizedMedia[0].type === 'video' ? 'video' : 'photo')) : 'text'
      });
      
      await feedPost.save();
      
      // Update distribution stats
      post.distributionStats = {
        totalReach: 0, // Will be calculated by views
        followerReach: 0,
        nonFollowerReach: 0,
        distributedAt: new Date()
      };
      await post.save();
      
      console.log(`✅ [DISTRIBUTION] Public FeedPost created: ${feedPost._id}`);
      console.log('📢 [DISTRIBUTION] Post will appear in:');
      console.log('   - All followers\' feeds');
      console.log('   - Explore feed (public discovery)');
      console.log('   - Hashtag pages');
      
    } else if (visibility === 'followers') {
      // ✅ WEEK 1 FIX: FOLLOWERS-ONLY DISTRIBUTION - Single FeedPost with targetUserIds array
      console.log('📢 [DISTRIBUTION] Creating followers-only FeedPost (optimized)');
      
      const followers = await PageFollower.find({ pageId: page._id }).select('userId');
      const followerIds = followers.map(f => f.userId.toString());
      console.log(`📢 [DISTRIBUTION] Found ${followerIds.length} followers`);
      
      // ✅ FIX: Normalize media format
      const normalizedMedia = (post.media || []).map((item, index) => ({
        type: item.type === 'image' ? 'photo' : item.type,
        url: item.url,
        thumbnail: item.thumbnail,
        width: item.width || 1080,
        height: item.height || 1080,
        duration: item.duration,
        order: item.order !== undefined ? item.order : index
      }));
      
      // Create ONE FeedPost with array of targeted users
      const feedPost = new FeedPost({
        userId: post.author,
        userName: page.name, // ✅ FIX: Add required userName field
        userProfileImage: page.profileImage,
        caption: post.content || '', // ✅ FIX: Ensure content is not undefined
        media: normalizedMedia,
        hashtags: post.hashtags || [],
        showHashtags: post.showHashtags,
        music: post.music || undefined,
        privacy: 'friends', // Treated as friends-only
        isPagePost: true,
        pageId: page._id,
        pagePostId: post._id,
        pageVisibility: 'followers',
        targetUserIds: followerIds, // ✅ WEEK 1 FIX: Array of all targeted users
        type: normalizedMedia.length > 0 ? 
          (normalizedMedia.length > 1 ? 'carousel' : (normalizedMedia[0].type === 'video' ? 'video' : 'photo')) : 'text'
      });
      
      await feedPost.save();
      
      // Update distribution stats
      post.distributionStats = {
        totalReach: followerIds.length,
        followerReach: followerIds.length,
        nonFollowerReach: 0,
        targetedFollowers: followerIds.length,
        distributedAt: new Date()
      };
      await post.save();
      
      console.log(`✅ [DISTRIBUTION] Created 1 FeedPost targeting ${followerIds.length} followers (optimized)`);
      console.log('📢 [DISTRIBUTION] Post will appear ONLY in followers\' feeds');
      
    } else if (visibility === 'custom') {
      // ✅ WEEK 1 FIX: CUSTOM AUDIENCE DISTRIBUTION - Single FeedPost with targetUserIds array
      console.log('📢 [DISTRIBUTION] Creating custom-targeted FeedPost (optimized)');
      console.log('📢 [DISTRIBUTION] Target criteria:', JSON.stringify(targetAudience));
      
      // Get targeted followers based on criteria
      const targetFollowers = await PageFollower.getTargetedFollowers(page._id, targetAudience);
      const targetFollowerIds = targetFollowers.map(f => f.userId.toString());
      console.log(`📢 [DISTRIBUTION] Found ${targetFollowerIds.length} targeted followers`);
      
      // ✅ FIX: Normalize media format
      const normalizedMedia = (post.media || []).map((item, index) => ({
        type: item.type === 'image' ? 'photo' : item.type,
        url: item.url,
        thumbnail: item.thumbnail,
        width: item.width || 1080,
        height: item.height || 1080,
        duration: item.duration,
        order: item.order !== undefined ? item.order : index
      }));
      
      // Create ONE FeedPost with array of targeted users
      const feedPost = new FeedPost({
        userId: post.author,
        userName: page.name, // ✅ FIX: Add required userName field
        userProfileImage: page.profileImage,
        caption: post.content || '', // ✅ FIX: Ensure content is not undefined
        media: normalizedMedia,
        hashtags: post.hashtags || [],
        showHashtags: post.showHashtags,
        music: post.music || undefined,
        privacy: 'friends',
        isPagePost: true,
        pageId: page._id,
        pagePostId: post._id,
        pageVisibility: 'custom',
        targetUserIds: targetFollowerIds, // ✅ WEEK 1 FIX: Array of all targeted users
        type: normalizedMedia.length > 0 ? 
          (normalizedMedia.length > 1 ? 'carousel' : (normalizedMedia[0].type === 'video' ? 'video' : 'photo')) : 'text'
      });
      
      await feedPost.save();
      
      // Update distribution stats
      post.distributionStats = {
        totalReach: targetFollowerIds.length,
        followerReach: targetFollowerIds.length,
        nonFollowerReach: 0,
        targetedFollowers: targetFollowerIds.length,
        distributedAt: new Date()
      };
      await post.save();
      
      console.log(`✅ [DISTRIBUTION] Created 1 FeedPost targeting ${targetFollowerIds.length} followers (optimized)`);
      console.log('📢 [DISTRIBUTION] Post will appear ONLY in targeted followers\' feeds');
    }
  } catch (error) {
    console.error('❌ [DISTRIBUTION] Distribution failed:', error);
    throw error;
  }
}

// ✅ Get all posts for a page
const getPagePosts = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { limit = 20, skip = 0, includeUnpublished = false } = req.query;

    console.log('📄 [PAGE POST] Getting posts for page:', pageId);

    const page = await Page.findById(pageId);
    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // Private pages only visible to followers, owner, or team
    const isAuthorized = req.user && (
      page.isOwner(req.user._id) ||
      page.isTeamMember(req.user._id) ||
      await PageFollower.isFollowing(page._id, req.user._id)
    );

    if (!page.isPublic && !isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'This page is private'
      });
    }

    // Build query
    const query = { page: pageId };

    // Only show published posts unless user is page owner/editor
    const showUnpublished = includeUnpublished === 'true' && req.user && page.canEdit(req.user._id);
    if (!showUnpublished) {
      query.isPublished = true;
    }

    const posts = await PagePost.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('author', 'name username profileImage')
      .populate('page', 'name username profileImage');

    const total = await PagePost.countDocuments(query);

    console.log(`✅ [PAGE POST] Found ${posts.length} posts`);

    res.json({
      success: true,
      posts,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: total > (parseInt(skip) + posts.length)
      }
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error getting posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get posts',
      error: error.message
    });
  }
};

// ✅ Get a single post
const getPagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;

    const page = await Page.findById(pageId);
    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    const isAuthorized = req.user && (
      page.isOwner(req.user._id) ||
      page.isTeamMember(req.user._id) ||
      await PageFollower.isFollowing(page._id, req.user._id)
    );

    if (!page.isPublic && !isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'This page is private'
      });
    }

    const post = await PagePost.findOne({ _id: postId, page: pageId })
      .populate('author', 'name username profileImage')
      .populate('page', 'name username profileImage')
      .populate('likes', 'name username profileImage');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment views
    await post.incrementViews();

    res.json({
      success: true,
      post
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error getting post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get post',
      error: error.message
    });
  }
};

// ✅ Update a post
const updatePagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;
    const { content, media, isPinned, isPublished, music } = req.body;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check permissions
    const page = await Page.findById(pageId);
    if (!page.canEdit(req.user._id) && post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this post'
      });
    }

    // Update fields
    if (content !== undefined) post.content = content;
    if (media !== undefined) post.media = media;
    if (isPinned !== undefined) post.isPinned = isPinned;
    if (isPublished !== undefined) post.isPublished = isPublished;
    if (music !== undefined) post.music = music;

    await post.save();

    // Sync changes to distributed FeedPost copies
    try {
      const update = {};
      if (content !== undefined) update.caption = content;
      if (isPinned !== undefined) update.isPinned = isPinned;
      if (isPublished !== undefined) update.isActive = isPublished;
      if (music !== undefined) update.music = music;
      if (media !== undefined) {
        update.media = (post.media || []).map((item, index) => ({
          type: item.type === 'image' ? 'photo' : item.type,
          url: item.url,
          thumbnail: item.thumbnail,
          width: item.width || 1080,
          height: item.height || 1080,
          duration: item.duration,
          order: item.order !== undefined ? item.order : index
        }));
      }

      if (Object.keys(update).length > 0) {
        await FeedPost.updateMany({ pagePostId: post._id }, { $set: update });
        console.log(`🔄 [PAGE POST] Synced FeedPost copies for ${postId}`);
      }
    } catch (syncError) {
      console.error('❌ [PAGE POST] Error syncing FeedPost copies:', syncError);
    }

    console.log('✅ [PAGE POST] Post updated:', postId);

    res.json({
      success: true,
      message: 'Post updated successfully',
      post
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error updating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post',
      error: error.message
    });
  }
};

// ✅ Delete a post
const deletePagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check permissions
    const page = await Page.findById(pageId);
    if (!page.canEdit(req.user._id) && post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this post'
      });
    }

    await post.deleteOne();

    // Remove the distributed FeedPost copies so they don't become orphaned
    try {
      await FeedPost.deleteMany({ pagePostId: post._id });
      console.log(`🧹 [PAGE POST] Removed distributed FeedPost copies for ${postId}`);
    } catch (cleanupError) {
      console.error('❌ [PAGE POST] Error cleaning up FeedPost copies:', cleanupError);
    }

    // Update page post count atomically (don't go below zero)
    await Page.findByIdAndUpdate(pageId, {
      $inc: { postCount: page.postCount > 0 ? -1 : 0 }
    });

    console.log('✅ [PAGE POST] Post deleted:', postId);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error deleting post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post',
      error: error.message
    });
  }
};

// ✅ Toggle like on a post
const toggleLikePagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.toggleLike(req.user._id);

    const isLiked = post.likes.includes(req.user._id);

    console.log(`✅ [PAGE POST] Post ${isLiked ? 'liked' : 'unliked'}:`, postId);

    // ✅ ARCHITECTURE FIX: Mirror the like onto the distributed FeedPost copy(ies) so
    // Feed viewers see the same like state/count as the Page's own profile.
    try {
      const feedCopies = await FeedPost.find({ pagePostId: post._id });
      for (const copy of feedCopies) {
        const alreadyLikedThere = copy.likes.includes(req.user.userId);
        if (isLiked && !alreadyLikedThere) {
          copy.likes.push(req.user.userId);
          copy.likesCount += 1;
          await copy.save();
        } else if (!isLiked && alreadyLikedThere) {
          copy.likes = copy.likes.filter(id => id !== req.user.userId);
          copy.likesCount = Math.max(0, copy.likesCount - 1);
          await copy.save();
        }
      }
    } catch (syncError) {
      console.error('❌ [LIKE SYNC] Failed to mirror like onto FeedPost copy:', syncError);
    }

    // ✅ WEEK 2 FIX: Track engagement for page followers
    if (isLiked) {
      try {
        const PageFollower = require('../models/PageFollower');
        const follower = await PageFollower.findOne({
          pageId: pageId,
          userId: req.user._id
        });
        
        if (follower) {
          await follower.trackEngagement('like');
          console.log(`📊 [PAGE POST] Tracked like engagement for follower ${req.user._id}`);
        }
      } catch (engagementError) {
        console.error('❌ [PAGE POST] Error tracking engagement:', engagementError);
        // Don't fail the request if engagement tracking fails
      }
    }

    res.json({
      success: true,
      message: isLiked ? 'Post liked' : 'Post unliked',
      isLiked,
      likeCount: post.likeCount
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error toggling like:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// ✅ Add comment to a post
const addCommentToPagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment content is required'
      });
    }

    const post = await PagePost.findOne({ _id: postId, page: pageId });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const page = await Page.findById(pageId);
    if (page && !page.allowComments && !page.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Comments are disabled for this page'
      });
    }

    const user = await User.findById(req.user._id).select('name profileImage');

    const newComment = new Comment({
      postId: post._id,
      postType: 'PagePost',
      pageId: page ? page._id : null,
      userId: req.user.userId,
      userName: user?.name || 'User',
      userProfileImage: user?.profileImage,
      text: content.trim()
    });

    await newComment.save();

    // Update the canonical comment count
    const commentCount = await Comment.getCommentCount(post._id, 'PagePost');
    post.commentCount = commentCount;
    await post.save();

    // Sync the distributed FeedPost copies so the count matches in the main feed
    try {
      await FeedPost.updateMany({ pagePostId: post._id }, { $set: { commentsCount: commentCount } });
    } catch (syncError) {
      console.error('❌ [PAGE POST] Error syncing FeedPost commentsCount:', syncError);
    }

    console.log('✅ [PAGE POST] Comment added to post:', postId);

    // Track engagement for page followers
    try {
      const follower = await PageFollower.findOne({
        pageId: pageId,
        userId: req.user._id
      });
      
      if (follower) {
        await follower.trackEngagement('comment');
        console.log(`📊 [PAGE POST] Tracked comment engagement for follower ${req.user._id}`);
      }
    } catch (engagementError) {
      console.error('❌ [PAGE POST] Error tracking engagement:', engagementError);
    }

    // Notify the page owner (WebSocket + persisted notification + FCM push fallback)
    try {
      const ownerUserId = await getPageOwnerUserId(page);
      if (ownerUserId && ownerUserId !== req.user.userId) {
        await enhancedNotificationService.sendCommentNotification(
          ownerUserId,
          { userId: req.user.userId, name: user?.name || 'Someone', profileImage: user?.profileImage },
          { postId: post._id, isPagePost: true, pageId: page ? page._id : null },
          content.trim()
        );
      }
    } catch (notifyError) {
      console.error('❌ [PAGE POST] Error sending comment notification:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment: newComment,
      commentCount
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
};

// ✅ Get comments for a post (unified Comment collection)
const getPagePostComments = async (req, res) => {
  try {
    const { pageId, postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comments = await Comment.getPostComments(post._id, 'PagePost', page, limit);

    res.json({
      success: true,
      data: comments,
      pagination: {
        page,
        limit,
        total: comments.length
      }
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error getting comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get comments',
      error: error.message
    });
  }
};

// ✅ Add reply to a page post comment
const addReplyToPagePost = async (req, res) => {
  try {
    const { pageId, postId, commentId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reply content is required'
      });
    }

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const page = await Page.findById(pageId);
    if (page && !page.allowComments && !page.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Comments are disabled for this page'
      });
    }

    const comment = await Comment.findOne({ _id: commentId, postId: post._id, postType: 'PagePost' });
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const user = await User.findById(req.user._id).select('name profileImage');

    comment.replies.push({
      userId: req.user.userId,
      userName: user?.name || 'User',
      userProfileImage: user?.profileImage,
      text: content.trim()
    });
    comment.repliesCount = comment.replies.length;
    await comment.save();

    const commentCount = await Comment.getCommentCount(post._id, 'PagePost');
    post.commentCount = commentCount;
    await post.save();

    try {
      await FeedPost.updateMany({ pagePostId: post._id }, { $set: { commentsCount: commentCount } });
    } catch (syncError) {
      console.error('❌ [PAGE POST] Error syncing FeedPost commentsCount:', syncError);
    }

    // Notify the comment owner (WebSocket + persisted notification + FCM push fallback)
    try {
      if (comment.userId !== req.user.userId) {
        await enhancedNotificationService.sendCommentReplyNotification(
          comment.userId,
          { userId: req.user.userId, name: user?.name || 'Someone', profileImage: user?.profileImage },
          { postId: post._id, commentId: comment._id, isPagePost: true, pageId: page ? page._id : null },
          content.trim()
        );
      }
    } catch (notifyError) {
      console.error('❌ [PAGE POST] Error sending reply notification:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      comment,
      commentCount
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error adding reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reply',
      error: error.message
    });
  }
};

// ✅ Toggle like on a page post comment
const togglePagePostCommentLike = async (req, res) => {
  try {
    const { pageId, postId, commentId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const comment = await Comment.findOne({ _id: commentId, postId: post._id, postType: 'PagePost' });
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    await comment.toggleLike(req.user.userId);
    const isLiked = comment.likes.includes(req.user.userId);

    // Notify comment owner only when it becomes liked (not on unlike)
    if (isLiked && comment.userId !== req.user.userId) {
      try {
        const liker = await User.findById(req.user._id).select('name profileImage');
        await enhancedNotificationService.sendCommentLikeNotification(
          comment.userId,
          { userId: req.user.userId, name: liker?.name || 'Someone', profileImage: liker?.profileImage },
          { postId: post._id, commentId, isPagePost: true, pageId }
        );
      } catch (notifyError) {
        console.error('❌ [PAGE POST] Error sending comment like notification:', notifyError);
      }
    }

    res.json({
      success: true,
      isLiked,
      likesCount: comment.likesCount,
      likes: comment.likes
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error toggling comment like:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: error.message
    });
  }
};

// ✅ Toggle like on a page post reply
const togglePagePostReplyLike = async (req, res) => {
  try {
    const { pageId, postId, commentId, replyId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const comment = await Comment.findOne({ _id: commentId, postId: post._id, postType: 'PagePost' });
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    await comment.toggleReplyLike(replyId, req.user.userId);
    const reply = comment.replies.id(replyId);
    const isLiked = reply ? reply.likes.includes(req.user.userId) : false;

    // Notify reply owner only when it becomes liked (not on unlike)
    if (isLiked && reply && reply.userId !== req.user.userId) {
      try {
        const liker = await User.findById(req.user._id).select('name profileImage');
        await enhancedNotificationService.sendReplyLikeNotification(
          reply.userId,
          { userId: req.user.userId, name: liker?.name || 'Someone', profileImage: liker?.profileImage },
          { postId: post._id, commentId, replyId, isPagePost: true, pageId }
        );
      } catch (notifyError) {
        console.error('❌ [PAGE POST] Error sending reply like notification:', notifyError);
      }
    }

    res.json({
      success: true,
      isLiked,
      likesCount: reply ? reply.likesCount : 0
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error toggling reply like:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle reply like',
      error: error.message
    });
  }
};

// ✅ Delete reply from a page post comment
const deletePagePostReply = async (req, res) => {
  try {
    const { pageId, postId, commentId, replyId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const comment = await Comment.findOne({ _id: commentId, postId: post._id, postType: 'PagePost' });
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const reply = comment.replies.id(replyId);
    if (!reply) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }

    const page = await Page.findById(pageId);
    if (reply.userId !== req.user.userId && !page.canEdit(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    comment.replies.pull(replyId);
    comment.repliesCount = comment.replies.length;
    await comment.save();

    const commentCount = await Comment.getCommentCount(post._id, 'PagePost');
    post.commentCount = commentCount;
    await post.save();

    try {
      await FeedPost.updateMany({ pagePostId: post._id }, { $set: { commentsCount: commentCount } });
    } catch (syncError) {
      console.error('❌ [PAGE POST] Error syncing FeedPost commentsCount:', syncError);
    }

    res.json({ success: true, message: 'Reply deleted successfully', commentCount });
  } catch (error) {
    console.error('❌ [PAGE POST] Error deleting reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reply',
      error: error.message
    });
  }
};

// ✅ Delete comment from a post
const deleteCommentFromPagePost = async (req, res) => {
  try {
    const { pageId, postId, commentId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = await Comment.findOne({ _id: commentId, postId: post._id, postType: 'PagePost' });
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user is comment author or page owner/editor
    const page = await Page.findById(pageId);
    if (comment.userId !== req.user.userId && !page.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this comment'
      });
    }

    comment.isActive = false;
    await comment.save();

    // Update canonical count and sync to feed copies
    const commentCount = await Comment.getCommentCount(post._id, 'PagePost');
    post.commentCount = commentCount;
    await post.save();

    try {
      await FeedPost.updateMany({ pagePostId: post._id }, { $set: { commentsCount: commentCount } });
    } catch (syncError) {
      console.error('❌ [PAGE POST] Error syncing FeedPost commentsCount:', syncError);
    }

    console.log('✅ [PAGE POST] Comment deleted from post:', postId);

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      commentCount
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete comment',
      error: error.message
    });
  }
};

// ✅ Share a post (increment share count)
const sharePagePost = async (req, res) => {
  try {
    const { pageId, postId } = req.params;

    const post = await PagePost.findOne({ _id: postId, page: pageId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await post.incrementShares();

    console.log('✅ [PAGE POST] Post shared:', postId);

    // ✅ WEEK 2 FIX: Track engagement for page followers
    try {
      const PageFollower = require('../models/PageFollower');
      const follower = await PageFollower.findOne({
        pageId: pageId,
        userId: req.user._id
      });
      
      if (follower) {
        await follower.trackEngagement('share');
        console.log(`📊 [PAGE POST] Tracked share engagement for follower ${req.user._id}`);
      }
    } catch (engagementError) {
      console.error('❌ [PAGE POST] Error tracking engagement:', engagementError);
      // Don't fail the request if engagement tracking fails
    }

    res.json({
      success: true,
      message: 'Post shared successfully',
      shares: post.shares
    });
  } catch (error) {
    console.error('❌ [PAGE POST] Error sharing post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share post',
      error: error.message
    });
  }
};

module.exports = {
  createPagePost,
  distributePagePost,
  getPagePosts,
  getPagePost,
  updatePagePost,
  deletePagePost,
  toggleLikePagePost,
  addCommentToPagePost,
  getPagePostComments,
  addReplyToPagePost,
  togglePagePostCommentLike,
  togglePagePostReplyLike,
  deletePagePostReply,
  deleteCommentFromPagePost,
  sharePagePost
};
