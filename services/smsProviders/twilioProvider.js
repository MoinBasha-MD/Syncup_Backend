/**
 * Twilio Verify provider
 *
 * Uses Twilio's Verify API, which handles OTP generation, delivery (SMS/voice),
 * rate-limiting, and validation server-side. This is the simplest path and
 * works with Twilio trial accounts for Indian numbers because Verify uses
 * pre-approved DLT-compliant templates automatically.
 *
 * We do NOT generate or store the code ourselves — we ask Twilio to send it,
 * then ask Twilio to verify what the user typed. otpService.createPhoneOTP
 * and verifyPhoneOTP detect managesCodes=true and delegate to this provider.
 *
 * Env vars:
 *   TWILIO_ACCOUNT_SID  = AC...
 *   TWILIO_AUTH_TOKEN   = <token>
 *   TWILIO_VERIFY_SID   = VA...  (Verify service SID)
 */

const twilio = require('twilio');

let client = null;
let verifyService = null;

const getClient = () => {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('[twilioProvider] TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  }
  client = twilio(sid, token);
  return client;
};

const getVerifyService = () => {
  if (verifyService) return verifyService;
  const verifySid = process.env.TWILIO_VERIFY_SID;
  if (!verifySid) {
    throw new Error('[twilioProvider] TWILIO_VERIFY_SID must be set (the VA... service sid)');
  }
  const c = getClient();
  verifyService = c.verify.v2.services(verifySid);
  return verifyService;
};

/**
 * Normalise a phone number to E.164 if it isn't already.
 * Accepts "+919876543210" or "919876543210" or "9876543210" (assumes India +91
 * when no country code is present).
 */
const toE164 = (raw) => {
  if (!raw) return raw;
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `+91${s}`; // default India
  if (s.length === 11 && s.startsWith('1')) return `+${s}`; // US/CA
  if (s.length === 12 && s.startsWith('91')) return `+${s}`;
  return `+${s}`;
};

/**
 * Send an OTP via Twilio Verify.
 * @param {string} to - phone number (any reasonable format; normalised here)
 * @param {object} opts - { channel: 'sms' | 'call' }
 */
const sendOtp = async (to, opts = {}) => {
  try {
    const e164 = toE164(to);
    const channel = opts.channel === 'call' ? 'call' : 'sms';
    console.log(`📱 [twilioProvider] Sending OTP to ${e164} via ${channel}`);

    const service = getVerifyService();
    const verification = await service.verifications.create({
      to: e164,
      channel,
    });

    console.log(`✅ [twilioProvider] Verification created: ${verification.sid} (status: ${verification.status})`);
    return { success: true, messageId: verification.sid };
  } catch (error) {
    console.error('❌ [twilioProvider] sendOtp error:', error.message);
    const isTrialRestriction =
      error.code === 21608 || /verified/i.test(error.message || '');
    return {
      success: false,
      error: isTrialRestriction
        ? 'Twilio trial: this number is not verified in your Twilio console. Add it under Phone Numbers -> Verified Caller IDs.'
        : error.message,
      trialRestriction: isTrialRestriction,
    };
  }
};

/**
 * Verify an OTP code via Twilio Verify.
 * @param {string} to - phone number
 * @param {string} code - the OTP the user entered
 */
const verifyOtp = async (to, code) => {
  try {
    const e164 = toE164(to);
    console.log(`🔍 [twilioProvider] Verifying OTP for ${e164}`);

    const service = getVerifyService();
    const check = await service.verificationChecks.create({
      to: e164,
      code,
    });

    const success = check.status === 'approved';
    console.log(`✅ [twilioProvider] Verification check: ${check.status}`);
    return {
      success,
      error: success ? undefined : 'Invalid or expired code.',
    };
  } catch (error) {
    console.error('❌ [twilioProvider] verifyOtp error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  managesCodes: true, // Twilio Verify issues + validates its own codes
};
