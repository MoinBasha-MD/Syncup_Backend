const crypto = require('crypto');

/**
 * Rule-based booking/ticket extraction from email messages. No AI.
 * Strategies, in order:
 *  1. schema.org Reservation/Event JSON-LD (+ @graph) and microdata in HTML
 *  2. iCalendar (text/calendar) VEVENTs in attachments or body parts
 *  3. Sender-domain regex templates for common ticketing providers
 */

const RESERVATION_TYPES = new Set([
  'EventReservation',
  'FoodEstablishmentReservation',
  'FlightReservation',
  'LodgingReservation',
  'TrainReservation',
  'BusReservation',
  'Reservation',
]);
const EVENT_TYPES = new Set(['Event', 'ScreeningEvent', 'SportsEvent', 'MusicEvent', 'TheaterEvent', 'ExhibitionEvent', 'Festival']);

const stableId = (...parts) =>
  crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const decodeEntities = (text) => String(text || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

const normalizeSchemaType = (node) => {
  const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type'];
  return typeof type === 'string' ? type.replace(/^https?:\/\/schema\.org\//, '') : '';
};

const flattenJsonLd = (node, out = []) => {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach(item => flattenJsonLd(item, out));
    return out;
  }
  if (typeof node === 'object') {
    if (node['@graph']) flattenJsonLd(node['@graph'], out);
    if (node['@type']) out.push(node);
  }
  return out;
};

const schemaEventFromReservation = (node, msg) => {
  const type = normalizeSchemaType(node);
  const isReservation = RESERVATION_TYPES.has(type);
  const isEvent = EVENT_TYPES.has(type);
  if (!isReservation && !isEvent) return null;

  const subject = isReservation ? (node.reservationFor || node.reservedTicket || {}) : node;
  const title = subject.name || node.reservationId || node.name;
  const start = toDate(subject.startDate || subject.departureTime || subject.checkinTime || node.startDate);
  const end = toDate(subject.endDate || subject.arrivalTime || subject.checkoutTime || node.endDate)
    || (start ? new Date(start.getTime() + 2 * 60 * 60 * 1000) : null);
  if (!title || !start) return null;

  const location = subject.location || subject.address || node.location;
  const locationText = typeof location === 'string'
    ? location
    : location
      ? [location.name, location.address && (location.address.name || [location.address.streetAddress, location.address.addressLocality].filter(Boolean).join(', '))].filter(Boolean).join(', ')
      : '';
  const venue = subject.name && locationText ? locationText : (locationText || (subject.address ? String(subject.address) : ''));

  return {
    externalId: `ldjson-${stableId(msg.from || '', title, start.toISOString())}`,
    title: String(title).trim(),
    start,
    end,
    allDay: false,
    location: String(venue || '').trim(),
    origin: 'email',
  };
};

const extractJsonLd = (html, msg) => {
  const events = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(decodeEntities(match[1]).trim());
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(parsed)) {
      const event = schemaEventFromReservation(node, msg);
      if (event) events.push(event);
    }
  }
  return events;
};

const extractMicrodata = (html, msg) => {
  const events = [];
  const re = /itemscope[^>]*itemtype=["'][^"']*schema\.org\/([A-Za-z]+)["'][^>]*>([\s\S]*?)(?=itemscope|<\/body|$)/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const type = match[1];
    if (!RESERVATION_TYPES.has(type) && !EVENT_TYPES.has(type)) continue;
    const body = match[2];
    const prop = (name) => {
      const r = new RegExp(`itemprop=["']${name}["'][^>]*(?:content=["']([^"']*)["']|>([^<]{1,200})<)`, 'i');
      const m = r.exec(body);
      return m ? decodeEntities((m[1] || m[2] || '').trim()) : '';
    };
    const title = prop('name');
    const start = toDate(prop('startDate') || prop('departureTime') || prop('checkinTime'));
    const end = toDate(prop('endDate') || prop('arrivalTime') || prop('checkoutTime'))
      || (start ? new Date(start.getTime() + 2 * 60 * 60 * 1000) : null);
    if (!title || !start) continue;
    const location = prop('location') || prop('address');
    events.push({
      externalId: `micro-${stableId(msg.from || '', title, start.toISOString())}`,
      title,
      start,
      end,
      allDay: false,
      location,
      origin: 'email',
    });
  }
  return events;
};

