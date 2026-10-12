const axios = require('axios');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
// gmail.readonly only; booking search is query-limited further below.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
];
const BOOKING_QUERY = 'newer_than:30d (subject:(ticket OR tickets OR booking OR reservation OR confirmation OR itinerary) OR from:(bookmyshow OR paytm OR insider OR pvrcinemas OR inoxmovies OR fandango OR atomtickets OR makemytrip OR goibibo OR irctc OR airlines))';

const redirectUri = () => `${process.env.CALENDAR_OAUTH_REDIRECT_BASE}/google/callback`;

const getAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
};

const postForm = async (body) => {
  const response = await axios.post(TOKEN_URL, new URLSearchParams(body).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return response.data;
};

const exchangeCode = async (code) => {
  const data = await postForm({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const profile = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
    timeout: 15000,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
    email: profile.data.email,
    scopes: SCOPES,
  };
};

const refreshAccessToken = async (refreshToken) => {
  const data = await postForm({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
  };
};

const isAuthError = (error) => {
  const status = error.response && error.response.status;
  return status === 400 || status === 401;
};

const googleGet = (accessToken, url, params) =>
  axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, params, timeout: 20000 });

const mapItem = (item) => {
  const start = item.start || {};
  const end = item.end || {};
  const allDay = !!start.date;
  return {
    externalId: item.id,
    title: item.summary || '(no title)',
    start: new Date(start.dateTime || `${start.date}T00:00:00Z`),
    end: new Date(end.dateTime || `${end.date}T00:00:00Z`),
    allDay,
    location: item.location || '',
    description: item.description || '',
    recurrenceRule: (item.recurrence || [])[0] ? (item.recurrence[0].replace(/^RRULE:/i, '')) : null,
    cancelled: item.status === 'cancelled',
    origin: 'calendar',
  };
};

/**
 * Incremental sync; on HTTP 410 (expired syncToken) returns {reset: true} so
 * the caller can retry once with a full sync.
 */
const listCalendarEvents = async (accessToken, syncToken) => {
  const params = syncToken
    ? { syncToken, maxResults: 250, singleEvents: false }
    : {
        timeMin: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
        maxResults: 250,
        singleEvents: false,
      };
  const events = [];
  let nextSyncToken = syncToken;
  try {
    let pageToken;
    do {
      const response = await googleGet(accessToken, `${CAL_API}/calendars/primary/events`, { ...params, pageToken });
      (response.data.items || []).forEach(item => events.push(mapItem(item)));
      pageToken = response.data.nextPageToken;
      if (response.data.nextSyncToken) nextSyncToken = response.data.nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (error.response && error.response.status === 410) {
      return { events: [], syncToken: null, reset: true };
    }
    throw error;
  }
  return { events, syncToken: nextSyncToken };
};

const decodePart = (data) => (data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');

const collectParts = (payload, acc = { html: '', text: '', attachments: [] }) => {
  if (!payload) return acc;
  const mime = payload.mimeType || '';
  if (mime === 'text/html' && payload.body && payload.body.data) acc.html += decodePart(payload.body.data);
  if (mime === 'text/plain' && payload.body && payload.body.data) acc.text += decodePart(payload.body.data);
  if ((mime === 'text/calendar' || /attachment/i.test(payload.filename || '') || /\.ics$/i.test(payload.filename || '')) && payload.body && payload.body.data) {
    acc.attachments.push({ contentType: mime, filename: payload.filename, content: decodePart(payload.body.data) });
  }
  (payload.parts || []).forEach(part => collectParts(part, acc));
  return acc;
};

const listGmailBookingMessages = async (accessToken, maxMessages = 20) => {
  const list = await googleGet(accessToken, `${GMAIL_API}/users/me/messages`, { q: BOOKING_QUERY, maxResults: maxMessages });
  const messages = [];
  for (const ref of list.data.messages || []) {
    try {
      const full = await googleGet(accessToken, `${GMAIL_API}/users/me/messages/${ref.id}`, { format: 'full' });
      const headers = {};
      (full.data.payload.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
      const parts = collectParts(full.data.payload);
      messages.push({
        subject: headers.subject || '',
        from: headers.from || '',
        date: full.data.internalDate ? new Date(Number(full.data.internalDate)) : new Date(),
        html: parts.html,
        text: parts.text || full.data.snippet || '',
        attachments: parts.attachments,
      });
    } catch (error) {
      console.warn(`📧 [GMAIL] Skipping message ${ref.id}: ${error.message}`);
    }
  }
  return messages;
};

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  isAuthError,
  listCalendarEvents,
  listGmailBookingMessages,
  SCOPES,
};
