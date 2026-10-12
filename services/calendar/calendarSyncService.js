const CalendarAccount = require('../../models/CalendarAccount');
const ExternalCalendarEvent = require('../../models/ExternalCalendarEvent');
const StatusSchedule = require('../../models/statusScheduleModel');
const PrimaryTimeProfile = require('../../models/PrimaryTimeProfile');
const User = require('../../models/userModel');
const calendarIntegrationService = require('../calendarIntegrationService');
const google = require('./googleProvider');
const microsoft = require('./microsoftProvider');
const imap = require('./imapProvider');
const { extractBookingEvents } = require('./emailParser');
const { mapEventToStatus } = require('./statusMapping');
const { detectRecurringPatterns } = require('./recurrenceDetection');
const { decryptToken, encryptToken } = require('../../utils/tokenCrypto');

const STATUS_SOURCE = { google: 'google', microsoft: 'microsoft', imap: 'imap', device: 'device' };
const SCHEDULE_WINDOW_DAYS = 14;
const PATTERN_LOOKBACK_DAYS = 90;
const MAX_BACKOFF_MINUTES = 240;

const ensureGoogleToken = async (account) => {
  const accessToken = decryptToken(account.accessTokenEnc);
  const stillValid = accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60 * 1000;
  if (stillValid) return accessToken;
  const refreshToken = decryptToken(account.refreshTokenEnc);
  if (!refreshToken) {
    const error = new Error('No Google refresh token');
    error.code = 'REVOKED';
    throw error;
  }
  try {
    const refreshed = await google.refreshAccessToken(refreshToken);
    account.accessTokenEnc = encryptToken(refreshed.accessToken);
    account.tokenExpiresAt = refreshed.expiresAt;
    await account.save();
    return refreshed.accessToken;
  } catch (error) {
    if (google.isAuthError(error)) {
      const revoked = new Error('Google token revoked');
      revoked.code = 'REVOKED';
      throw revoked;
    }
    throw error;
  }
};

const ensureMicrosoftToken = async (account) => {
  const accessToken = decryptToken(account.accessTokenEnc);
  const stillValid = accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60 * 1000;
  if (stillValid) return accessToken;
  const refreshToken = decryptToken(account.refreshTokenEnc);
  if (!refreshToken) {
    const error = new Error('No Microsoft refresh token');
    error.code = 'REVOKED';
    throw error;
  }
  try {
    const refreshed = await microsoft.refreshAccessToken(refreshToken);
    account.accessTokenEnc = encryptToken(refreshed.accessToken);
    if (refreshed.refreshToken) account.refreshTokenEnc = encryptToken(refreshed.refreshToken);
    account.tokenExpiresAt = refreshed.expiresAt;
    await account.save();
    return refreshed.accessToken;
  } catch (error) {
    if (microsoft.isAuthError(error)) {
      const revoked = new Error('Microsoft token revoked');
      revoked.code = 'REVOKED';
      throw revoked;
    }
    throw error;
  }
};

const upsertEvents = async (userId, accountId, source, events) => {
  let imported = 0;
  for (const event of events) {
    if (!event.title || !event.start || Number.isNaN(new Date(event.start).getTime())) continue;
    const mapped = mapEventToStatus(event);
    const end = event.end && !Number.isNaN(new Date(event.end).getTime())
      ? new Date(event.end)
      : new Date(new Date(event.start).getTime() + 60 * 60 * 1000);
    await ExternalCalendarEvent.findOneAndUpdate(
      { userId, source, externalId: String(event.externalId) },
      {
        $set: {
          userId,
          accountId,
          source,
          externalId: String(event.externalId),
          title: event.title,
          start: new Date(event.start),
          end,
          allDay: !!event.allDay,
          location: event.location || '',
          description: event.description || '',
          recurrenceRule: event.recurrenceRule || null,
          origin: event.origin || 'calendar',
          cancelled: !!event.cancelled,
          mappedStatus: mapped,
        },
      },
      { upsert: true, new: true }
    );
    imported++;
  }
  return imported;
};

