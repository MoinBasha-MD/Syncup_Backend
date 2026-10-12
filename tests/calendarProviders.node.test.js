const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Provider sync tests mock axios at the module object — providers call
// axios.get/post directly, so swapping the methods covers both code paths.

test('google listCalendarEvents pages and returns syncToken', async (t) => {
  const google = require('../services/calendar/googleProvider');
  const original = axios.get;
  const calls = [];
  axios.get = async (url, opts) => {
    calls.push(opts.params);
    if (!opts.params.pageToken) {
      return { data: { items: [
        { id: 'ev1', summary: 'Gym', start: { dateTime: '2026-10-20T13:00:00Z' }, end: { dateTime: '2026-10-20T14:00:00Z' }, status: 'confirmed' },
      ], nextPageToken: 'p2' } };
    }
    return { data: { items: [
      { id: 'ev2', summary: 'Movie', start: { dateTime: '2026-10-21T13:00:00Z' }, end: { dateTime: '2026-10-21T15:00:00Z' }, status: 'confirmed', recurrence: ['RRULE:FREQ=WEEKLY'] },
    ], nextSyncToken: 'tok-2' } };
  };
  try {
    const result = await google.listCalendarEvents('token', 'tok-1');
    assert.equal(result.events.length, 2);
    assert.equal(result.syncToken, 'tok-2');
    assert.equal(result.events[1].recurrenceRule, 'FREQ=WEEKLY');
    assert.equal(calls[0].syncToken, 'tok-1');
  } finally {
    axios.get = original;
  }
});

test('google listCalendarEvents reports reset on 410', async (t) => {
  const google = require('../services/calendar/googleProvider');
  const original = axios.get;
  axios.get = async () => { const e = new Error('Gone'); e.response = { status: 410 }; throw e; };
  try {
    const result = await google.listCalendarEvents('token', 'stale-token');
    assert.equal(result.reset, true);
    assert.equal(result.syncToken, null);
    assert.equal(result.events.length, 0);
  } finally {
    axios.get = original;
  }
});

test('microsoft listCalendarEvents follows nextLink to deltaLink', async (t) => {
  const microsoft = require('../services/calendar/microsoftProvider');
  const original = axios.get;
  const urls = [];
  axios.get = async (url, opts) => {
    urls.push(url);
    if (urls.length === 1) {
      return { data: { value: [
        { id: 'm1', subject: 'Dentist', isAllDay: false, start: { dateTime: '2026-10-20T09:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-20T09:30:00', timeZone: 'UTC' } },
      ], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=abc' } };
    }
    return { data: { value: [
      { id: 'm2', subject: 'Lunch', isAllDay: false, start: { dateTime: '2026-10-21T07:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T08:00:00', timeZone: 'UTC' } },
      { id: 'm3', '@removed': { reason: 'deleted' } },
    ], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=zzz' } };
  };
  try {
    const result = await microsoft.listCalendarEvents('token', null);
    assert.equal(result.events.length, 3);
    assert.equal(result.events[2].cancelled, true);
    assert.match(result.syncToken, /deltatoken=zzz/);
    assert.match(urls[1], /skiptoken=abc/);
  } finally {
    axios.get = original;
  }
});
