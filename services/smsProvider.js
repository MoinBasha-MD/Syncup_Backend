/**
 * SMS Provider abstraction layer
 *
 * Selects the active SMS/OTP provider based on the SMS_PROVIDER env var and
 * delegates all send/verify calls to it. This keeps the OTP routes and any
 * future caller (signup, reverify, SIM test) completely agnostic of the
 * underlying gateway, so swapping Twilio (trial) -> MSG91 (India production)
 * is a single env-var change with no app/frontend code change.
 *
 * Supported providers:
 *   - twilio  : Twilio Verify API (handles OTP generation + validation server-side)
 *   - msg91   : MSG91 (India-first, DLT-compliant) — stubbed for future production swap
 *
 * Env vars:
 *   SMS_PROVIDER            = 'twilio' | 'msg91'
 *   TWILIO_ACCOUNT_SID      = Twilio account SID
 *   TWILIO_AUTH_TOKEN       = Twilio auth token
 *   TWILIO_VERIFY_SID       = Twilio Verify service SID (the "VA..." id)
 *   MSG91_AUTH_KEY          = MSG91 auth key (future)
 */

const twilioProvider = require('./smsProviders/twilioProvider');
const msg91Provider = require('./smsProviders/msg91Provider');

const PROVIDERS = {
  twilio: twilioProvider,
  msg91: msg91Provider,
};

const getProvider = () => {
  const name = (process.env.SMS_PROVIDER || 'twilio').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `[smsProvider] Unknown SMS_PROVIDER "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
};

/**
 * Send an OTP to a phone number.
 * @param {string} to - Phone number (E.164 expected, e.g. +919876543210)
 * @param {object} opts - Optional { channel: 'sms' | 'call' }
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendOtp = async (to, opts = {}) => {
  const provider = getProvider();
  return provider.sendOtp(to, opts);
};

/**
 * Verify an OTP code against a phone number.
 * @param {string} to - Phone number (E.164 expected)
 * @param {string} code - The OTP code entered by the user
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const verifyOtp = async (to, code) => {
  const provider = getProvider();
  return provider.verifyOtp(to, code);
};

/**
 * Whether the provider manages its own OTP codes (e.g. Twilio Verify).
 * If true, the caller should NOT generate/store a code in otpService —
 * it should call sendOtp then verifyOtp and trust the provider's result.
 * If false, the caller generates the code, stores it via otpService, and
 * the provider only transports it.
 */
const providerManagesCodes = () => getProvider().managesCodes;

module.exports = {
  sendOtp,
  verifyOtp,
  providerManagesCodes,
  getProvider,
};
