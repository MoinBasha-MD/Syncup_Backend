const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Page = require('../models/Page');
const PageFollower = require('../models/PageFollower');
const { protect } = require('../middleware/authMiddleware');

// ✅ WEEK 2 FIX: Import rate limiting middleware
const {
  pageCreationLimiter,
  followLimiter
} = require('../middleware/rateLimiter');

// ✅ WEEK 2 FIX: Import validation middleware
const { validatePageCreation } = require('../middleware/validatePagePost');

// ✅ PERMANENT FIX: Import page image handler middleware
const { processPageImages, constructImageUrl } = require('../middleware/pageImageHandler');

// @route   POST /api/pages
// @desc    Create a new page
// @access  Private
router.post('/', protect, pageCreationLimiter, validatePageCreation, async (req, res) => {
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

    // ✅ AUTO-FOLLOW FIX: Page owner automatically follows their own page
    try {
      const User = require('../models/User');
      const user = await User.findById(req.user._id);
      
      if (user) {
        // Calculate age from dateOfBirth
        let age = null;
        if (user.dateOfBirth) {
          const birthDate = new Date(user.dateOfBirth);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
        }
        
        // Extract country code
        let countryCode = null;
        if (user.country) {
          countryCode = user.country;
        } else if (user.phoneNumber && user.phoneNumber.startsWith('+')) {
          const phoneMatch = user.phoneNumber.match(/^\+(\d{1,3})/);
          if (phoneMatch) {
            const code = phoneMatch[1];
            const codeMap = {
              '1': 'US', '91': 'IN', '44': 'UK', '86': 'CN', 
              '81': 'JP', '49': 'DE', '33': 'FR', '39': 'IT'
            };
            countryCode = codeMap[code] || null;
          }
        }
        
        // Create auto-follow for page owner
        await PageFollower.create({
          pageId: page._id,
          userId: req.user._id,
          demographics: {
            age: age,
            gender: user.gender || null,
            location: {
              country: user.country || null,
              countryCode: countryCode,
              city: user.city || null,
              state: user.state || null,
              coordinates: user.location ? {
                lat: user.location.lat,
                lng: user.location.lng
              } : null
            },
            language: user.preferredLanguage || user.language || null,
            timezone: user.timezone || null
          },
          segment: 'new',
          engagement: {
            lastInteraction: new Date(),
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
            totalViews: 0,
            engagementScore: 0
          }
        });
        
        // Update follower count
        page.followerCount = 1;
        await page.save();
        
        console.log(`✅ [PAGES] Page owner auto-followed their page: ${page.name}`);
      }
    } catch (autoFollowError) {
      console.error('❌ [PAGES] Auto-follow failed (non-critical):', autoFollowError.message);
      // Don't fail page creation if auto-follow fails
    }

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

// @route   POST /api/pages/check-username
// @desc    Check if username is available
// @access  Public
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    console.log('🔍 [PAGES] Checking username availability:', username);

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    // Check if username exists
    const existingPage = await Page.findOne({ username: username.toLowerCase() });
    const isAvailable = !existingPage;

    console.log(`✅ [PAGES] Username "${username}" check result:`, {
      isAvailable,
      existingPage: existingPage ? { id: existingPage._id, name: existingPage.name } : null
    });

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

// @route   POST /api/pages/suggest-usernames
// @desc    Generate username suggestions based on name
// @access  Public
router.post('/suggest-usernames', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    // Generate username suggestions
    const suggestions = [];
    const baseName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Strategy 1: Just the name
    suggestions.push(baseName);
    
    // Strategy 2: Name with random numbers
    suggestions.push(`${baseName}${Math.floor(Math.random() * 1000)}`);
    suggestions.push(`${baseName}${Math.floor(Math.random() * 10000)}`);
    
    // Strategy 3: Name with year
    const currentYear = new Date().getFullYear();
    suggestions.push(`${baseName}${currentYear}`);
    
    // Strategy 4: Name with underscore and numbers
    suggestions.push(`${baseName}_${Math.floor(Math.random() * 100)}`);
    
    // Strategy 5: Name with "official", "real", "the"
    suggestions.push(`official${baseName}`);
    suggestions.push(`the${baseName}`);
    suggestions.push(`real${baseName}`);
    
    // Check availability for each suggestion
    const availableSuggestions = [];
    for (const suggestion of suggestions) {
      const isAvailable = await Page.isUsernameAvailable(suggestion);
      if (isAvailable) {
        availableSuggestions.push(suggestion);
        if (availableSuggestions.length >= 3) break; // Return top 3
      }
    }

    // If we don't have 3 suggestions, generate more with random numbers
    while (availableSuggestions.length < 3) {
      const randomSuggestion = `${baseName}${Math.floor(Math.random() * 100000)}`;
      const isAvailable = await Page.isUsernameAvailable(randomSuggestion);
      if (isAvailable && !availableSuggestions.includes(randomSuggestion)) {
        availableSuggestions.push(randomSuggestion);
      }
    }

    res.json({
      success: true,
      suggestions: availableSuggestions.slice(0, 3)
    });
  } catch (error) {
    console.error('❌ [PAGES] Error generating username suggestions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate username suggestions'
    });
  }
});

