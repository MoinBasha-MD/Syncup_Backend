const PublicStatusCache = require('../models/PublicStatusCache');
const User = require('../models/userModel');
const StatusPrivacy = require('../models/statusPrivacyModel');

// Rate limiting map: phoneNumber -> { count, resetTime }
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_LOOKUPS_PER_WINDOW = 10;

/**
 * @desc    Get public status by phone number (for dial pad)
 * @route   GET /api/users/public-status?phone=XXXXXXXXXX
 * @access  Private (requires auth)
 */
const getPublicStatus = async (req, res) => {
  try {
    const { phone } = req.query;
    const requesterId = req.user._id.toString();

    // Validate phone parameter
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    // Normalize phone number
    const normalizedPhone = phone.replace(/[\s\-\(\)\+]/g, '');

    // Validate phone format (10 digits for Indian numbers)
    if (!/^\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format (expected 10 digits)',
      });
    }

    // Rate limiting check
    const now = Date.now();
    const rateLimitKey = requesterId;
    
    if (!rateLimitMap.has(rateLimitKey)) {
      rateLimitMap.set(rateLimitKey, { count: 0, resetTime: now + RATE_LIMIT_WINDOW });
    }

    const rateLimit = rateLimitMap.get(rateLimitKey);
    
    if (now > rateLimit.resetTime) {
      // Reset window
      rateLimit.count = 0;
      rateLimit.resetTime = now + RATE_LIMIT_WINDOW;
    }

    if (rateLimit.count >= MAX_LOOKUPS_PER_WINDOW) {
      console.log(`⚠️ [PUBLIC STATUS] Rate limit exceeded for user ${requesterId}`);
      return res.status(429).json({
        success: false,
        message: 'Too many status lookups. Please wait a moment.',
        retryAfter: Math.ceil((rateLimit.resetTime - now) / 1000),
      });
    }

    rateLimit.count++;

    // Check if requester is trying to look up their own number
    const requester = await User.findById(req.user._id).select('phoneNumber');
    if (requester && requester.phoneNumber === normalizedPhone) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Cannot lookup your own status',
      });
    }

    // Query the cache
    const publicStatus = await PublicStatusCache.getPublicStatus(normalizedPhone);

    if (!publicStatus) {
      // No public status available (user doesn't exist, hasn't enabled public status, or no status set)
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No public status available',
      });
    }

    // Return minimal status info (no name, no photo)
    const responseData = {
      hasStatus: true,
      status: publicStatus.mainStatus || publicStatus.status || 'Available',
      customStatus: publicStatus.customStatus || '',
      subStatus: publicStatus.subStatus || null,
      statusUntil: publicStatus.statusUntil,
      isExpired: publicStatus.isExpired || false,
    };

    console.log(`✅ [PUBLIC STATUS] Lookup successful for ${normalizedPhone}: ${responseData.status}`);

    res.status(200).json({
      success: true,
      data: responseData,
    });

  } catch (error) {
    console.error('❌ [PUBLIC STATUS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching public status',
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle public status visibility for current user
 * @route   PUT /api/users/public-status-toggle
 * @access  Private
 */
const togglePublicStatus = async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user._id;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled field must be a boolean',
      });
    }

    // Update privacy settings
    const privacySettings = await StatusPrivacy.findOneAndUpdate(
      { userId, isDefault: true },
      { 
        allowPublicDialerLookup: enabled,
      },
      { new: true, upsert: true }
    );

    console.log(`🔒 [PUBLIC STATUS] User ${req.user.userId} set public dialer lookup: ${enabled}`);

    if (enabled) {
      // Add to cache immediately with current status
      const user = await User.findById(userId).select('phoneNumber status customStatus mainStatus subStatus statusUntil mainEndTime subEndTime');
      
      // Validate phone number exists
      if (!user || !user.phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'Cannot enable public status without a phone number. Please add a phone number to your account first.',
        });
      }
      
      await PublicStatusCache.upsertPublicStatus(userId, user.phoneNumber, {
        status: user.status,
        customStatus: user.customStatus,
        mainStatus: user.mainStatus,
        subStatus: user.subStatus,
        statusUntil: user.statusUntil,
        mainEndTime: user.mainEndTime,
        subEndTime: user.subEndTime,
      });
      console.log(`✅ [PUBLIC STATUS] Added user to cache: ${user.phoneNumber}`);
    } else {
      // Remove from cache
      const user = await User.findById(userId).select('phoneNumber');
      if (user && user.phoneNumber) {
        await PublicStatusCache.removePublicStatus(user.phoneNumber);
        console.log(`✅ [PUBLIC STATUS] Removed user from cache: ${user.phoneNumber}`);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        allowPublicDialerLookup: enabled,
      },
      message: `Public status ${enabled ? 'enabled' : 'disabled'} successfully`,
    });

  } catch (error) {
    console.error('❌ [PUBLIC STATUS] Toggle error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while toggling public status',
      error: error.message,
    });
  }
};

/**
 * @desc    Get current user's public status setting
 * @route   GET /api/users/public-status-setting
 * @access  Private
 */
const getPublicStatusSetting = async (req, res) => {
  try {
    const userId = req.user._id;

    const privacySettings = await StatusPrivacy.findOne({ userId, isDefault: true });

    const enabled = privacySettings?.allowPublicDialerLookup || false;

    res.status(200).json({
      success: true,
      data: {
        allowPublicDialerLookup: enabled,
      },
    });

  } catch (error) {
    console.error('❌ [PUBLIC STATUS] Get setting error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching public status setting',
      error: error.message,
    });
  }
};

module.exports = {
  getPublicStatus,
  togglePublicStatus,
  getPublicStatusSetting,
};
