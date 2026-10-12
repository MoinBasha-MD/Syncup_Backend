const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const CalendarAccount = require('../models/CalendarAccount');
const ExternalCalendarEvent = require('../models/ExternalCalendarEvent');
const StatusSchedule = require('../models/statusScheduleModel');
const calendarSyncService = require('../services/calendar/calendarSyncService');
const { signOAuthState, verifyOAuthState } = require('../services/calendar/oauthState');
const google = require('../services/calendar/googleProvider');
const microsoft = require('../services/calendar/microsoftProvider');
const imap = require('../services/calendar/imapProvider');
const { mapEventToStatus } = require('../services/calendar/statusMapping');
const { encryptToken } = require('../utils/tokenCrypto');
const { mapEventsToStatusSchedules } = require('../utils/calendarIntegration');

const PROVIDERS = { google, microsoft };
const DEEP_LINK_OK = (provider) => `syncup://calendar-connected?provider=${provider}&ok=1`;
const DEEP_LINK_ERR = (provider, reason) => `syncup://calendar-connected?provider=${provider}&ok=0&reason=${encodeURIComponent(reason)}`;

// @desc    Get stored calendar events for a date range
// @route   GET /api/calendar/events
// @access  Private
router.get('/events', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }
    const docs = await ExternalCalendarEvent.find({
      userId: req.user.userId,
      start: { $lte: new Date(endDate) },
      end: { $gte: new Date(startDate) },
      cancelled: false,
    }).sort({ start: 1 }).lean();

    res.json({
      success: true,
      events: docs.map(doc => ({
        id: String(doc._id),
        title: doc.title,
        start: doc.start,
        end: doc.end,
        recurring: !!doc.recurrenceRule,
        allDay: doc.allDay,
        location: doc.location,
        origin: doc.origin,
        source: doc.source,
        status: doc.mappedStatus && doc.mappedStatus.status,
      })),
      count: docs.length,
      dateRange: { start: startDate, end: endDate },
    });
  } catch (error) {
    console.error('❌ Error fetching calendar events:', error);
    res.status(500).json({ message: 'Server error fetching calendar events', error: error.message });
  }
});

