const crypto = require('crypto');

/**
 * AES-256-GCM encryption for OAuth/IMAP secrets at rest.
 * Key comes from env CALENDAR_TOKEN_KEY — either 64 hex chars (32 bytes)
 * or any non-empty string (hashed to 32 bytes with SHA-256).
 */
const getKey = () => {
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) {
    throw new Error('CALENDAR_TOKEN_KEY is not set');
  }
  return /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : crypto.createHash('sha256').update(raw).digest();
};

const encryptToken = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
};

const decryptToken = (blob) => {
  if (!blob) return null;
  const [ivB64, tagB64, dataB64] = String(blob).split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted token');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
};

module.exports = { encryptToken, decryptToken };
