const express = require('express');
const router = express.Router();
const Page = require('../models/Page');
const PageFollower = require('../models/PageFollower');
const { protect } = require('../middleware/authMiddleware');

// @route   POST /api/pages
// @desc    Create a new page
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      name,
      username,
      pageType,
      bio,
      description,
      profileImage,
      coverImage,
      category,
      subcategory,
      contactInfo
    } = req.body;

    // Validate required fields
    if (!name || !username || !pageType) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, username, and page type'
      });
    }

    // Check if username is already taken
    const existingPage = await Page.findOne({ username: username.toLowerCase() });
    if (existingPage) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken'
      });
    }

    // Create page
    const page = await Page.create({
      name,
      username: username.toLowerCase(),
      pageType,
      bio: bio || '',
      description: description || '',
      profileImage: profileImage || '',
      coverImage: coverImage || '',
      category: category || '',
      subcategory: subcategory || '',
      contactInfo: contactInfo || {},
      owner: req.user._id
    });

    console.log(`✅ [PAGES] Page created: ${page.name} (@${page.username}) by user ${req.user._id}`);

    res.status(201).json({
      success: true,
      message: 'Page created successfully',
      page
    });
  } catch (error) {
    console.error('❌ [PAGES] Error creating page:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create page'
    });
  }
});

// @route   GET /api/pages/:id
// @desc    Get page by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const page = await Page.findById(req.params.id)
      .populate('owner', 'name username profileImage')
      .populate('team.userId', 'name username profileImage');

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // Check if user is following (if authenticated)
    let isFollowing = false;
    if (req.user) {
      isFollowing = await PageFollower.isFollowing(page._id, req.user._id);
    }

    res.json({
      success: true,
      page,
      isFollowing
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch page'
    });
  }
});

// @route   GET /api/pages/username/:username
// @desc    Get page by username
// @access  Public
router.get('/username/:username', async (req, res) => {
  try {
    const page = await Page.findOne({ username: req.params.username.toLowerCase() })
      .populate('owner', 'name username profileImage')
      .populate('team.userId', 'name username profileImage');

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // Check if user is following (if authenticated)
    let isFollowing = false;
    if (req.user) {
      isFollowing = await PageFollower.isFollowing(page._id, req.user._id);
    }

    res.json({
      success: true,
      page,
      isFollowing
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch page'
    });
  }
});

// @route   PUT /api/pages/:id
// @desc    Update page
// @access  Private (Owner or Admin only)
router.put('/:id', protect, async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // Check if user has permission to edit
    if (!page.isOwner(req.user._id) && !page.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this page'
      });
    }

    // Update allowed fields
    const allowedUpdates = [
      'name', 'bio', 'description', 'profileImage', 'coverImage',
      'category', 'subcategory', 'contactInfo', 'isPublic',
      'allowMessages', 'allowComments', 'allowCollaborations', 'autoReply'
    ];

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        page[field] = req.body[field];
      }
    });

    await page.save();

    console.log(`✅ [PAGES] Page updated: ${page.name} (@${page.username})`);

    res.json({
      success: true,
      message: 'Page updated successfully',
      page
    });
  } catch (error) {
    console.error('❌ [PAGES] Error updating page:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update page'
    });
  }
});

// @route   DELETE /api/pages/:id
// @desc    Delete page
// @access  Private (Owner only)
router.delete('/:id', protect, async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // Only owner can delete
    if (!page.isOwner(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only the page owner can delete this page'
      });
    }

    // Delete all followers
    await PageFollower.deleteMany({ pageId: page._id });

    // Delete page
    await page.deleteOne();

    console.log(`✅ [PAGES] Page deleted: ${page.name} (@${page.username})`);

    res.json({
      success: true,
      message: 'Page deleted successfully'
    });
  } catch (error) {
    console.error('❌ [PAGES] Error deleting page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete page'
    });
  }
});

// @route   GET /api/pages/user/:userId
// @desc    Get user's pages
// @access  Public
router.get('/user/:userId', async (req, res) => {
  try {
    const pages = await Page.find({ owner: req.params.userId })
      .sort('-createdAt')
      .select('-team -analytics');

    res.json({
      success: true,
      pages,
      count: pages.length
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching user pages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pages'
    });
  }
});

// @route   GET /api/pages/my/pages
// @desc    Get current user's pages
// @access  Private
router.get('/my/pages', protect, async (req, res) => {
  try {
    const pages = await Page.find({ owner: req.user._id })
      .sort('-createdAt');

    res.json({
      success: true,
      pages,
      count: pages.length
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching my pages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pages'
    });
  }
});

// @route   POST /api/pages/:id/follow
// @desc    Follow a page
// @access  Private
router.post('/:id/follow', protect, async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    const result = await PageFollower.followPage(page._id, req.user._id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log(`✅ [PAGES] User ${req.user._id} followed page ${page.name}`);

    res.json({
      success: true,
      message: 'Successfully followed page',
      followerCount: page.followerCount + 1
    });
  } catch (error) {
    console.error('❌ [PAGES] Error following page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to follow page'
    });
  }
});

// @route   POST /api/pages/:id/unfollow
// @desc    Unfollow a page
// @access  Private
router.post('/:id/unfollow', protect, async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    const result = await PageFollower.unfollowPage(page._id, req.user._id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log(`✅ [PAGES] User ${req.user._id} unfollowed page ${page.name}`);

    res.json({
      success: true,
      message: 'Successfully unfollowed page',
      followerCount: Math.max(0, page.followerCount - 1)
    });
  } catch (error) {
    console.error('❌ [PAGES] Error unfollowing page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unfollow page'
    });
  }
});

// @route   GET /api/pages/:id/followers
// @desc    Get page followers
// @access  Public
router.get('/:id/followers', async (req, res) => {
  try {
    const { limit = 20, skip = 0 } = req.query;

    const followers = await PageFollower.getPageFollowers(req.params.id, {
      limit: parseInt(limit),
      skip: parseInt(skip)
    });

    res.json({
      success: true,
      followers,
      count: followers.length
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching followers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch followers'
    });
  }
});

// @route   GET /api/pages/:id/is-following
// @desc    Check if user is following page
// @access  Private
router.get('/:id/is-following', protect, async (req, res) => {
  try {
    const isFollowing = await PageFollower.isFollowing(req.params.id, req.user._id);

    res.json({
      success: true,
      isFollowing
    });
  } catch (error) {
    console.error('❌ [PAGES] Error checking follow status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check follow status'
    });
  }
});

// @route   POST /api/pages/check-username
// @desc    Check if username is available
// @access  Public
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    const isAvailable = await Page.isUsernameAvailable(username);

    res.json({
      success: true,
      available: isAvailable,
      username: username.toLowerCase()
    });
  } catch (error) {
    console.error('❌ [PAGES] Error checking username:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check username'
    });
  }
});

module.exports = router;