// @desc    List connected calendar accounts
// @route   GET /api/calendar/accounts
// @access  Private
router.get('/accounts', protect, async (req, res) => {
  try {
    const accounts = await CalendarAccount.find({ userId: req.user.userId })
      .select('provider email status lastSyncAt lastError createdAt')
      .lean();
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('❌ Error listing calendar accounts:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @desc    Start OAuth connect flow — returns the provider consent URL
// @route   GET /api/calendar/connect/:provider
// @access  Private
router.get('/connect/:provider', protect, async (req, res) => {
  try {
    const provider = PROVIDERS[req.params.provider];
    if (!provider) {
      return res.status(400).json({ message: 'Unsupported provider' });
    }
    const state = signOAuthState(req.user.userId, req.params.provider);
    res.json({ success: true, authUrl: provider.getAuthUrl(state) });
  } catch (error) {
    console.error('❌ Error building OAuth URL:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @desc    OAuth callback — exchanges code, stores account, redirects to app
// @route   GET /api/calendar/oauth/:provider/callback
// @access  Public (state JWT carries auth)
router.get('/oauth/:provider/callback', async (req, res) => {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) return res.redirect(DEEP_LINK_ERR(req.params.provider || 'unknown', 'bad_provider'));
  try {
    if (req.query.error) {
      return res.redirect(DEEP_LINK_ERR(req.params.provider, req.query.error));
    }
    const { code, state } = req.query;
    if (!code || !state) {
      return res.redirect(DEEP_LINK_ERR(req.params.provider, 'missing_code'));
    }
    const { userId } = verifyOAuthState(state, req.params.provider);
    const tokens = await provider.exchangeCode(code);

    await CalendarAccount.findOneAndUpdate(
      { userId, provider: req.params.provider, email: tokens.email },
      {
        $set: {
          userId,
          provider: req.params.provider,
          email: tokens.email,
          accessTokenEnc: encryptToken(tokens.accessToken),
          refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          status: 'active',
          lastError: null,
          errorCount: 0,
          syncCursor: null,
        },
      },
      { upsert: true, new: true }
    );
    res.redirect(DEEP_LINK_OK(req.params.provider));
  } catch (error) {
    console.error(`❌ OAuth callback failed (${req.params.provider}):`, error.message);
    res.redirect(DEEP_LINK_ERR(req.params.provider, 'exchange_failed'));
  }
});

// @desc    Connect a generic IMAP account
// @route   POST /api/calendar/accounts/imap
// @access  Private
router.post('/accounts/imap', protect, async (req, res) => {
  try {
    const { host, port, email, password, secure } = req.body || {};
    if (!host || !email || !password) {
      return res.status(400).json({ message: 'host, email and password are required' });
    }
    await imap.verifyConnection({ host, port, secure, email, password });
    await CalendarAccount.findOneAndUpdate(
      { userId: req.user.userId, provider: 'imap', email: String(email).toLowerCase() },
      {
        $set: {
          userId: req.user.userId,
          provider: 'imap',
          email: String(email).toLowerCase(),
          imap: { host, port: port || 993, secure: secure !== false },
          refreshTokenEnc: encryptToken(password),
          status: 'active',
          lastError: null,
          errorCount: 0,
        },
      },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ IMAP connect failed:', error.message);
    res.status(error.status || 400).json({ message: error.code === 'IMAP_UNAVAILABLE' ? error.message : 'Could not connect to that mailbox', error: error.message });
  }
});

// @desc    Disconnect an account and delete its imported data
// @route   DELETE /api/calendar/accounts/:id
// @access  Private
router.delete('/accounts/:id', protect, async (req, res) => {
  try {
    const account = await CalendarAccount.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const sources = [account.provider, `${account.provider}-email`];
    const events = await ExternalCalendarEvent.find({ userId: req.user.userId, source: { $in: sources } }).select('_id scheduleId');
    await StatusSchedule.deleteMany({ _id: { $in: events.map(e => e.scheduleId).filter(Boolean) } });
    await ExternalCalendarEvent.deleteMany({ _id: { $in: events.map(e => e._id) } });
    await CalendarAccount.deleteOne({ _id: account._id });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error disconnecting account:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @desc    Trigger a sync (all accounts or ?accountId)
// @route   POST /api/calendar/sync
// @access  Private
router.post('/sync', protect, async (req, res) => {
  try {
    const filter = { userId: req.user.userId, status: { $ne: 'revoked' } };
    if (req.query.accountId) filter._id = req.query.accountId;
    const accounts = await CalendarAccount.find(filter);
    const results = [];
    for (const account of accounts) {
      try {
        results.push({ accountId: account._id, ...(await calendarSyncService.syncAccount(account)) });
      } catch (error) {
        results.push({ accountId: account._id, error: error.message });
      }
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('❌ Manual calendar sync failed:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @desc    Upload device-calendar events for mapping/dedup
// @route   POST /api/calendar/device-events
// @access  Private
router.post('/device-events', protect, async (req, res) => {
  try {
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'events array is required' });
    }
    if (events.length > 500) {
      return res.status(400).json({ message: 'Too many events (max 500)' });
    }
    const normalized = events.map(event => ({
      externalId: String(event.id || event.externalId || ''),
      title: event.title,
      start: event.startDate || event.start,
      end: event.endDate || event.end,
      allDay: !!event.allDay,
      location: event.location || '',
      description: event.description || '',
      recurrenceRule: event.recurrenceRule || null,
      origin: 'device',
    })).filter(event => event.externalId && event.title && event.start);

    const imported = await calendarSyncService.upsertEvents(req.user.userId, null, 'device', normalized);
    await calendarSyncService.bridgeToSchedules(req.user.userId);
    await calendarSyncService.promoteRecurringPatterns(req.user.userId);
    res.json({ success: true, imported });
  } catch (error) {
    console.error('❌ Device events ingest failed:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @desc    Map calendar events to status schedules
// @route   POST /api/calendar/map-to-status
// @access  Private
router.post('/map-to-status', protect, async (req, res) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ message: 'Events array is required' });
    }
    const statusSchedules = mapEventsToStatusSchedules(events);
    res.json({ success: true, statusSchedules, count: statusSchedules.length });
  } catch (error) {
    console.error('❌ Error mapping calendar events to status:', error);
    res.status(500).json({ message: 'Server error mapping calendar events', error: error.message });
  }
});

// @desc    Get calendar analytics
// @route   GET /api/calendar/analytics
// @access  Private
router.get('/analytics', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }
    const allEvents = await ExternalCalendarEvent.find({
      userId: req.user.userId,
      start: { $lte: new Date(endDate) },
      end: { $gte: new Date(startDate) },
      cancelled: false,
    }).lean();

    const analytics = {
      totalEvents: allEvents.length,
      eventsByProvider: {},
      eventsByType: {},
      busyHours: 0,
      freeHours: 0,
      averageEventDuration: 0,
    };

    let totalDuration = 0;
    allEvents.forEach(event => {
      const duration = (new Date(event.end) - new Date(event.start)) / (1000 * 60 * 60);
      totalDuration += duration;
      analytics.eventsByProvider[event.source] = (analytics.eventsByProvider[event.source] || 0) + 1;
      const type = (event.origin === 'email' ? 'ticket' : (mapEventToStatus(event).status || 'other').toLowerCase());
      analytics.eventsByType[type] = (analytics.eventsByType[type] || 0) + 1;
    });

    analytics.averageEventDuration = allEvents.length ? totalDuration / allEvents.length : 0;
    analytics.busyHours = totalDuration;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    analytics.freeHours = Math.max(0, days * 16 - totalDuration);

    res.json({
      success: true,
      analytics,
      dateRange: { start: startDate, end: endDate },
    });
  } catch (error) {
    console.error('❌ Error generating calendar analytics:', error);
    res.status(500).json({ message: 'Server error generating calendar analytics', error: error.message });
  }
});

module.exports = router;
