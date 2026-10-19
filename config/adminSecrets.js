const crypto = require('crypto');

const ADMIN_JWT_AUDIENCE = 'syncup-admin';
const MIN_SECRET_LENGTH = 32;

let generatedSecret = null;

/**
 * Resolve the secret used to sign admin JWTs.
 *
 * In production this MUST be a dedicated ADMIN_JWT_SECRET that is at least
 * 32 chars long and different from JWT_SECRET — otherwise the process throws
 * so a misconfigured deploy fails fast at startup.
 *
 * Outside production a missing secret is replaced by a per-process random one
 * (admin sessions simply don't survive restarts in dev/test).
 */
const getAdminJwtSecret = () => {
  const secret = process.env.ADMIN_JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      throw new Error('ADMIN_JWT_SECRET is required in production');
    }
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`ADMIN_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (secret === process.env.JWT_SECRET) {
      throw new Error('ADMIN_JWT_SECRET must differ from JWT_SECRET');
    }
    return secret;
  }

  if (secret) return secret;

  if (!generatedSecret) {
    generatedSecret = crypto.randomBytes(48).toString('hex');
    console.warn('⚠️ [ADMIN AUTH] ADMIN_JWT_SECRET is not set; using a random per-process secret. Admin sessions will not survive restarts.');
  }
  return generatedSecret;
};

module.exports = { getAdminJwtSecret, ADMIN_JWT_AUDIENCE };
