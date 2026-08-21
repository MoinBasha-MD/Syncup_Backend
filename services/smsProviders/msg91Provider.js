/**
 * MSG91 provider (STUB — for future India production swap)
 *
 * MSG91 is the de-facto India SMS gateway with DLT-compliant sender IDs and
 * templates. This module is a skeleton so that flipping SMS_PROVIDER=msg91 in
 * .env is the only change needed to switch from Twilio trial to MSG91 live.
 *
 * Unlike Twilio Verify, MSG91's OTP service (api.msg91.com/ap) can manage codes
 * for you, OR you can use the plain SMS API and generate your own code via
 * otpService. This stub assumes the managed OTP endpoint for parity with the
 * Twilio path.
 *
 * Env vars (future):
 *   MSG91_AUTH_KEY   = <auth key>
 *   MSG91_SENDER_ID  = <DLT-approved sender ID>
 *   MSG91_TEMPLATE_ID = <DLT-approved template ID>
 *
 * Docs: https://docs.msg91.com
 */

const MSG91_BASE = 'https://api.msg91.com/api/v5/otp';

const toE164 = (raw) => {
  if (!raw) return raw;
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `91${s}`; // MSG91 wants no leading +
  if (s.length === 11 && s.startsWith('1')) return s;
  if (s.length === 12 && s.startsWith('91')) return s;
  return s;
};

const sendOtp = async (to, opts = {}) => {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    return {
      success: false,
      error: '[msg91Provider] MSG91_AUTH_KEY not set. This provider is not yet configured.',
    };
  }
  // TODO: implement when switching to production MSG91.
  // Use axios (already a backend dep) to POST to MSG91_BASE with the auth key,
  // sender ID, template ID, and the recipient number.
  return {
    success: false,
    error: '[msg91Provider] Not implemented yet. Set SMS_PROVIDER=twilio for now.',
  };
};

const verifyOtp = async (to, code) => {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    return {
      success: false,
      error: '[msg91Provider] MSG91_AUTH_KEY not set. This provider is not yet configured.',
    };
  }
  // TODO: implement GET MSG91_BASE/verify?otp=<code>&authkey=<key>&mobile=<to>
  return {
    success: false,
    error: '[msg91Provider] Not implemented yet. Set SMS_PROVIDER=twilio for now.',
  };
};

module.exports = {
  sendOtp,
  verifyOtp,
  managesCodes: true, // MSG91 OTP API manages its own codes
};
