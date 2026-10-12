const axios = require('axios');

const tenant = () => process.env.MS_TENANT || 'common';
const AUTH_URL = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
const TOKEN_URL = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['offline_access', 'Calendars.Read', 'Mail.Read', 'User.Read'];
const BOOKING_FILTER = "contains(subject,'ticket') or contains(subject,'booking') or contains(subject,'reservation') or contains(subject,'confirmation') or contains(subject,'itinerary')";

const redirectUri = () => `${process.env.CALENDAR_OAUTH_REDIRECT_BASE}/microsoft/callback`;

const getAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    response_mode: 'query',
    state,
  });
  return `${AUTH_URL()}?${params.toString()}`;
};

const postForm = async (body) => {
  const response = await axios.post(TOKEN_URL(), new URLSearchParams(body).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return response.data;
};

const exchangeCode = async (code) => {
  const data = await postForm({
    code,
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  });
  const me = await axios.get(`${GRAPH}/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
    timeout: 15000,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
    email: me.data.mail || me.data.userPrincipalName,
    scopes: SCOPES,
  };
};

const refreshAccessToken = async (refreshToken) => {
  const data = await postForm({
    refresh_token: refreshToken,
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' '),
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
  };
};

const isAuthError = (error) => {
  const status = error.response && error.response.status;
  return status === 400 || status === 401;
};

const graphGet = (accessToken, url, params) =>
  axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, params, timeout: 20000 });

const mapItem = (item) => {
  const start = item.start || {};
  const end = item.end || {};
  const allDay = !!item.isAllDay;
  return {
    externalId: item.id,
    title: item.subject || '(no title)',
    start: new Date(`${start.dateTime}${start.timeZone === 'UTC' || allDay ? 'Z' : 'Z'}`),
    end: new Date(`${end.dateTime}${end.timeZone === 'UTC' || allDay ? 'Z' : 'Z'}`),
    allDay,
    location: (item.location && item.location.displayName) || '',
    description: (item.bodyPreview || ''),
    recurrenceRule: item.recurrence ? JSON.stringify(item.recurrence) : null,
    cancelled: item.isCancelled === true,
    origin: 'calendar',
  };
};

/**
 * Delta sync via /calendarView/delta over a rolling window; the returned
 * deltaLink is stored as syncCursor. Graph has no 410 reset — a failed delta
 * simply retries with the same link next run.
 */
const listCalendarEvents = async (accessToken, deltaLink) => {
  const events = [];
  let nextDeltaLink = deltaLink;
  let url = deltaLink || `${GRAPH}/me/calendarView/delta`;
  // start/end params apply to the first request only — nextLink/deltaLink
  // already embed them.
  let params = deltaLink ? undefined : {
    startDateTime: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    endDateTime: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
    $top: 50,
  };
  while (url) {
    const response = await graphGet(accessToken, url, params);
    params = undefined;
    (response.data.value || []).forEach(item => {
      if (item['@removed']) {
        events.push({ externalId: item.id, cancelled: true, removed: true, title: '(removed)', start: new Date(), end: new Date(), origin: 'calendar' });
      } else {
        events.push(mapItem(item));
      }
    });
    url = response.data['@odata.nextLink'];
    if (!url && response.data['@odata.deltaLink']) nextDeltaLink = response.data['@odata.deltaLink'];
  }
  return { events, syncToken: nextDeltaLink };
};

const listMailBookingMessages = async (accessToken, maxMessages = 20) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const response = await graphGet(accessToken, `${GRAPH}/me/messages`, {
    $filter: `receivedDateTime ge ${since} and (${BOOKING_FILTER})`,
    $top: maxMessages,
    $select: 'subject,from,receivedDateTime,body,bodyPreview,hasAttachments',
  });
  const messages = [];
  for (const item of response.data.value || []) {
    let attachments = [];
    if (item.hasAttachments) {
      try {
        const atts = await graphGet(accessToken, `${GRAPH}/me/messages/${item.id}/attachments`, { $top: 10 });
        attachments = (atts.data.value || [])
          .filter(a => (a.contentType || '').includes('calendar') || /\.ics$/i.test(a.name || ''))
          .map(a => ({ contentType: a.contentType, filename: a.name, content: a.contentBytes ? Buffer.from(a.contentBytes, 'base64').toString('utf8') : '' }));
      } catch (error) {
        console.warn(`📧 [GRAPH] Skipping attachments for ${item.id}: ${error.message}`);
      }
    }
    const html = item.body && item.body.contentType === 'html' ? item.body.content : '';
    messages.push({
      subject: item.subject || '',
      from: item.from && item.from.emailAddress ? item.from.emailAddress.address : '',
      date: item.receivedDateTime ? new Date(item.receivedDateTime) : new Date(),
      html,
      text: html ? '' : (item.body && item.body.content) || item.bodyPreview || '',
      attachments,
    });
  }
  return messages;
};

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  isAuthError,
  listCalendarEvents,
  listMailBookingMessages,
  SCOPES,
};
