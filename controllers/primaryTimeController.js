const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');
const primaryTimeScheduler = require('../services/primaryTimeScheduler');
const fcmService = require('../services/fcmNotificationService');
const socketManager = require('../socketManager');
const { isValidObjectId } = require('mongoose');
const { isValidTimezone, localDate, nextWindow } = require('../utils/primaryTimeClock');
const { validateProfileInput } = require('../utils/primaryTimeInput');
const saveStatusIfUnchanged = require('../services/statusCompareAndSet');

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

const MAX_PROFILES_PER_USER = 50;

const notFound = (res) => res.status(404).json({ success: false, message: 'Profile not found' });

// Create a new Primary Time profile
exports.createProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { value, error } = validateProfileInput(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    // Autobot retries after a lost response must not create a second copy.
    if (value.source === 'autobot') {
      const existing = await PrimaryTimeProfile.findOne({ userId, source: 'autobot', patternKey: value.patternKey });
      if (existing) return res.status(200).json(existing);
    }
    if (await PrimaryTimeProfile.countDocuments({ userId }) >= MAX_PROFILES_PER_USER) {
      return res.status(400).json({ success: false, message: `You can have up to ${MAX_PROFILES_PER_USER} Primary Time routines` });
    }

    const profile = new PrimaryTimeProfile({
      userId,
      ...value,
      timezoneOffset: value.timezoneOffset ?? new Date().getTimezoneOffset(),
      timezone: value.timezone || null,
      notifications: value.notifications || { beforeStart: true, onStart: true, onEnd: true },
      recurrence: value.recurrence || { type: 'weekly' },
      priority: value.priority || 1,
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
    const clientTimezone = isValidTimezone(req.query.timezone) ? req.query.timezone : null;
    const validOffset = Number.isFinite(clientOffset) && Math.abs(clientOffset) <= 840 ? clientOffset : null;
    if (validOffset != null || clientTimezone) {
      const changes = {
        ...(validOffset != null ? { timezoneOffset: validOffset } : {}),
        ...(clientTimezone ? { timezone: clientTimezone } : {}),
      };
      const needsPatch = profiles.filter(p =>
        (validOffset != null && p.timezoneOffset !== validOffset) ||
        (clientTimezone && p.timezone !== clientTimezone)
      );
      if (needsPatch.length > 0) {
        await PrimaryTimeProfile.updateMany(
          { _id: { $in: needsPatch.map(p => p._id) } },
          { $set: changes }
        );
        needsPatch.forEach(p => Object.assign(p, changes));
        console.log(`🔧 [PRIMARY TIME] Updated timezone on ${needsPatch.length} profile(s)`);
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
    if (!isValidObjectId(id)) return notFound(res);

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
    if (!isValidObjectId(id)) return notFound(res);

    const profile = await PrimaryTimeProfile.findOne({ _id: id, userId });
    if (!profile) return notFound(res);

    // Only user-editable fields, checked against the stored profile (no isActive/source/userId writes).
    const { value, error } = validateProfileInput(req.body, { current: profile });
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }
    Object.assign(profile, value);
    await profile.save();

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
    if (!isValidObjectId(id)) return notFound(res);

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

// Skip the running or next window once (from the 15-minute warning).
exports.skipProfile = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return notFound(res);
    const profile = await PrimaryTimeProfile.findOne({ _id: req.params.id, userId: req.user._id });
    if (!profile) return notFound(res);
    const window = nextWindow(profile);
    if (!window) {
      return res.status(400).json({ success: false, message: 'No upcoming time to skip' });
    }
    profile.skipUntil = window.endAt;
    await profile.save();
    // Ends the window now if it is running; otherwise it simply won't start.
    await primaryTimeScheduler.checkAndUpdateUserPrimaryTime(req.user._id);
    pushProfileSyncSignal(req.user.userId).catch(() => {});
    res.json({ success: true, skipUntil: profile.skipUntil });
  } catch (error) {
    console.error('❌ [PRIMARY TIME] Skip profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to skip profile' });
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
    if (!isValidObjectId(id)) return notFound(res);

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

    if (profile.source === 'autobot') {
      // Autobot routines go through the scheduler, which waits for a running status to end.
      await primaryTimeScheduler.checkAndUpdateUserPrimaryTime(userId);
      pushProfileSyncSignal(req.user.userId).catch(() => {});
    } else if (isWithinWindow) {
      // Only apply status immediately if the current time is within the schedule window
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
        const endTime = primaryTimeScheduler.getProfileEndTime(profile, now);
        // Convert local end back to UTC for storage
        if (!endTime) throw new Error('Primary Time window is no longer active');
        const durationMinutes = Math.round((endTime.getTime() - now.getTime()) / (1000 * 60));

        let user = await User.findById(userId);
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
          user.subStatus = null;
          user.subDuration = 0;
          user.subDurationLabel = '';
          user.subStartTime = null;
          user.subEndTime = null;

          if (profile.location && profile.location.placeName) {
            user.statusLocation = {
              placeName: profile.location.placeName,
              coordinates: profile.location.coordinates || {},
              address: profile.location.address || '',
              shareWithContacts: true,
              timestamp: now,
            };
          } else {
            user.statusLocation = { placeName: '', coordinates: {}, address: '', shareWithContacts: false, timestamp: now };
          }
          user = await saveStatusIfUnchanged(user, {}, now);
          if (!user) {
            pushProfileSyncSignal(req.user.userId).catch(() => {});
            return res.json({ success: true, profile, statusApplied: false });
          }
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
    if (!isValidObjectId(id)) return notFound(res);

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
        let user = await User.findById(userId);
        if (user && user.primaryTimeProfileId &&
            user.primaryTimeProfileId.toString() === profile._id.toString()) {
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

          user = await saveStatusIfUnchanged(user, { primaryTimeProfileId: profile._id }, now);
          if (!user) {
            pushProfileSyncSignal(req.user.userId).catch(() => {});
            return res.json({ success: true, message: 'Schedule disabled', profile });
          }

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
      const localNow = localDate(enabledProfiles[0], now);
      const currentTime = `${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}`;
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
