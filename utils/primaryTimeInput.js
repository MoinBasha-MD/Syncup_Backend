/**
 * Validates Primary Time profile input from clients. Returns { value } holding
 * only the allowed, normalized fields, or { error } with a message for a 400.
 * On update, `current` is the stored profile, so rules that span fields
 * (start vs end) are checked against the merged result.
 */
const { isValidTimezone } = require('./primaryTimeClock');

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_TEXT = 100;

const cleanText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) return { error: `${field} is required` };
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > MAX_TEXT) return { error: `${field} must be ${MAX_TEXT} characters or fewer` };
  return { value: text };
};

const isDate = (value) => !Number.isNaN(new Date(value).getTime());

function validateProfileInput(body, { current = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request body' };
  const creating = !current;
  const has = (key) => body[key] !== undefined;
  const value = {};

  for (const field of ['name', 'status']) {
    if (!creating && !has(field)) continue;
    const text = cleanText(body[field], field);
    if (text.error) return text;
    value[field] = text.value;
  }

  if (creating || has('days')) {
    const { days } = body;
    if (!Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { error: 'days must list weekdays from 0 (Sunday) to 6 (Saturday)' };
    }
    value.days = [...new Set(days)].sort((a, b) => a - b);
  }

  for (const field of ['startTime', 'endTime']) {
    if (!creating && !has(field)) continue;
    if (typeof body[field] !== 'string' || !HHMM.test(body[field])) return { error: `${field} must be HH:MM (24-hour)` };
    value[field] = body[field];
  }
  if ((value.startTime ?? current?.startTime) === (value.endTime ?? current?.endTime)) {
    return { error: 'startTime and endTime must be different' };
  }

  if (has('timezone') && body.timezone !== null) {
    if (!isValidTimezone(body.timezone)) return { error: 'Invalid timezone' };
    value.timezone = body.timezone;
  }
  if (has('timezoneOffset')) {
    const offset = body.timezoneOffset;
    if (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset) > 840) return { error: 'Invalid timezoneOffset' };
    value.timezoneOffset = offset;
  }
  if (has('priority')) {
    if (!Number.isInteger(body.priority) || body.priority < 1 || body.priority > 10) {
      return { error: 'priority must be a whole number from 1 to 10' };
    }
    value.priority = body.priority;
  }
  if (!creating && has('isEnabled')) {
    if (typeof body.isEnabled !== 'boolean') return { error: 'isEnabled must be true or false' };
    value.isEnabled = body.isEnabled;
  }

  if (has('notifications')) {
    const n = body.notifications;
    const keys = ['beforeStart', 'onStart', 'onEnd'];
    if (!n || typeof n !== 'object' || keys.some(k => n[k] !== undefined && typeof n[k] !== 'boolean')) {
      return { error: 'notifications must hold true/false values' };
    }
    const base = current?.notifications || { beforeStart: true, onStart: true, onEnd: true };
    value.notifications = Object.fromEntries(keys.map(k => [k, n[k] ?? base[k]]));
  }

  if (has('recurrence')) {
    const r = body.recurrence;
    if (!r || typeof r !== 'object' || !['weekly', 'date_range'].includes(r.type)) {
      return { error: 'recurrence.type must be weekly or date_range' };
    }
    if ([r.startDate, r.endDate].some(d => d != null && !isDate(d))) return { error: 'Invalid recurrence date' };
    if (r.startDate && r.endDate && new Date(r.startDate) > new Date(r.endDate)) {
      return { error: 'recurrence startDate must not be after endDate' };
    }
    value.recurrence = {
      type: r.type,
      ...(r.startDate ? { startDate: new Date(r.startDate) } : {}),
      ...(r.endDate ? { endDate: new Date(r.endDate) } : {}),
    };
  }

  // null means "no change" on update; clearing a place is done with an empty placeName.
  if (has('location') && body.location !== null) {
    const loc = body.location;
    if (typeof loc !== 'object' || Array.isArray(loc)) return { error: 'Invalid location' };
    if (loc.placeName != null && (typeof loc.placeName !== 'string' || loc.placeName.length > 120)) return { error: 'Invalid location name' };
    if (loc.address != null && (typeof loc.address !== 'string' || loc.address.length > 200)) return { error: 'Invalid location address' };
    const location = { placeName: (loc.placeName || '').trim(), address: (loc.address || '').trim() };
    if (loc.coordinates != null) {
      const { latitude, longitude } = loc.coordinates;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return { error: 'Invalid location coordinates' };
      }
      location.coordinates = { latitude, longitude };
    }
    value.location = location;
  }

  // Only Autobot may label its own routines; 'calendar-sync' stays server-only.
  if (creating) {
    value.source = body.source === 'autobot' ? 'autobot' : 'manual';
    if (value.source === 'autobot') {
      if (typeof body.patternKey !== 'string' || !body.patternKey.trim() || body.patternKey.length > 200) {
        return { error: 'Autobot routines need a patternKey' };
      }
      value.patternKey = body.patternKey.trim();
    }
  }

  return { value };
}

module.exports = { validateProfileInput, MAX_TEXT };
