const crypto = require('crypto');

let generatedKey = null;

/**
 * AES-256-GCM key for encrypting TOTP secrets at rest.
 * ADMIN_TOTP_ENC_KEY must be 64 hex chars; production fails fast when it is
 * missing or malformed, other envs fall back to a per-process random key
 * (encrypted secrets become unreadable after restart — dev only).
 */
const getTotpEncKey = () => {
  const hex = process.env.ADMIN_TOTP_ENC_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(hex || '')) {
    return Buffer.from(hex, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_TOTP_ENC_KEY must be set in production (64 hex chars)');
  }
  if (!generatedKey) {
    generatedKey = crypto.randomBytes(32);
    console.warn('⚠️ [ADMIN AUTH] ADMIN_TOTP_ENC_KEY is not set; using a random per-process key. Enrolled TOTP secrets will not survive restarts.');
  }
  return generatedKey;
};

/** AES-256-GCM: returns `iv:authTag:ciphertext` (base64 parts). */
const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTotpEncKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
};

const decrypt = (payload) => {
  const [iv, authTag, encrypted] = String(payload || '').split(':');
  if (!iv || !authTag || !encrypted) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTotpEncKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

const sha256hex = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString('base64url');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Token = (len = 12) => {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map(b => BASE32[b % 32]).join('');
};

/** Ten xxxx-xxxx-xxxx recovery codes (store sha256 hashes, show once). */
const generateRecoveryCodes = () =>
  Array.from({ length: 10 }, () => base32Token(12).match(/.{4}/g).join('-'));

/**
 * Verify an RSA-SHA256 (PKCS#1 v1.5) signature produced by
 * react-native-biometrics on Android. publicKeyBase64 is the base64 X.509
 * SubjectPublicKeyInfo the library returns.
 * @returns {boolean}
 */
const verifyDeviceSignature = (publicKeyBase64, payload, signatureBase64) => {
  try {
    const der = Buffer.from(String(publicKeyBase64), 'base64');
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64').replace(/.{64}/g, '$&\n')}\n-----END PUBLIC KEY-----`;
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(String(payload), 'utf8'),
      pem,
      Buffer.from(String(signatureBase64), 'base64')
    );
  } catch {
    return false;
  }
};

module.exports = {
  getTotpEncKey,
  encrypt,
  decrypt,
  sha256hex,
  randomToken,
  base32Token,
  generateRecoveryCodes,
  verifyDeviceSignature,
};