// @route   GET /api/pages/suggested
// @desc    Get suggested pages for user
// @access  Private
router.get('/suggested', protect, async (req, res) => {
  try {
    console.log('📄 [PAGES] Fetching suggested pages for user:', req.user._id);

    // Build list of possible identifiers for the current user
    const rawUserIds = [req.user?._id, req.user?.id, req.user?.userId];
    const userObjectIds = rawUserIds
      .filter(Boolean)
      .map((value) => {
        if (mongoose.Types.ObjectId.isValid(value)) {
          return new mongoose.Types.ObjectId(value);
        }
        return null;
      })
      .filter(Boolean);

    let followedPageIds = [];

    if (userObjectIds.length > 0) {
      // Get pages user is already following
      followedPageIds = await PageFollower.find({ 
        userId: { $in: userObjectIds }
      }).distinct('pageId');
    }

    console.log(`📄 [PAGES] User is following ${followedPageIds.length} pages`);
    
    // Get popular public pages user doesn't follow
    const suggestedPages = await Page.find({
      _id: { $nin: followedPageIds },
      isPublic: true
    })
    .sort('-followerCount') // Sort by most popular
    .limit(10)
    .populate('owner', 'name username profileImage');
    
    console.log(`✅ [PAGES] Found ${suggestedPages.length} suggested pages`);
    
    res.json({
      success: true,
      pages: suggestedPages,
      count: suggestedPages.length
    });
  } catch (error) {
    console.error('❌ [PAGES] Error getting suggested pages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get suggested pages'
    });
  }
});

