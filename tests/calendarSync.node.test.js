const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.CALENDAR_TOKEN_KEY = process.env.CALENDAR_TOKEN_KEY || 'test-token-key-0123456789';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const { extractBookingEvents } = require('../services/calendar/emailParser');
const { detectRecurringPatterns } = require('../services/calendar/recurrenceDetection');
const { mapEventToStatus } = require('../services/calendar/statusMapping');
const { signOAuthState, verifyOAuthState } = require('../services/calendar/oauthState');
const { encryptToken, decryptToken } = require('../utils/tokenCrypto');

// ---------- emailParser ----------

const JSONLD_HTML = `
<html><body>
<script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "EventReservation",
  "reservationId": "BMS123",
  "reservationFor": {
    "@type": "ScreeningEvent",
    "name": "Dune: Part Two",
    "startDate": "2026-11-15T19:00:00+05:30",
    "endDate": "2026-11-15T22:00:00+05:30",
    "location": { "@type": "Place", "name": "PVR Phoenix Mall", "address": { "addressLocality": "Mumbai" } }
  }
}
</script>
</body></html>`;

const ICS_BODY = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:flight-123@airline.com
SUMMARY:Flight AI-101 Mumbai to Delhi
DTSTART:20261201T143000Z
DTEND:20261201T163000Z
LOCATION:Chhatrapati Shivaji Airport
END:VEVENT
END:VCALENDAR`;

const BMS_TEXT = `
Booking Confirmation - Dune: Part Two | BookMyShow
Movie: Dune: Part Two (U/A)
Cinema: PVR Icon, Phoenix Mall, Mumbai
Date: 15 Nov 2026
Show Time: 7:30 PM
Seats: K12, K13
`;

test('emailParser extracts EventReservation JSON-LD', () => {
  const events = extractBookingEvents({ html: JSONLD_HTML, from: 'tickets@bookmyshow.com', date: new Date('2026-11-01') });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Dune: Part Two');
  assert.equal(events[0].origin, 'email');
  assert.ok(events[0].location.includes('PVR'));
  assert.equal(events[0].start.toISOString(), '2026-11-15T13:30:00.000Z');
});

test('emailParser parses ICS calendar parts', () => {
  const events = extractBookingEvents({
    text: 'See attached invite',
    from: 'noreply@airline.com',
    attachments: [{ contentType: 'text/calendar', filename: 'invite.ics', content: ICS_BODY }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Flight AI-101 Mumbai to Delhi');
  assert.equal(events[0].location, 'Chhatrapati Shivaji Airport');
});

test('emailParser extracts bookmyshow-style regex booking', () => {
  const events = extractBookingEvents({
    text: BMS_TEXT,
    subject: 'Booking Confirmation - Dune: Part Two | BookMyShow',
    from: 'noreply@in.bookmyshow.com',
    date: new Date('2026-11-10T00:00:00Z'),
  });
  assert.equal(events.length, 1);
  assert.match(events[0].title, /Dune/i);
  assert.match(events[0].location, /PVR/i);
});

test('emailParser returns [] for unrelated mail', () => {
  const events = extractBookingEvents({
    text: 'Hey, lunch tomorrow? Bring the reports.',
    subject: 'Lunch?',
    from: 'friend@example.com',
    date: new Date(),
  });
  assert.deepEqual(events, []);
});

// ---------- status mapping ----------

test('statusMapping maps movie/meeting/flight/unknown', () => {
  assert.equal(mapEventToStatus({ title: 'Dune: Part Two at PVR Cinemas' }).status, 'Watching a movie');
  assert.equal(mapEventToStatus({ title: 'Weekly sync with team' }).status, 'In a meeting');
  assert.equal(mapEventToStatus({ title: 'Flight AI-101 to Delhi' }).status, 'On a flight');
  const other = mapEventToStatus({ title: 'Grandma visit' });
  assert.equal(other.status, 'Busy');
  assert.equal(other.customStatus, 'Grandma visit');
});

// ---------- recurrence detection ----------

test('detectRecurringPatterns promotes >=3 same-weekday occurrences', () => {
  const events = [1, 8, 15].map(day => ({
    title: 'Gym session',
    start: new Date(2026, 9, day, 13, 0), // Thursdays Oct 2026
    end: new Date(2026, 9, day, 14, 0),
  }));
  const patterns = detectRecurringPatterns(events);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0].days, [4]);
  assert.equal(patterns[0].status, 'At gym');
  assert.equal(patterns[0].startTime, '13:00');
  assert.equal(patterns[0].endTime, '14:00');
});

test('detectRecurringPatterns ignores under 3 occurrences', () => {
  const events = [1, 8].map(day => ({
    title: 'Gym session',
    start: new Date(Date.UTC(2026, 9, day, 13, 0)),
    end: new Date(Date.UTC(2026, 9, day, 14, 0)),
  }));
  assert.equal(detectRecurringPatterns(events).length, 0);
});

test('detectRecurringPatterns honors provider RRULE', () => {
  const patterns = detectRecurringPatterns([{
    title: 'Team standup',
    start: new Date(Date.UTC(2026, 9, 5, 4, 0)),
    end: new Date(Date.UTC(2026, 9, 5, 4, 30)),
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  }]);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0].days, [1, 3]);
  assert.equal(patterns[0].fromRule, true);
});

// ---------- oauth state ----------

test('oauth state round-trips and rejects tampering', () => {
  const state = signOAuthState('user-42', 'google');
  const verified = verifyOAuthState(state, 'google');
  assert.equal(verified.userId, 'user-42');
  assert.throws(() => verifyOAuthState(state, 'microsoft'));
  assert.throws(() => verifyOAuthState(state.slice(0, -3) + 'abc', 'google'));
  const expired = jwt.sign({ sub: 'user-42', provider: 'google', scope: 'calendar-oauth' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.throws(() => verifyOAuthState(expired, 'google'));
  const foreign = jwt.sign({ sub: 'user-42', provider: 'google', scope: 'other' }, process.env.JWT_SECRET, { expiresIn: 60 });
  assert.throws(() => verifyOAuthState(foreign, 'google'));
});

// ---------- token crypto ----------

test('token crypto encrypt/decrypt round-trip', () => {
  const blob = encryptToken('ya29.secret-token');
  assert.notEqual(blob, 'ya29.secret-token');
  assert.equal(decryptToken(blob), 'ya29.secret-token');
  assert.equal(decryptToken(null), null);
  assert.throws(() => decryptToken('bad.blob.format'));
});
