const PagePost = require('../models/PagePost');
const Page = require('../models/Page');
const FeedPost = require('../models/FeedPost');

// ✅ Create a new page post
const createPagePost = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { content, media, scheduledFor, hashtags, showHashtags } = req.body;

    console.log('📝 [PAGE POST] Creating vibe for page:', pageId);
    console.log('📝 [PAGE POST] Hashtags:', hashtags);
    console.log('📝 [PAGE POST] Show hashtags:', showHashtags);

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

    // Create post
    const post = new PagePost({
      page: pageId,
      author: req.user._id,
      content,
      media: media || [],
      hashtags: hashtags || [],
      showHashtags: showHashtags !== undefined ? showHashtags : false,
      scheduledFor: scheduledFor || null,
      isPublished: !scheduledFor,
      publishedAt: scheduledFor ? null : new Date()
    });

    await post.save();

    // Update page post count
    page.postCount += 1;
    await page.save();

    console.log('✅ [PAGE POST] Vibe created successfully:', post._id);

    // ✅ CRITICAL: Also create FeedPost for distribution to followers' feeds and Explore
    try {
      const feedPost = new FeedPost({
        userId: req.user._id,
        content: content,
        media: media || [],
        hashtags: hashtags || [],
        showHashtags: showHashtags !== undefined ? showHashtags : false,
        privacy: 'public', // Page posts are always public
        isPagePost: true,
        pageId: pageId,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await feedPost.save();
      console.log('✅ [PAGE POST] FeedPost created for distribution:', feedPost._id);
      console.log('📢 [PAGE POST] Page vibe will now appear in:');
      console.log('   - Followers\' feeds');
      console.log('   - Explore feed (public discovery)');
      console.log('   - Page profile');
    } catch (feedError) {
      console.error('⚠️ [PAGE POST] Failed to create FeedPost (vibe still saved to PagePost):', feedError);
      // Don't fail the entire request if FeedPost creation fails
      // The vibe is still saved to PagePost and visible on page profile
    }

    res.status(201).json({
      success: true,
      message: 'Vibe created successfully',
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

// ✅ Get all posts for a page
const getPagePosts = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { limit = 20, skip = 0, includeUnpublished = false } = req.query;

    console.log('📄 [PAGE POST] Getting posts for page:', pageId);

    // Build query
    const query = { page: pageId };
    
    // Only show published posts unless user is page owner/editor
    if (!includeUnpublished) {
      query.isPublished = true;
    }

    const posts = await PagePost.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('author', 'name username profileImage')
      .populate('page', 'name username profileImage')
      .populate('comments.user', 'name username profileImage');

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

    const post = await PagePost.findOne({ _id: postId, page: pageId })
      .populate('author', 'name username profileImage')
      .populate('page', 'name username profileImage')
      .populate('comments.user', 'name username profileImage')
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
    const { content, media, isPinned, isPublished } = req.body;

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

    await post.save();

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

    // Update page post count
    page.postCount = Math.max(0, page.postCount - 1);
    await page.save();

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

    await post.addComment(req.user._id, content);

    // Populate the newly added comment
    await post.populate('comments.user', 'name username profileImage');

    const newComment = post.comments[post.comments.length - 1];

    console.log('✅ [PAGE POST] Comment added to post:', postId);

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment: newComment,
      commentCount: post.commentCount
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

    const comment = post.comments.id(commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user is comment author or page owner/editor
    const page = await Page.findById(pageId);
    if (comment.user.toString() !== req.user._id.toString() && !page.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this comment'
      });
    }

    await post.removeComment(commentId);

    console.log('✅ [PAGE POST] Comment deleted from post:', postId);

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      commentCount: post.commentCount
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
  getPagePosts,
  getPagePost,
  updatePagePost,
  deletePagePost,
  toggleLikePagePost,
  addCommentToPagePost,
  deleteCommentFromPagePost,
  sharePagePost
};
