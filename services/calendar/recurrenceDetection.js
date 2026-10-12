const { mapEventToStatus } = require('./statusMapping');

/**
 * Pure recurrence detection: promotes repeated real-world events into a
 * recurring "Primary Time" routine. Pure + DB-free for unit tests.
 */

const RRULE_WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MIN_OCCURRENCES = 3;
// Round start/end minutes to the nearest bucket so 19:03 and 18:57 cluster.
const BUCKET_MINUTES = 15;

const pad = (n) => String(n).padStart(2, '0');

const normalizeTitle = (title) =>
  String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|at|in|on|my|your|ticket|tickets|booking|show|showtime)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const bucketTime = (date) => {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const bucket = Math.round(minutes / BUCKET_MINUTES) * BUCKET_MINUTES;
  return { h: Math.floor(bucket / 60) % 24, m: bucket % 60 };
};

const parseRrule = (rule) => {
  if (!rule) return null;
  const parts = {};
  for (const segment of String(rule).split(';')) {
    const [k, v] = segment.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ;
  if (!freq) return null;
  let days = [];
  if (parts.BYDAY) {
    days = parts.BYDAY.split(',')
      .map(d => RRULE_WEEKDAYS[d.trim().slice(-2).toUpperCase()])
      .filter(d => d !== undefined);
  }
  return { freq: freq.toUpperCase(), days };
};

/**
 * @param {Array<{title, start: Date|string, end: Date|string,
 *   recurrenceRule?: string, mappedStatus?: {status, customStatus}}>} events
 * @returns {Array<{patternKey, name, status, customStatus, days: number[],
 *   startTime: 'HH:MM', endTime: 'HH:MM', occurrences: number, fromRule: boolean}>}
 */
const detectRecurringPatterns = (events = []) => {
  const groups = new Map();
  const patterns = [];

  for (const raw of events) {
    const start = raw.start instanceof Date ? raw.start : new Date(raw.start);
    const end = raw.end instanceof Date ? raw.end : new Date(raw.end);
    if (!raw.title || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    const status = raw.mappedStatus && raw.mappedStatus.status
      ? raw.mappedStatus
      : mapEventToStatus(raw);
    const normalized = normalizeTitle(raw.title) || status.status.toLowerCase();

    const rrule = parseRrule(raw.recurrenceRule);
    if (rrule && (rrule.freq === 'WEEKLY' || rrule.freq === 'DAILY')) {
      const days = rrule.days.length ? rrule.days : (rrule.freq === 'DAILY' ? [0, 1, 2, 3, 4, 5, 6] : [start.getDay()]);
      const sb = bucketTime(start);
      const eb = bucketTime(end);
      const patternKey = `rule|${normalized}|${days.slice().sort().join(',')}|${pad(sb.h)}:${pad(sb.m)}`;
      if (!groups.has(`r|${patternKey}`)) {
        groups.set(`r|${patternKey}`, true);
        patterns.push({
          patternKey,
          name: raw.title,
          status: status.status,
          customStatus: status.customStatus,
          days: days.slice().sort(),
          startTime: `${pad(sb.h)}:${pad(sb.m)}`,
          endTime: `${pad(eb.h)}:${pad(eb.m)}`,
          occurrences: MIN_OCCURRENCES,
          fromRule: true,
        });
      }
      continue;
    }

    const sb = bucketTime(start);
    const key = `${normalized}|${status.status}|${start.getDay()}|${pad(sb.h)}:${pad(sb.m)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name: raw.title,
        status: status.status,
        customStatus: status.customStatus,
        day: start.getDay(),
        start: sb,
        end: bucketTime(end),
        dates: new Set(),
      });
    }
    groups.get(key).dates.add(start.toDateString());
  }

  for (const [key, group] of groups) {
    if (key.startsWith('r|')) continue;
    if (group.dates.size < MIN_OCCURRENCES) continue;
    patterns.push({
      patternKey: `auto|${key}`,
      name: group.name,
      status: group.status,
      customStatus: group.customStatus,
      days: [group.day],
      startTime: `${pad(group.start.h)}:${pad(group.start.m)}`,
      endTime: `${pad(group.end.h)}:${pad(group.end.m)}`,
      occurrences: group.dates.size,
      fromRule: false,
    });
  }

  return patterns;
};

module.exports = { detectRecurringPatterns, normalizeTitle, parseRrule };