const unfoldIcs = (ics) => String(ics).replace(/\r?\n[ \t]/g, '');
const icsDate = (value, tzid) => {
  // Handles 20240131T190000Z, 20240131T190000, and DATE 20240131.
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(value);
  if (!m) return null;
  if (m[7] === 'Z') return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  if (!m[4]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Naive local time — treated as UTC (tzid handling is out of scope for v1).
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
};
const icsUnescape = (text) => String(text || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();

const extractIcs = (icsText, msg) => {
  const events = [];
  const unfolded = unfoldIcs(icsText);
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const end = block.split(/END:VEVENT/i)[0];
    const prop = (name) => {
      const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(end);
      return m ? m[1].trim() : '';
    };
    const title = icsUnescape(prop('SUMMARY'));
    const start = icsDate(prop('DTSTART'));
    const dtEnd = prop('DTEND');
    const allDay = /^DTSTART;[^:]*VALUE=DATE/im.test(end);
    let endDate = icsDate(dtEnd);
    if (!endDate && start) endDate = new Date(start.getTime() + 60 * 60 * 1000);
    if (!title || !start) continue;
    const uid = prop('UID');
    const rrule = prop('RRULE');
    const status = prop('STATUS').toUpperCase();
    events.push({
      externalId: `ics-${stableId(uid || '', title, start.toISOString(), msg.from || '')}`,
      title,
      start,
      end: endDate,
      allDay,
      location: icsUnescape(prop('LOCATION')),
      recurrenceRule: rrule || null,
      cancelled: status === 'CANCELLED',
      origin: 'email',
    });
  }
  return events;
};

// Sender-domain templates: subject/regex → {title, venue, date}. Each returns
// null when it doesn't match so garbage mail yields [].
const DOMAIN_RULES = [
  {
    domains: ['bookmyshow', 'in.bookmyshow'],
    subject: /(?:booking confirmation|your (?:movie|show|ticket|booking))[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /movie[:\s]+([^\n|]+)/i, venue: /(?:cinema|theatre|venue)[:\s]+([^\n|]+)/i, date: /(?:date|show\s*(?:time|on)?)[:\s]+([^\n|]+)/i },
      { title: /(?:^|\n)\s*([^\n]+?)\s*\((\w{2,4})\)/i },
    ],
  },
  {
    domains: ['paytm', 'insider'],
    subject: /(?:ticket|booking|confirmed)[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /(?:event|movie|show)[:\s]+([^\n|]+)/i, venue: /venue[:\s]+([^\n|]+)/i, date: /(?:date|time|when)[:\s]+([^\n|]+)/i },
    ],
  },
  {
    domains: ['pvrcinemas', 'pvr'],
    subject: /(?:booking|ticket|confirmation)[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /movie[:\s]+([^\n|]+)/i, venue: /(?:cinema|venue|pvr[^\n:]{0,20})[:\s]+([^\n|]+)/i, date: /(?:date|show time|showtime)[:\s]+([^\n|]+)/i },
    ],
  },
  {
    domains: ['inoxmovies', 'inox'],
    subject: /(?:booking|ticket|confirmation)[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /movie[:\s]+([^\n|]+)/i, venue: /(?:cinema|venue|inox[^\n:]{0,20})[:\s]+([^\n|]+)/i, date: /(?:date|show time|showtime)[:\s]+([^\n|]+)/i },
    ],
  },
  {
    domains: ['fandango'],
    subject: /(?:ticket|confirmation)[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /movie[:\s]+([^\n|]+)/i, venue: /(?:theater|theatre|venue)[:\s]+([^\n|]+)/i, date: /(?:date|showtime|show time)[:\s]+([^\n|]+)/i },
    ],
  },
  {
    domains: ['atomtickets', 'atom'],
    subject: /(?:ticket|confirmation)[^|]*?[-–:]\s*(.+?)(?:\s*\||$)/i,
    patterns: [
      { title: /movie[:\s]+([^\n|]+)/i, venue: /(?:theater|theatre|venue)[:\s]+([^\n|]+)/i, date: /(?:date|showtime|show time)[:\s]+([^\n|]+)/i },
    ],
  },
];

