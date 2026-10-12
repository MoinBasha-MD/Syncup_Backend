const { extractBookingEvents } = require('./emailParser');

const BOOKING_KEYWORDS = ['ticket', 'booking', 'reservation', 'confirmation', 'itinerary'];
const LOOKBACK_MS = 30 * 24 * 3600 * 1000;
const MAX_MESSAGES = 25;

// imapflow/mailparser are optional installs — lazy-require so a missing
// package can never crash server boot (routes load this module eagerly).
const loadDeps = () => {
  try {
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    return { ImapFlow, simpleParser };
  } catch {
    const error = new Error('IMAP support is not installed on this server (imapflow/mailparser missing)');
    error.code = 'IMAP_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
};

const makeClient = ({ host, port, secure, email, password }, ImapFlow) =>
  new ImapFlow({
    host,
    port: port || (secure === false ? 143 : 993),
    secure: secure !== false,
    auth: { user: email, pass: password },
    logger: false,
    socketTimeout: 20000,
  });

/** Validate credentials by logging in; throws on failure. */
const verifyConnection = async (account) => {
  const { ImapFlow } = loadDeps();
  const client = makeClient(account, ImapFlow);
  await client.connect();
  await client.logout();
};

/**
 * Fetch booking-like messages from INBOX (subject keyword search, last 30
 * days, UIDs above lastUid when present). Returns { events, lastUid } where
 * events are normalized via emailParser rules.
 */
const fetchBookingEvents = async (account) => {
  const { ImapFlow, simpleParser } = loadDeps();
  const client = makeClient(account, ImapFlow);
  const events = [];
  let lastUid = Number(account.lastUid) || 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_MS);
      const subjectQuery = BOOKING_KEYWORDS.map(k => ({ subject: k }));
      const uids = await client.search({ or: subjectQuery.map(q => ({ since, ...q })) });
      const candidates = (uids || []).filter(uid => uid > lastUid).slice(-MAX_MESSAGES);
      for (const uid of candidates) {
        try {
          const message = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!message || !message.source) continue;
          const parsed = await simpleParser(message.source);
          const extracted = extractBookingEvents({
            subject: parsed.subject || '',
            from: parsed.from && parsed.from.text ? parsed.from.text : '',
            date: parsed.date || new Date(),
            html: typeof parsed.html === 'string' ? parsed.html : '',
            text: parsed.text || '',
            attachments: (parsed.attachments || []).map(a => ({
              contentType: a.contentType,
              filename: a.filename,
              content: a.content,
            })),
          });
          extracted.forEach(event => {
            event.externalId = `imap-${uid}-${event.externalId}`;
            events.push(event);
          });
          if (uid > lastUid) lastUid = uid;
        } catch (error) {
          console.warn(`📧 [IMAP] Skipping uid ${uid}: ${error.message}`);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (error) {
    try { await client.logout(); } catch { /* already closed */ }
    throw error;
  }
  return { events, lastUid };
};

module.exports = { verifyConnection, fetchBookingEvents, BOOKING_KEYWORDS };