/** Sync one account; returns counts. Handles revoked/error states itself. */
const syncAccount = async (account) => {
  try {
    let calendarEvents = [];
    let emailEvents = [];
    let newCursor = account.syncCursor;

    if (account.provider === 'google') {
      const token = await ensureGoogleToken(account);
      let result = await google.listCalendarEvents(token, account.syncCursor);
      if (result.reset) {
        account.syncCursor = null;
        await account.save();
        result = await google.listCalendarEvents(token, null);
      }
      calendarEvents = result.events;
      newCursor = result.syncToken;
      const messages = await google.listGmailBookingMessages(token);
      messages.forEach(msg => emailEvents.push(...extractBookingEvents(msg)));
    } else if (account.provider === 'microsoft') {
      const token = await ensureMicrosoftToken(account);
      const result = await microsoft.listCalendarEvents(token, account.syncCursor);
      calendarEvents = result.events;
      newCursor = result.syncToken;
      const messages = await microsoft.listMailBookingMessages(token);
      messages.forEach(msg => emailEvents.push(...extractBookingEvents(msg)));
    } else if (account.provider === 'imap') {
      const result = await imap.fetchBookingEvents({
        host: account.imap.host,
        port: account.imap.port,
        secure: account.imap.secure,
        email: account.email,
        password: decryptToken(account.refreshTokenEnc),
        lastUid: account.syncCursor,
      });
      emailEvents = result.events;
      newCursor = String(result.lastUid);
    } else {
      throw new Error(`Unknown provider ${account.provider}`);
    }

    // Removed/cancelled deltas have no usable dates — upsert cancellation only.
    const cancelledOnly = calendarEvents.filter(e => e.removed);
    for (const removed of cancelledOnly) {
      await ExternalCalendarEvent.findOneAndUpdate(
        { userId: account.userId, source: account.provider, externalId: String(removed.externalId) },
        { $set: { cancelled: true } }
      );
    }

    const imported = await upsertEvents(account.userId, account._id, account.provider, calendarEvents.filter(e => !e.removed));
    const emailSource = `${account.provider}-email`;
    const importedEmail = await upsertEvents(account.userId, account._id, emailSource, emailEvents);

    account.syncCursor = newCursor;
    account.lastSyncAt = new Date();
    account.status = 'active';
    account.lastError = null;
    account.errorCount = 0;
    await account.save();

    await bridgeToSchedules(account.userId);
    await promoteRecurringPatterns(account.userId);
    return { imported, importedEmail };
  } catch (error) {
    const httpStatus = error.response && error.response.status;
    if (error.code === 'REVOKED' || httpStatus === 401 || httpStatus === 403 || /revoked|invalid_grant/i.test(error.message || '')) {
      account.status = 'revoked';
    } else {
      account.status = 'error';
    }
    account.lastError = String(error.message || error).slice(0, 500);
    account.errorCount = (account.errorCount || 0) + 1;
    account.lastSyncAt = new Date();
    await account.save();
    throw error;
  }
};

/** Create/update StatusSchedules for the next 14 days of imported events. */
const bridgeToSchedules = async (userId) => {
  const now = new Date();
  const horizon = new Date(now.getTime() + SCHEDULE_WINDOW_DAYS * 24 * 3600 * 1000);
  const events = await ExternalCalendarEvent.find({
    userId,
    start: { $lte: horizon },
    end: { $gte: now },
  });
  const mappable = events
    .filter(event => !event.cancelled)
    .map(event => ({
      id: `cal-${event.source}-${event.externalId}`,
      title: event.title,
      start: event.start,
      end: event.end,
      location: event.location,
      description: event.description,
      source: STATUS_SOURCE[event.source.replace(/-email$/, '')] || 'system',
    }));
  // Schedules for cancelled/removed events are deactivated because they are
  // absent from mappable (see syncCalendarWithStatus).
  await calendarIntegrationService.syncCalendarWithStatus(userId, mappable);

  // Backfill scheduleId on the event docs for traceability.
  const schedules = await StatusSchedule.find({ userId, autoCreatedFromCalendar: true }).select('_id calendarEventId');
  const byEventKey = new Map(schedules.map(s => [s.calendarEventId, s._id]));
  const ops = [];
  for (const event of events) {
    const scheduleId = byEventKey.get(`cal-${event.source}-${event.externalId}`) || null;
    if (String(event.scheduleId) !== String(scheduleId)) {
      ops.push({ updateOne: { filter: { _id: event._id }, update: { $set: { scheduleId } } } });
    }
  }
  if (ops.length) await ExternalCalendarEvent.bulkWrite(ops);
};

/** Detect repeated patterns and promote them into Primary Time profiles. */
const promoteRecurringPatterns = async (userId) => {
  const user = await User.findOne({ userId }).select('_id timezoneOffset');
  if (!user) return;
  const since = new Date(Date.now() - PATTERN_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const events = await ExternalCalendarEvent.find({ userId, start: { $gte: since }, cancelled: false });
  const patterns = detectRecurringPatterns(events);
  for (const pattern of patterns) {
    await PrimaryTimeProfile.findOneAndUpdate(
      { userId: user._id, source: 'calendar-sync', patternKey: pattern.patternKey },
      {
        $set: {
          name: pattern.name,
          status: pattern.status,
          days: pattern.days,
          startTime: pattern.startTime,
          endTime: pattern.endTime,
          timezoneOffset: user.timezoneOffset || 0,
          isEnabled: true,
          source: 'calendar-sync',
          patternKey: pattern.patternKey,
        },
      },
      { upsert: true }
    );
  }
};

const backoffRemaining = (account) =>
  account.status === 'error' && account.errorCount > 0 && account.lastSyncAt
    ? account.lastSyncAt.getTime() + Math.min(2 ** Math.min(account.errorCount, 8), MAX_BACKOFF_MINUTES) * 60 * 1000 - Date.now()
    : 0;

/** Cron entry point: sync every active/errored account past its backoff. */
const syncAllAccounts = async () => {
  const accounts = await CalendarAccount.find({ status: { $in: ['active', 'error'] } });
  const results = { synced: 0, skipped: 0, failed: 0 };
  for (const account of accounts) {
    if (backoffRemaining(account) > 0) {
      results.skipped++;
      continue;
    }
    try {
      await syncAccount(account);
      results.synced++;
    } catch (error) {
      results.failed++;
      console.error(`❌ [CAL SYNC] Account ${account._id} (${account.provider}): ${error.message}`);
    }
  }
  return results;
};

module.exports = {
  syncAccount,
  syncAllAccounts,
  upsertEvents,
  bridgeToSchedules,
  promoteRecurringPatterns,
  SCHEDULE_WINDOW_DAYS,
};