const parseLooseDate = (text, fallback) => {
  if (!text) return fallback;
  const direct = toDate(text);
  if (direct) return direct;
  // Try "Sat, 15 Nov 2025" / "15 Nov 2025, 7:30 PM" style fragments.
  const m = /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}[^\n|,]*)/.exec(text);
  if (m) {
    const d = toDate(m[1]);
    if (d) return d;
  }
  const withTime = /(\d{1,2}:\d{2}\s*(?:am|pm))/i.exec(text);
  if (withTime && fallback) {
    const t = withTime[1].toLowerCase();
    const [hms, mer] = t.split(/\s/);
    let [h, mm] = hms.split(':').map(Number);
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    const d = new Date(fallback);
    d.setHours(h, mm, 0, 0);
    return d;
  }
  return fallback;
};

const extractDomainTemplates = (text, subject, from, msg) => {
  const events = [];
  const sender = (from || '').toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (!rule.domains.some(domain => sender.includes(domain))) continue;
    let title = '';
    const sm = rule.subject.exec(subject || '');
    if (sm) title = sm[1].trim();
    let venue = '';
    let start = null;
    for (const pattern of rule.patterns) {
      if (!title && pattern.title) {
        const m = pattern.title.exec(text);
        if (m) title = decodeEntities(m[1]).trim();
      }
      if (!venue && pattern.venue) {
        const m = pattern.venue.exec(text);
        if (m) venue = decodeEntities(m[1]).trim();
      }
      if (!start && pattern.date) {
        const m = pattern.date.exec(text);
        if (m) start = parseLooseDate(m[1], msg.date);
      }
    }
    if (!title) continue;
    if (!start) start = msg.date ? new Date(msg.date) : null;
    if (!start) continue;
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    events.push({
      externalId: `mail-${stableId(sender, title, start.toISOString())}`,
      title: title.replace(/\s+/g, ' ').slice(0, 120),
      start,
      end,
      allDay: false,
      location: venue,
      origin: 'email',
    });
  }
  return events;
};

/**
 * Extract booking events from a normalized message object.
 * @param {{subject?: string, from?: string, date?: Date, html?: string,
 *          text?: string, attachments?: Array<{contentType?: string,
 *          filename?: string, content?: string|Buffer}>}} msg
 */
const extractBookingEvents = (msg = {}) => {
  const found = [];
  const html = msg.html || '';
  const text = msg.text || stripTags(html);
  if (html) {
    found.push(...extractJsonLd(html, msg));
    found.push(...extractMicrodata(html, msg));
  }
  const parts = [text];
  for (const att of msg.attachments || []) {
    const type = att.contentType || att.content_type || '';
    const name = att.filename || '';
    if (type.includes('calendar') || /\.ics$/i.test(name)) {
      parts.push(Buffer.isBuffer(att.content) ? att.content.toString('utf8') : String(att.content || ''));
    }
  }
  for (const part of parts) {
    if (/BEGIN:VCALENDAR/i.test(part)) {
      found.push(...extractIcs(part, msg));
    }
  }
  found.push(...extractDomainTemplates(text, msg.subject, msg.from, msg));

  // Dedup within a single message by externalId.
  const seen = new Set();
  return found.filter(event => {
    if (seen.has(event.externalId)) return false;
    seen.add(event.externalId);
    return true;
  });
};

module.exports = { extractBookingEvents, extractIcs, extractJsonLd, extractMicrodata };
