const StatusPrivacy = require('../models/statusPrivacyModel');
const User = require('../models/userModel');
const Group = require('../models/groupModel');
const { validatePrivacySettings, sanitizePrivacySettings, checkPrivacyRateLimit } = require('../utils/privacyValidation');

/**
 * @desc    Get privacy API information and user's current settings
 * @route   GET /api/status-privacy
 * @access  Private
 */
const getPrivacyInfo = async (req, res) => {
  try {
    // Get user's current privacy settings
    const privacySettings = await StatusPrivacy.getDefaultPrivacySettings(req.user._id);
    
    res.status(200).json({
      success: true,
      message: 'Status Privacy API',
      data: {
        currentSettings: privacySettings,
        availableVisibilityOptions: [
          'public',
          'private', 
          'contacts_only',
          'app_connections_only',
          'friends',
          'selected_groups',
          'custom_list'
        ],
        endpoints: {
          getCurrentSettings: 'GET /api/status-privacy',
          getDefaultSettings: 'GET /api/status-privacy/default',
          updateDefaultSettings: 'PUT /api/status-privacy/default',
          getStatusSettings: 'GET /api/status-privacy/status/:statusId',
          setStatusSettings: 'POST /api/status-privacy/status/:statusId',
          checkVisibility: 'GET /api/status-privacy/can-see/:userId/:statusId',
          getUserGroups: 'GET /api/status-privacy/groups'
        }
      }
    });
  } catch (error) {
    console.error('Error getting privacy info:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching privacy information',
      error: error.message,
    });
  }
};

/**
 * @desc    Get user's default privacy settings
 * @route   GET /api/status-privacy/default
 * @access  Private
 */
const getDefaultPrivacySettings = async (req, res) => {
  try {
    const privacySettings = await StatusPrivacy.getDefaultPrivacySettings(req.user._id);
    
    res.status(200).json({
      success: true,
      data: privacySettings,
    });
  } catch (error) {
    console.error('Error getting default privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching privacy settings',
      error: error.message,
    });
  }
};

/**
 * @desc    Update user's default privacy settings
 * @route   PUT /api/status-privacy/default
 * @route   PUT /api/status-privacy
 * @access  Private
 */
