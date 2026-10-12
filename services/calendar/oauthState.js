const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const SECRET = () => process.env.CALENDAR_STATE_SECRET || process.env.JWT_SECRET;

/**
 * Short-lived signed `state` for the OAuth round trip — carries the userId so
 * the unauthenticated callback can attribute the account, and a nonce so the
 * value can't be replayed for a different purpose.
 */
const signOAuthState = (userId, provider) =>
  jwt.sign(
    { sub: String(userId), provider, nonce: crypto.randomBytes(8).toString('hex'), scope: 'calendar-oauth' },
    SECRET(),
    { expiresIn: STATE_TTL_SECONDS }
  );

const verifyOAuthState = (state, provider) => {
  const payload = jwt.verify(String(state), SECRET());
  if (payload.scope !== 'calendar-oauth' || !payload.sub) {
    throw new Error('Invalid OAuth state');
  }
  if (provider && payload.provider !== provider) {
    throw new Error('OAuth state provider mismatch');
  }
  return { userId: payload.sub, provider: payload.provider };
};

module.exports = { signOAuthState, verifyOAuthState, STATE_TTL_SECONDS };
