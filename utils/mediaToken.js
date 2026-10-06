const crypto = require('crypto');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_TOKEN_LENGTH = 512;
const HKDF_INFO = 'syncup-media-token-v1';

// Returns the HMAC key, or null when neither MEDIA_TOKEN_SECRET (>=32 chars)
// nor JWT_SECRET is configured.
const getSecret = () => {
  const configured = process.env.MEDIA_TOKEN_SECRET;
  if (configured && configured.length >= 32) {
    return configured;
  }
  if (!process.env.JWT_SECRET) {
    return null;
  }
  return crypto.hkdfSync(
    'sha256',
    process.env.JWT_SECRET,
    'syncup-media-token',
    HKDF_INFO,
    32
  );
};

const issueMediaToken = (userId, ttlMs = DEFAULT_TTL_MS) => {
  const secret = getSecret();
  if (!secret) {
    throw new Error('MEDIA_TOKEN_SECRET or JWT_SECRET must be configured to issue media tokens');
  }
  const uid = Buffer.from(String(userId), 'utf8').toString('base64url');
  const exp = Date.now() + ttlMs;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${uid}.${exp}`)
    .digest('base64url');
  return `${uid}.${exp}.${sig}`;
};

// Returns the userId for a valid token, null otherwise. Never throws.
const verifyMediaToken = (token) => {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [uid, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    return null;
  }
  const secret = getSecret();
  if (!secret) {
    return null;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${uid}.${expStr}`)
    .digest();
  const presented = Buffer.from(sig, 'base64url');
  // Re-encode: base64url decoding ignores trailing padding bits, so a
  // tampered last char could otherwise decode to identical bytes.
  if (presented.toString('base64url') !== sig) {
    return null;
  }
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    return null;
  }
  return Buffer.from(uid, 'base64url').toString('utf8');
};

// Appends/replaces ?mt= on URLs that point at our own uploads. Third-party or
// non-uploads URLs are returned unchanged. Returns null for unusable input.
const withMediaToken = (url, userId) => {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  // Media paths gated by requireMediaAccess: static /uploads plus the
  // controller-streamed music endpoint (not under /uploads).
  const isMediaPath = (p) => p.includes('/uploads/') || p.startsWith('/api/music/stream');

  let isOurs = url.startsWith('/uploads/') || url.startsWith('/api/music/stream');
  if (!isOurs) {
    try {
      const parsed = new URL(url);
      const apiHost = (process.env.API_BASE_URL || process.env.API_HOST || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
      const ownHost = apiHost && parsed.host === apiHost;
      const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '10.0.2.2';
      isOurs = (ownHost || localHost) && isMediaPath(parsed.pathname);
    } catch {
      return url;
    }
  }
  if (!isOurs) {
    return url;
  }

  const token = issueMediaToken(userId);
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const withoutMt = base.replace(/([?&])mt=[^&]*&?/, (m, p1, offset) =>
    m.endsWith('&') ? p1 : ''
  );
  const separator = withoutMt.includes('?') ? '&' : '?';
  return `${withoutMt}${separator}mt=${token}${hash}`;
};

module.exports = { issueMediaToken, verifyMediaToken, withMediaToken };