const updateDefaultPrivacySettings = async (req, res) => {
  try {
    console.log('🔒 [Privacy] Received privacy settings update request:', JSON.stringify(req.body, null, 2));
    
    // Extract privacy settings from request body (handle nested structure)
    let privacyData = req.body;
    
    // If the request contains nested currentSettings, extract it
    if (req.body.currentSettings && typeof req.body.currentSettings === 'object') {
      privacyData = req.body.currentSettings;
      console.log('🔒 [Privacy] Extracted currentSettings from nested request');
    }
    
    // If visibility is at root level, use that
    if (req.body.visibility && !privacyData.visibility) {
      privacyData.visibility = req.body.visibility;
      console.log('🔒 [Privacy] Using root-level visibility:', req.body.visibility);
    }
    
    // Extract other root-level privacy fields if they exist
    if (req.body.allowedContacts) privacyData.allowedContacts = req.body.allowedContacts;
    if (req.body.allowedGroups) privacyData.allowedGroups = req.body.allowedGroups;
    if (req.body.blockedContacts) privacyData.blockedContacts = req.body.blockedContacts;
    if (req.body.locationSharing) privacyData.locationSharing = req.body.locationSharing;
    
    console.log('🔒 [Privacy] Final privacy data to validate:', JSON.stringify(privacyData, null, 2));
    
    // Check rate limit (with error handling)
    let rateLimit;
    try {
      rateLimit = checkPrivacyRateLimit(req.user._id, 'update_default');
    } catch (rateLimitError) {
      console.warn('🔒 [Privacy] Rate limit check failed, proceeding:', rateLimitError.message);
      rateLimit = { allowed: true }; // Allow if rate limit check fails
    }
    
    if (!rateLimit.allowed) {
      console.log('🔒 [Privacy] Rate limit exceeded for user:', req.user._id);
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        resetTime: rateLimit.resetTime
      });
    }
    
    // Validate input (with error handling)
    console.log('🔒 [Privacy] Validating privacy settings...');
    let validation;
    try {
      validation = validatePrivacySettings(privacyData);
      console.log('🔒 [Privacy] Validation result:', validation);
    } catch (validationError) {
      console.warn('🔒 [Privacy] Validation function failed, using basic validation:', validationError.message);
      // Basic validation fallback
      validation = {
        isValid: privacyData.visibility && typeof privacyData.visibility === 'string',
        errors: privacyData.visibility ? [] : ['Visibility is required']
      };
    }
    
    if (!validation.isValid) {
      console.log('🔒 [Privacy] Validation failed:', validation.errors);
      return res.status(400).json({
        success: false,
        message: 'Invalid privacy settings',
        errors: validation.errors
      });
    }
    
    // Sanitize input (with error handling)
    let sanitizedSettings;
    try {
      sanitizedSettings = sanitizePrivacySettings(privacyData);
    } catch (sanitizeError) {
      console.warn('🔒 [Privacy] Sanitization failed, using original data:', sanitizeError.message);
      // Use original data if sanitization fails, but remove unsafe fields
      sanitizedSettings = {
        visibility: privacyData.visibility,
        allowedGroups: Array.isArray(privacyData.allowedGroups) ? privacyData.allowedGroups : [],
        allowedContacts: Array.isArray(privacyData.allowedContacts) ? privacyData.allowedContacts : [],
        blockedContacts: Array.isArray(privacyData.blockedContacts) ? privacyData.blockedContacts : [],
        locationSharing: privacyData.locationSharing || {
          enabled: true,
          shareWith: 'all',
          allowedGroups: [],
          allowedContacts: []
        }
      };
    }
    
    // Update or create default privacy settings
    const privacySettings = await StatusPrivacy.findOneAndUpdate(
      { userId: req.user._id, isDefault: true },
      {
        userId: req.user._id,
        ...sanitizedSettings,
        isDefault: true,
      },
      { new: true, upsert: true }
    );
    
    res.status(200).json({
      success: true,
      data: privacySettings,
      message: 'Privacy settings updated successfully',
    });
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating privacy settings',
      error: error.message,
    });
  }
};

/**
 * @desc    Set privacy settings for a specific status
 * @route   POST /api/status-privacy/status/:statusId
 * @access  Private
 */
const setStatusPrivacySettings = async (req, res) => {
  try {
    const { statusId } = req.params;
    const { visibility, allowedGroups, allowedContacts, blockedContacts, locationSharing } = req.body;
    
    // Validate visibility
    const validVisibilities = ['public', 'contacts_only', 'app_connections_only', 'selected_groups', 'custom_list', 'private'];
    if (!validVisibilities.includes(visibility)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid visibility setting',
      });
    }
    
    // Create or update status-specific privacy settings
    const privacySettings = await StatusPrivacy.findOneAndUpdate(
      { userId: req.user._id, statusId },
      {
        userId: req.user._id,
        statusId,
        visibility,
        allowedGroups: allowedGroups || [],
        allowedContacts: allowedContacts || [],
        blockedContacts: blockedContacts || [],
        locationSharing: locationSharing || {
          enabled: true,
          shareWith: 'all',
          allowedGroups: [],
          allowedContacts: [],
        },
        isDefault: false,
      },
      { new: true, upsert: true }
    );
    
    res.status(200).json({
      success: true,
      data: privacySettings,
      message: 'Status privacy settings updated successfully',
    });
  } catch (error) {
    console.error('Error setting status privacy:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while setting status privacy',
      error: error.message,
    });
  }
};

/**
 * @desc    Get privacy settings for a specific status
 * @route   GET /api/status-privacy/status/:statusId
 * @access  Private
 */