// @route   GET /api/pages/my/pages
// @desc    Get current user's pages
// @access  Private
router.get('/my/pages', protect, processPageImages, async (req, res) => {
  try {
    console.log('📄 [PAGES] Fetching pages for user:', req.user._id);
    
    const pages = await Page.find({ owner: req.user._id })
      .sort('-createdAt');

    console.log(`✅ [PAGES] Found ${pages.length} pages for user ${req.user._id}`);
    if (pages.length > 0) {
      console.log('📄 [PAGES] Page details:', pages.map(p => ({
        id: p._id,
        name: p.name,
        username: p.username,
        createdAt: p.createdAt
      })));
    }

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

// @route   GET /api/pages/following
// @desc    Get pages user is following
// @access  Private
router.get('/following', protect, processPageImages, async (req, res) => {
  try {
    console.log('📄 [PAGES] Fetching following pages for user:', req.user._id);
    
    const followedPages = await PageFollower.find({ 
      userId: req.user._id 
    })
    .populate({
      path: 'pageId',
      populate: { path: 'owner', select: 'name username profileImage' }
    })
    .sort('-createdAt');
    
    // Filter out null pages (in case page was deleted)
    const pages = followedPages
      .map(f => f.pageId)
      .filter(p => p != null);
    
    console.log(`✅ [PAGES] Found ${pages.length} following pages for user`);
    
    res.json({
      success: true,
      pages,
      count: pages.length
    });
  } catch (error) {
    console.error('❌ [PAGES] Error fetching following pages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch following pages'
    });
  }
});

// @route   GET /api/pages/:id
// @desc    Get page by ID
// @access  Public
router.get('/:id', processPageImages, async (req, res) => {
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

    // ✅ AUTO-FOLLOW FIX: Handle team member additions
    if (req.body.team !== undefined && Array.isArray(req.body.team)) {
      const oldTeamIds = page.team.map(m => m.userId.toString());
      const newTeamIds = req.body.team.map(m => m.userId.toString());
      
      // Find newly added team members
      const addedMemberIds = newTeamIds.filter(id => !oldTeamIds.includes(id));
      
      if (addedMemberIds.length > 0) {
        console.log(`📢 [PAGES] New team members added: ${addedMemberIds.length}`);
        
        // Auto-follow for each new team member
        const User = require('../models/User');
        
        for (const memberId of addedMemberIds) {
          try {
            // Check if already following
            const existingFollow = await PageFollower.findOne({
              pageId: page._id,
              userId: memberId
            });
            
            if (!existingFollow) {
              const user = await User.findById(memberId);
              
              if (user) {
                // Calculate age
                let age = null;
                if (user.dateOfBirth) {
                  const birthDate = new Date(user.dateOfBirth);
                  const today = new Date();
                  age = today.getFullYear() - birthDate.getFullYear();
                  const monthDiff = today.getMonth() - birthDate.getMonth();
                  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                  }
                }
                
                // Extract country code
                let countryCode = null;
                if (user.country) {
                  countryCode = user.country;
                } else if (user.phoneNumber && user.phoneNumber.startsWith('+')) {
                  const phoneMatch = user.phoneNumber.match(/^\+(\d{1,3})/);
                  if (phoneMatch) {
                    const code = phoneMatch[1];
                    const codeMap = {
                      '1': 'US', '91': 'IN', '44': 'UK', '86': 'CN', 
                      '81': 'JP', '49': 'DE', '33': 'FR', '39': 'IT'
                    };
                    countryCode = codeMap[code] || null;
                  }
                }
                
                // Create auto-follow
                await PageFollower.create({
                  pageId: page._id,
                  userId: memberId,
                  demographics: {
                    age: age,
                    gender: user.gender || null,
                    location: {
                      country: user.country || null,
                      countryCode: countryCode,
                      city: user.city || null,
                      state: user.state || null,
                      coordinates: user.location ? {
                        lat: user.location.lat,
                        lng: user.location.lng
                      } : null
                    },
                    language: user.preferredLanguage || user.language || null,
                    timezone: user.timezone || null
                  },
                  segment: 'new',
                  engagement: {
                    lastInteraction: new Date(),
                    totalLikes: 0,
                    totalComments: 0,
                    totalShares: 0,
                    totalViews: 0,
                    engagementScore: 0
                  }
                });
                
                page.followerCount += 1;
                console.log(`✅ [PAGES] Team member auto-followed page: ${user.name || memberId}`);
              }
            } else {
              console.log(`ℹ️ [PAGES] Team member already following: ${memberId}`);
            }
          } catch (memberAutoFollowError) {
            console.error(`❌ [PAGES] Auto-follow failed for team member ${memberId}:`, memberAutoFollowError.message);
            // Continue with other members
          }
        }
      }
      
      // Update team array
      page.team = req.body.team;
    }

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

// @route   POST /api/pages/:id/follow
// @desc    Follow a page
// @access  Private
router.post('/:id/follow', protect, followLimiter, async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Page not found'
      });
    }

    // ✅ WEEK 2 FIX: Get User model to capture demographics (moved before follow creation)
    const User = require('../models/User');
    const user = await User.findById(req.user._id);

    // ✅ PHASE 1: Calculate age from dateOfBirth if available
    let age = null;
    if (user.dateOfBirth) {
      const birthDate = new Date(user.dateOfBirth);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    // ✅ PHASE 1: Extract country code from phone number or location
    let countryCode = null;
    if (user.country) {
      countryCode = user.country;
    } else if (user.phoneNumber && user.phoneNumber.startsWith('+')) {
      // Extract country code from phone number
      const phoneMatch = user.phoneNumber.match(/^\+(\d{1,3})/);
      if (phoneMatch) {
        const code = phoneMatch[1];
        // Map common country codes to ISO codes
        const codeMap = {
          '1': 'US', '91': 'IN', '44': 'UK', '86': 'CN', 
          '81': 'JP', '49': 'DE', '33': 'FR', '39': 'IT'
        };
        countryCode = codeMap[code] || null;
      }
    }

    // ✅ PHASE 1: Create follow with demographics
    const followerData = {
      pageId: page._id,
      userId: req.user._id,
      demographics: {
        age: age,
        gender: user.gender || null,
        location: {
          country: user.country || null,
          countryCode: countryCode,
          city: user.city || null,
          state: user.state || null,
          coordinates: user.location ? {
            lat: user.location.lat,
            lng: user.location.lng
          } : null
        },
        language: user.preferredLanguage || user.language || null,
        timezone: user.timezone || null
      },
      segment: 'new',
      engagement: {
        lastInteraction: new Date(),
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
        engagementScore: 0
      }
    };

    // ✅ WEEK 2 FIX: Use try-catch to handle duplicate key errors from unique index
    try {
      const follow = await PageFollower.create(followerData);

      // Update page follower count
      page.followerCount += 1;
      await page.save();

      console.log(`✅ [PAGES] User ${req.user._id} followed page ${page.name}`);
      console.log(`📊 [PAGES] Demographics captured:`, {
        age: age,
        country: countryCode,
        gender: user.gender
      });

      res.json({
        success: true,
        message: 'Successfully followed page',
        followerCount: page.followerCount
      });
    } catch (followError) {
      // ✅ WEEK 2 FIX: Handle duplicate key error (race condition)
      if (followError.code === 11000) {
        console.log(`⚠️ [PAGES] User ${req.user._id} already following page ${page.name} (race condition caught)`);
        return res.status(400).json({
          success: false,
          message: 'Already following this page'
        });
      }
      // Re-throw other errors
      throw followError;
    }
  } catch (error) {
    console.error('❌ [PAGES] Error following page:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to follow page',
      error: error.message
    });
  }
});

// @route   POST /api/pages/:id/unfollow
// @desc    Unfollow a page
// @access  Private
router.post('/:id/unfollow', protect, followLimiter, async (req, res) => {
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

module.exports = router;
