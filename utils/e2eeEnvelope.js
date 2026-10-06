const ENVELOPE_ALG = 'x25519-hkdf-sha256-aes256gcm+ed25519';
const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_KEY_ENTRIES = 20;
const MAX_GROUP_ENVELOPE_BYTES = 1024 * 1024; // groups fan out to many devices
const MAX_GROUP_KEY_ENTRIES = 1000;
const MAX_DOC_KEY_ENTRIES = 200; // DocSpace: owner + grantees' devices

/**
 * Validate a Syncup E2EE v2 envelope submitted by a client.
 * The server stores and relays the envelope but cannot decrypt it — this is a
 * structural check so a malicious/buggy client cannot store arbitrary blobs
 * or replay an envelope into a different conversation.
 *
 * @param {object} e2ee - the `{ v, envelope }` wrapper from the request body
 * @param {object} opts
 * @param {string} opts.senderId - authenticated sender; envelope.sender.userId must equal it
 * @param {string} opts.expectedCtx - ctx the envelope must be bound to
 * @param {Set<string>} opts.allowedUserIds - every keys[] entry's userId must be in this set
 * @param {number} [opts.maxKeys] - max keys[] entries
 * @param {number} [opts.maxBytes] - max serialized envelope size
 * @returns {string|null} error code, or null when valid
 */
const validateEnvelope = (e2ee, { senderId, expectedCtx, allowedUserIds, maxKeys, maxBytes }) => {
  if (!e2ee || typeof e2ee !== 'object' || e2ee.v !== 2) {
    return 'INVALID_VERSION';
  }
  const env = e2ee.envelope;
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return 'INVALID_ENVELOPE';
  }
  try {
    if (Buffer.byteLength(JSON.stringify(env), 'utf8') > (maxBytes ?? MAX_ENVELOPE_BYTES)) {
      return 'ENVELOPE_TOO_LARGE';
    }
  } catch (_) {
    return 'INVALID_ENVELOPE';
  }
  if (env.v !== 2) {
    return 'INVALID_VERSION';
  }
  if (env.alg !== ENVELOPE_ALG) {
    return 'INVALID_ALG';
  }
  if (!env.sender || env.sender.userId !== senderId) {
    return 'SENDER_MISMATCH';
  }
  if (env.ctx !== expectedCtx) {
    return 'CTX_MISMATCH';
  }
  if (!Array.isArray(env.keys) || env.keys.length === 0 || env.keys.length > (maxKeys ?? MAX_KEY_ENTRIES)) {
    return 'INVALID_KEYS';
  }
  for (const entry of env.keys) {
    if (!entry || !allowedUserIds.has(entry.userId)) {
      return 'INVALID_KEYS';
    }
  }
  for (const field of ['msgId', 'iv', 'ct', 'sig']) {
    if (typeof env[field] !== 'string' || env[field].length === 0) {
      return 'MISSING_FIELD';
    }
  }
  return null;
};

/** DM envelope: dm:<sorted pair> ctx, the two parties, ≤20 keys, ≤256KB. */
const validateDmEnvelope = (e2ee, senderId, receiverId) =>
  validateEnvelope(e2ee, {
    senderId,
    expectedCtx: `dm:${[senderId, receiverId].sort().join(':')}`,
    allowedUserIds: new Set([senderId, receiverId]),
    maxKeys: MAX_KEY_ENTRIES,
    maxBytes: MAX_ENVELOPE_BYTES,
  });

const isE2eeV2 = (e2ee) => !!(e2ee && e2ee.v === 2);

const e2eeEnforced = () => process.env.E2EE_ENFORCE_DM === 'true';
const e2eeGroupEnforced = () => process.env.E2EE_ENFORCE_GROUP === 'true';
const e2eeOpenEnforced = () => process.env.E2EE_ENFORCE_OPEN === 'true';
const e2eePulseEnforced = () => process.env.E2EE_ENFORCE_PULSE === 'true';
const e2eeDocsEnforced = () => process.env.E2EE_ENFORCE_DOCS === 'true';

module.exports = {
  validateDmEnvelope,
  validateEnvelope,
  isE2eeV2,
  e2eeEnforced,
  e2eeGroupEnforced,
  e2eeOpenEnforced,
  e2eePulseEnforced,
  e2eeDocsEnforced,
  ENVELOPE_ALG,
  MAX_GROUP_KEY_ENTRIES,
  MAX_GROUP_ENVELOPE_BYTES,
  MAX_DOC_KEY_ENTRIES,
};