const getStatusPrivacySettings = async (req, res) => {
  try {
    const { statusId } = req.params;
    
    // Try to get status-specific privacy settings
    let privacySettings = await StatusPrivacy.findOne({ 
      userId: req.user._id, 
      statusId 
    });
    
    // If no status-specific settings, get default settings
    if (!privacySettings) {
      privacySettings = await StatusPrivacy.getDefaultPrivacySettings(req.user._id);
    }
    
    res.status(200).json({
      success: true,
      data: privacySettings,
    });
  } catch (error) {
    console.error('Error getting status privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching status privacy settings',
      error: error.message,
    });
  }
};

/**
 * @desc    Check if current user can see another user's status
 * @route   GET /api/status-privacy/can-see/:userId/:statusId
 * @route   GET /api/status-privacy/can-see/:userId
 * @access  Private
 */
const canSeeUserStatus = async (req, res) => {
  try {
    const { userId, statusId } = req.params;
    
    const canSee = await StatusPrivacy.canUserSeeStatus(
      userId,
      req.user._id,
      statusId || null
    );
    
    res.status(200).json({
      success: true,
      data: {
        canSee,
        userId,
        statusId: statusId || null,
      },
    });
  } catch (error) {
    console.error('Error checking status visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking status visibility',
      error: error.message,
    });
  }
};

/**
 * @desc    Get all users who can see current user's status
 * @route   GET /api/status-privacy/viewers/:statusId
 * @route   GET /api/status-privacy/viewers
 * @access  Private
 */
const getStatusViewers = async (req, res) => {
  try {
    const { statusId } = req.params;
    
    // Get privacy settings for the status
    let privacySettings;
    if (statusId) {
      privacySettings = await StatusPrivacy.findOne({ 
        userId: req.user._id, 
        statusId 
      });
    }
    
    if (!privacySettings) {
      privacySettings = await StatusPrivacy.getDefaultPrivacySettings(req.user._id);
    }
    
    let viewers = [];
    
    switch (privacySettings.visibility) {
      case 'public':
        // All users can see - return a flag instead of all users for performance
        viewers = { type: 'public', message: 'All users can see this status' };
        break;
        
      case 'private':
        viewers = [];
        break;
        
      case 'friends':
        // Get all user's contacts/friends
        viewers = { type: 'friends', message: 'All your contacts can see this status' };
        break;
        
      case 'groups':
        // Get users from allowed groups
        const groups = await Group.find({ 
          _id: { $in: privacySettings.allowedGroups } 
        }).populate('members', 'name phoneNumber');
        
        viewers = groups.reduce((acc, group) => {
          return acc.concat(group.members);
        }, []);
        break;
        
      case 'contacts':
        // Get specific allowed contacts
        viewers = await User.find({ 
          _id: { $in: privacySettings.allowedContacts } 
        }).select('name phoneNumber');
        break;
    }
    
    res.status(200).json({
      success: true,
      data: {
        visibility: privacySettings.visibility,
        viewers,
        totalCount: Array.isArray(viewers) ? viewers.length : null,
      },
    });
  } catch (error) {
    console.error('Error getting status viewers:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting status viewers',
      error: error.message,
    });
  }
};

/**
 * @desc    Get user's groups for privacy settings
 * @route   GET /api/status-privacy/groups
 * @access  Private
 */
const getUserGroups = async (req, res) => {
  try {
    // Get groups where user is a member
    const groups = await Group.find({ 
      members: req.user._id 
    }).select('name description memberCount');
    
    res.status(200).json({
      success: true,
      data: groups,
    });
  } catch (error) {
    console.error('Error getting user groups:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching groups',
      error: error.message,
    });
  }
};

module.exports = {
  getPrivacyInfo,
  getDefaultPrivacySettings,
  updateDefaultPrivacySettings,
  setStatusPrivacySettings,
  getStatusPrivacySettings,
  canSeeUserStatus,
  getStatusViewers,
  getUserGroups,
};
