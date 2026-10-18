const crypto = require('crypto');
const { ServiceUnavailableError } = require('./errorClasses');

function requireDataKey() {
  const key = process.env.SYNC_SPACE_DATA_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || '')) {
    throw new ServiceUnavailableError('Sync Space integrations are not configured');
  }
  return Buffer.from(key, 'hex');
}

function encryptSecret(value, aad) {
  const key = requireDataKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((segment) => segment.toString('base64')).join('.');
}

function decryptSecret(value, aad) {
  if (typeof value !== 'string') throw new Error('Invalid secret encoding');
  const segments = value.split('.');
  if (segments.length !== 3) throw new Error('Invalid secret encoding');
  const [iv, tag, ciphertext] = segments.map((segment) => {
    try {
      return Buffer.from(segment, 'base64');
    } catch {
      throw new Error('Invalid secret encoding');
    }
  });
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid secret encoding');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireDataKey(), iv);
  decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function digestSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireSubjectKey() {
  const key = process.env.SYNC_SPACE_SUBJECT_KEY;
  if (typeof key !== 'string' || key.length < 32) {
    throw new ServiceUnavailableError('Sync Space integrations are not configured');
  }
  return key;
}

function pairwiseSubject(appId, userId) {
  return `sub_${crypto
    .createHmac('sha256', requireSubjectKey())
    .update(`${appId}:${userId}`)
    .digest('base64url')
    .slice(0, 32)}`;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_LIMIT = 62 * Math.floor(256 / 62);

// 32-char base62 admin access key with rejection sampling (no modulo bias).
function generateAdminKeySecret() {
  const out = [];
  while (out.length < 32) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= BASE62_LIMIT) continue;
    out.push(BASE62[byte % 62]);
  }
  return out.join('');
}

module.exports = { requireDataKey, encryptSecret, decryptSecret, digestSecret, pairwiseSubject, generateAdminKeySecret };
