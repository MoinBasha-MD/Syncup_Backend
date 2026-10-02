const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');
const primaryTimeScheduler = require('../services/primaryTimeScheduler');
const fcmService = require('../services/fcmNotificationService');
const socketManager = require('../socketManager');

/**
 * Push a lightweight "resync your alarms/profile cache" signal to the owner's
 * device(s). Used whenever profiles change but no status transition happened
 * (create/edit/enable-for-later/delete) so the device-side AlarmManager
 * schedule stays adaptive without waiting for the app to be opened.
 */
async function pushProfileSyncSignal(userId) {
  const payload = { type: 'primary_time_device_mode', action: 'sync' };
  try {
    socketManager.broadcastToUser(userId, 'primary_time_updated', payload);
  } catch (e) {
    console.error('⚠️ [PRIMARY TIME] Sync socket emit failed:', e.message);
  }
  try {
    if (fcmService.isEnabled()) {
      await fcmService.sendDataNotification(userId, payload);
    }
  } catch (e) {
    console.error('⚠️ [PRIMARY TIME] Sync FCM push failed:', e.message);
  }
}

// Create a new Primary Time profile
exports.createProfile = async (req, res) => {
  try {
    const { name, status, days, startTime, endTime, location, timezoneOffset, notifications, recurrence, priority } = req.body;
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
      timezoneOffset: timezoneOffset != null ? timezoneOffset : new Date().getTimezoneOffset(),
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

    // New schedule → owner devices should re-arm their local alarms.
    pushProfileSyncSignal(req.user.userId).catch(() => {});

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

    const profiles = await PrimaryTimeProfile.find({ userId }).sort({ startTime: 1, priority: -1 });

    // Auto-patch profiles whose stored timezoneOffset no longer matches the
    // client's — covers legacy offset=0 rows, DST shifts, and timezone travel.
    // The frontend sends its real offset via query param so we can backfill.
    const clientOffset = req.query.timezoneOffset != null ? Number(req.query.timezoneOffset) : null;
    if (clientOffset != null && clientOffset !== 0) {
      const needsPatch = profiles.filter(p => p.timezoneOffset !== clientOffset);
      if (needsPatch.length > 0) {
        await PrimaryTimeProfile.updateMany(
          { _id: { $in: needsPatch.map(p => p._id) } },
          { $set: { timezoneOffset: clientOffset } }
        );
        needsPatch.forEach(p => { p.timezoneOffset = clientOffset; });
        console.log(`🔧 [PRIMARY TIME] Auto-patched timezoneOffset=${clientOffset} on ${needsPatch.length} legacy profile(s)`);
      }
    }

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

    // Edits take effect immediately instead of waiting for the next cron tick:
    // if the profile is mid-window and its content changed, the per-user check
    // re-applies it; if the window moved, it activates/deactivates right away.
    primaryTimeScheduler.checkAndUpdateUserPrimaryTime(userId).catch(err => {
      console.error('⚠️ [PRIMARY TIME] Post-update check failed:', err.message);
    });
    // Owner devices re-arm their local alarms for the new schedule.
    pushProfileSyncSignal(req.user.userId).catch(() => {});

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

    const profile = await PrimaryTimeProfile.findOne({ _id: id, userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    // If the deleted profile was actively applying a status, run the full
    // deactivation first (resets user status, broadcasts, pushes restore).
    if (profile.isActive) {
      try {
        await primaryTimeScheduler.deactivateProfile(profile, userId);
      } catch (deactErr) {
        console.error('⚠️ [PRIMARY TIME] Deactivate-before-delete failed:', deactErr.message);
      }
    }

    await PrimaryTimeProfile.deleteOne({ _id: profile._id });

    console.log(`✅ [PRIMARY TIME] Profile deleted: ${profile.name}`);

    // Owner devices re-arm alarms without the deleted profile.
    pushProfileSyncSignal(req.user.userId).catch(() => {});

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

// Enable a profile schedule (user taps "activate")
// Multiple profiles can be isEnabled simultaneously — the scheduler picks the
// correct one based on the current time window and priority.
// This does NOT immediately change the user's status unless the current time
// falls within the profile's scheduled time window.
exports.activateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Enable the requested profile (do NOT disable other profiles —
    // multiple schedules can be enabled for different time windows)
    const profile = await PrimaryTimeProfile.findOneAndUpdate(
      { _id: id, userId },
      { $set: { isEnabled: true } },
      { new: true }
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    const now = new Date();
    const isWithinWindow = profile.shouldBeActive(now);

    console.log(`✅ [PRIMARY TIME] Profile enabled: ${profile.name} (within time window: ${isWithinWindow})`);

    let statusApplied = false;

    // Only apply status immediately if the current time is within the schedule window
    if (isWithinWindow) {
      try {
        // Deactivate any other currently-active profile first (only one status at a time)
        await PrimaryTimeProfile.updateMany(
          { userId, isActive: true, _id: { $ne: profile._id } },
          { $set: { isActive: false } }
        );

        profile.isActive = true;
        await profile.save();

        // Calculate end time in UTC using the profile's timezone offset
        // Profile stores local times (e.g., "17:00" IST). Convert to UTC for statusUntil.
        const [endH, endM] = profile.endTime.split(':').map(Number);
        const offsetMs = (profile.timezoneOffset || 0) * 60 * 1000;
        const localNow = new Date(now.getTime() - offsetMs);
        const localEnd = new Date(localNow);
        localEnd.setHours(endH, endM, 0, 0);
        if (localEnd <= localNow) localEnd.setDate(localEnd.getDate() + 1);
        // Convert local end back to UTC for storage
        const endTime = new Date(localEnd.getTime() + offsetMs);
        const durationMinutes = Math.round((endTime.getTime() - now.getTime()) / (1000 * 60));

        const user = await User.findById(userId);
        if (user) {
          user.status = profile.status;
          user.customStatus = profile.status;
          user.statusUpdatedAt = now;
          user.statusUntil = endTime;
          user.wasAutoApplied = false;
          user.primaryTimeProfileId = profile._id;

          // Set hierarchical fields (same as Quick tab)
          user.mainStatus = profile.status;
          user.mainDuration = durationMinutes;
          user.mainDurationLabel = `${durationMinutes} minutes`;
          user.mainStartTime = now;
          user.mainEndTime = endTime;

          if (profile.location && profile.location.placeName) {
            user.statusLocation = {
              placeName: profile.location.placeName,
              coordinates: profile.location.coordinates || {},
              address: profile.location.address || '',
              shareWithContacts: true,
              timestamp: now,
            };
          }
          await user.save();
          statusApplied = true;

          // Broadcast via socketManager (contact-filtered, same as Quick tab)
          try {
            const socketManager = require('../socketManager');
            const statusData = {
              status: user.status,
              customStatus: user.customStatus,
              statusUntil: user.statusUntil,
              statusLocation: user.statusLocation,
              mainStatus: user.mainStatus,
              mainDuration: user.mainDuration,
              mainDurationLabel: user.mainDurationLabel,
              mainStartTime: user.mainStartTime,
              mainEndTime: user.mainEndTime,
              subStatus: user.subStatus,
              subDuration: user.subDuration,
              subDurationLabel: user.subDurationLabel,
              subStartTime: user.subStartTime,
              subEndTime: user.subEndTime,
            };
            socketManager.broadcastStatusUpdate(user, statusData);
          } catch (socketErr) {
            console.error('⚠️ [PRIMARY TIME] Socket broadcast error:', socketErr.message);
          }

          // Signal the owner's device(s) to apply the device ringer mode
          await primaryTimeScheduler.pushDeviceSignal(user, profile, 'apply');
        }
      } catch (statusErr) {
        console.error('⚠️ [PRIMARY TIME] Status update error (profile still enabled):', statusErr.message);
      }
    } else {
      // Enabled for a future window — owner devices should re-arm alarms.
      pushProfileSyncSignal(req.user.userId).catch(() => {});
    }

    res.json({
      success: true,
      message: statusApplied
        ? 'Schedule enabled and status applied (within time window)'
        : 'Schedule enabled — status will apply automatically at the scheduled time',
      profile,
      statusApplied,
    });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Activate profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enable profile',
      error: error.message,
    });
  }
};

// Disable a profile schedule (user taps "deactivate")
// Sets isEnabled=false and isActive=false.
// Only resets user status if the profile was currently active (status was applied).
exports.deactivateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Get the profile first to check if it was actively applied
    const profile = await PrimaryTimeProfile.findOne({ _id: id, userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
      });
    }

    const wasActive = profile.isActive; // Was status currently applied?

    // Disable and deactivate
    profile.isEnabled = false;
    profile.isActive = false;
    await profile.save();

    console.log(`✅ [PRIMARY TIME] Profile disabled: ${profile.name} (was active: ${wasActive})`);

    // Only reset user status if the profile was currently active (status was applied)
    if (wasActive) {
      try {
        const now = new Date();
        const user = await User.findById(userId);
        if (user) {
          user.status = 'Available';
          user.customStatus = '';
          user.statusUpdatedAt = now;
          user.statusUntil = null;
          user.wasAutoApplied = false;
          user.primaryTimeProfileId = null;

          // Clear hierarchical fields
          user.mainStatus = 'Available';
          user.mainDuration = 0;
          user.mainDurationLabel = '';
          user.mainStartTime = null;
          user.mainEndTime = null;
          user.subStatus = null;
          user.subDuration = 0;
          user.subDurationLabel = '';
          user.subStartTime = null;
          user.subEndTime = null;

          await user.save();

          // Broadcast via socketManager (contact-filtered, same as Quick tab)
          try {
            const socketManager = require('../socketManager');
            const statusData = {
              status: 'Available',
              customStatus: '',
              statusUntil: null,
              statusLocation: user.statusLocation,
              mainStatus: 'Available',
              mainDuration: 0,
              mainDurationLabel: '',
              mainStartTime: null,
              mainEndTime: null,
              subStatus: null,
              subDuration: 0,
              subDurationLabel: '',
              subStartTime: null,
              subEndTime: null,
            };
            socketManager.broadcastStatusUpdate(user, statusData);
          } catch (socketErr) {
            console.error('⚠️ [PRIMARY TIME] Socket broadcast error:', socketErr.message);
          }

          // Signal the owner's device(s) to restore the original ringer mode
          await primaryTimeScheduler.pushDeviceSignal(user, profile, 'restore');
        }
      } catch (statusErr) {
        console.error('⚠️ [PRIMARY TIME] Status reset error (profile still disabled):', statusErr.message);
      }
    } else {
      // Disabled a not-currently-active schedule — owner devices re-arm alarms.
      pushProfileSyncSignal(req.user.userId).catch(() => {});
    }

    res.json({
      success: true,
      message: wasActive
        ? 'Schedule disabled and status reset to Available'
        : 'Schedule disabled',
      profile,
    });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Deactivate profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable profile',
      error: error.message,
    });
  }
};

// Get the currently active profile (status is applied right now)
// With multiple profiles enabled, this only returns the one whose status is live.
exports.getActiveProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Return the profile that is currently active (status applied)
    const activeProfile = await PrimaryTimeProfile.findOne({ userId, isActive: true });
    if (activeProfile) {
      return res.json(activeProfile);
    }

    // No profile is currently active — check if any are enabled (scheduled for later)
    // Return the next upcoming enabled profile so the UI can show "SCHEDULED" state
    const enabledProfiles = await PrimaryTimeProfile.find({ userId, isEnabled: true }).sort({ startTime: 1 });
    if (enabledProfiles.length > 0) {
      // Find the next upcoming profile based on user's local time
      const now = new Date();
      // Use the first profile's timezoneOffset as reference (all profiles for same user share timezone)
      const offsetMs = (enabledProfiles[0].timezoneOffset || 0) * 60 * 1000;
      const localNow = new Date(now.getTime() - offsetMs);
      const currentTime = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;
      const nextProfile = enabledProfiles.find(p => p.startTime > currentTime) || enabledProfiles[0];
      return res.json(nextProfile);
    }

    return res.json(null);
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
