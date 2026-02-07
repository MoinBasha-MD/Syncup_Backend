const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');

// Create a new Primary Time profile
exports.createProfile = async (req, res) => {
  try {
    const { name, status, days, startTime, endTime, location, notifications, recurrence, priority } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!name || !status || !days || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, status, days, startTime, endTime',
      });
    }

    // Create profile
    const profile = new PrimaryTimeProfile({
      userId,
      name,
      status,
      days,
      startTime,
      endTime,
      location,
      notifications: notifications || {
        beforeStart: true,
        onStart: true,
        onEnd: true,
      },
      recurrence: recurrence || {
        type: 'weekly',
      },
      priority: priority || 1,
    });

    await profile.save();

    console.log(`✅ [PRIMARY TIME] Profile created: ${profile.name} for user ${userId}`);

    res.status(201).json(profile);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Create profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create Primary Time profile',
      error: error.message,
    });
  }
};

// Get all profiles for the authenticated user
exports.getProfiles = async (req, res) => {
  try {
    const userId = req.user._id;

    const profiles = await PrimaryTimeProfile.find({ userId }).sort({ priority: -1, createdAt: -1 });

    console.log(`📋 [PRIMARY TIME] Retrieved ${profiles.length} profiles for user ${userId}`);

    res.json(profiles);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Get profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profiles',
      error: error.message,
    });
  }
};

// Get a single profile by ID
exports.getProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const profile = await PrimaryTimeProfile.findOne({ _id: id, userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    res.json(profile);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message,
    });
  }
};

// Update a profile
exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updates = req.body;

    // Don't allow updating userId
    delete updates.userId;

    const profile = await PrimaryTimeProfile.findOneAndUpdate(
      { _id: id, userId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    console.log(`✅ [PRIMARY TIME] Profile updated: ${profile.name}`);

    res.json(profile);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
};

// Delete a profile
exports.deleteProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const profile = await PrimaryTimeProfile.findOneAndDelete({ _id: id, userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    console.log(`✅ [PRIMARY TIME] Profile deleted: ${profile.name}`);

    res.json({
      success: true,
      message: 'Profile deleted successfully',
    });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Delete profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile',
      error: error.message,
    });
  }
};

// Manually activate a profile
exports.activateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Deactivate all other profiles for this user
    await PrimaryTimeProfile.updateMany(
      { userId, isActive: true },
      { $set: { isActive: false } }
    );

    // Activate the requested profile
    const profile = await PrimaryTimeProfile.findOneAndUpdate(
      { _id: id, userId },
      { $set: { isActive: true } },
      { new: true }
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    console.log(`✅ [PRIMARY TIME] Profile activated: ${profile.name}`);

    res.json({
      success: true,
      message: 'Profile activated successfully',
      profile,
    });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Activate profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate profile',
      error: error.message,
    });
  }
};

// Deactivate a profile
exports.deactivateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const profile = await PrimaryTimeProfile.findOneAndUpdate(
      { _id: id, userId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    console.log(`✅ [PRIMARY TIME] Profile deactivated: ${profile.name}`);

    res.json({
      success: true,
      message: 'Profile deactivated successfully',
      profile,
    });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Deactivate profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate profile',
      error: error.message,
    });
  }
};

// Get currently active profile
exports.getActiveProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const profile = await PrimaryTimeProfile.findOne({ userId, isActive: true });

    if (!profile) {
      return res.json(null);
    }

    res.json(profile);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Get active profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve active profile',
      error: error.message,
    });
  }
};

// Get profiles that should be active right now
exports.getScheduledProfiles = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();

    const profiles = await PrimaryTimeProfile.find({ userId });

    const activeProfiles = profiles.filter(profile => profile.shouldBeActive(now));

    // Sort by priority (highest first)
    activeProfiles.sort((a, b) => b.priority - a.priority);

    res.json(activeProfiles);
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Get scheduled profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve scheduled profiles',
      error: error.message,
    });
  }
};
