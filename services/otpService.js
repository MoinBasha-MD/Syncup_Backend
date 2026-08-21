const OTP = require('../models/otpModel');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { normalizePhoneNumber } = require('../utils/phoneUtils');
const smsProvider = require('./smsProvider');

class OTPService {
  /**
   * Generate a 6-digit OTP
   */
  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Create and store a new OTP
   */
  async createOTP(identifier, type, ipAddress, userAgent) {
    try {
      console.log(`📧 [OTP SERVICE] Creating OTP for ${identifier} (${type})`);

      // Check rate limiting
      // ⚠️ RATE LIMIT SETTING - Change this value as needed:
      // PRODUCTION: 3 OTPs per hour (recommended)
      // TESTING: 20 OTPs per hour (current setting)
      const MAX_OTP_PER_HOUR = 20; // TODO: Change back to 3 for production
      
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentOTPs = await OTP.countDocuments({
        identifier,
        type,
        createdAt: { $gte: oneHourAgo },
      });

      if (recentOTPs >= MAX_OTP_PER_HOUR) {
        console.log(`⚠️ [OTP SERVICE] Rate limit exceeded for ${identifier} (${recentOTPs}/${MAX_OTP_PER_HOUR})`);
        return {
          success: false,
          error: `Too many OTP requests. You've used ${recentOTPs} of ${MAX_OTP_PER_HOUR} allowed per hour. Please try again later.`,
          rateLimitExceeded: true,
          attemptsUsed: recentOTPs,
          maxAttempts: MAX_OTP_PER_HOUR,
        };
      }

      // Generate OTP
      const otp = this.generateOTP();
      const otpHash = await bcrypt.hash(otp, 10);

      // Invalidate previous OTPs of same type
      await OTP.updateMany(
        { identifier, type, verified: false },
        { verified: true }
      );

      // Create new OTP
      const otpDoc = await OTP.create({
        identifier,
        otpHash,
        type,
        expiresAt: new Date(Date.now() + 1 * 60 * 1000), // 1 minute
        ipAddress,
        userAgent,
      });

      console.log(`✅ [OTP SERVICE] OTP created successfully (ID: ${otpDoc._id})`);
      return { success: true, otp, otpId: otpDoc._id };
    } catch (error) {
      console.error('❌ [OTP SERVICE] Error creating OTP:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify an OTP
   */
  async verifyOTP(identifier, otp, type) {
    try {
      console.log(`🔍 [OTP SERVICE] Verifying OTP for ${identifier} (${type})`);

      // Find valid OTP
      const otpDoc = await OTP.findOne({
        identifier,
        type,
        verified: false,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!otpDoc) {
        console.log(`❌ [OTP SERVICE] No valid OTP found for ${identifier}`);
        return {
          success: false,
          error: 'Invalid or expired OTP. Please request a new code.',
        };
      }

      // Check max attempts
      if (otpDoc.attempts >= otpDoc.maxAttempts) {
        console.log(`❌ [OTP SERVICE] Max attempts exceeded for ${identifier}`);
        return {
          success: false,
          error: 'Maximum attempts exceeded. Please request a new code.',
        };
      }

      // Verify OTP
      const isValid = await bcrypt.compare(otp, otpDoc.otpHash);

      if (!isValid) {
        // Increment attempts
        otpDoc.attempts += 1;
        await otpDoc.save();

        const attemptsLeft = otpDoc.maxAttempts - otpDoc.attempts;
        console.log(`❌ [OTP SERVICE] Invalid OTP. Attempts left: ${attemptsLeft}`);
        
        return {
          success: false,
          error: `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          attemptsLeft,
        };
      }

      // Mark as verified
      otpDoc.verified = true;
      await otpDoc.save();

      console.log(`✅ [OTP SERVICE] OTP verified successfully for ${identifier}`);
      return { success: true };
    } catch (error) {
      console.error('❌ [OTP SERVICE] Error verifying OTP:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if an OTP has been verified (for registration flow)
   */
  async isOTPVerified(identifier, type) {
    try {
      const recentVerified = await OTP.findOne({
        identifier,
        type,
        verified: true,
        createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // Within last 5 minutes
      }).sort({ createdAt: -1 });

      return !!recentVerified;
    } catch (error) {
      console.error('❌ [OTP SERVICE] Error checking OTP verification:', error);
      return false;
    }
  }

  /**
   * Clean up expired OTPs
   */
  async cleanExpiredOTPs() {
    try {
      const result = await OTP.deleteMany({
        expiresAt: { $lt: new Date() },
      });
      
      if (result.deletedCount > 0) {
        console.log(`🧹 [OTP SERVICE] Cleaned ${result.deletedCount} expired OTPs`);
      }
      
      return result.deletedCount;
    } catch (error) {
      console.error('❌ [OTP SERVICE] Error cleaning expired OTPs:', error);
      return 0;
    }
  }

  /**
   * Get OTP statistics (for admin/debugging)
   */
  async getStats() {
    try {
      const total = await OTP.countDocuments();
      const verified = await OTP.countDocuments({ verified: true });
      const expired = await OTP.countDocuments({ expiresAt: { $lt: new Date() } });
      const active = await OTP.countDocuments({
        verified: false,
        expiresAt: { $gt: new Date() }
      });

      return {
        total,
        verified,
        expired,
        active,
      };
    } catch (error) {
      console.error('❌ [OTP SERVICE] Error getting stats:', error);
      return null;
    }
  }

  // ==========================================================================
  // PHONE OTP
  // ==========================================================================
  //
  // Two modes depending on the active SMS provider:
  //
  //  1. Provider-managed codes (e.g. Twilio Verify): the provider generates,
  //     delivers, and validates the OTP itself. createPhoneOTP just asks the
  //     provider to send it; verifyPhoneOTP asks the provider to check it.
  //     No OTP document is stored in Mongo. This is the default/trial path.
  //
  //  2. Self-managed codes (e.g. plain MSG91 SMS): we generate a 6-digit code,
  //     hash + store it in the OTP collection (reusing the existing rate-limit
  //     / expiry / attempts logic), and the provider only transports it.
  //     verifyPhoneOTP then compares against the stored hash.
  //
  // The routes call these methods; they don't need to know which mode is active.

  /**
   * Send a phone OTP.
   * @param {string} rawPhone - phone number in any reasonable format
   * @param {string} type - 'phone_verification' | 'phone_test' | 'phone_reverify'
   * @param {string} ipAddress
   * @param {string} userAgent
   * @returns {Promise<{success, error?, rateLimitExceeded?, trialRestriction?, expiresIn?}>}
   */
  async createPhoneOTP(rawPhone, type, ipAddress, userAgent) {
    try {
      const phone = normalizePhoneNumber(rawPhone);
      console.log(`📱 [OTP SERVICE] createPhoneOTP for ${phone} (${type})`);

      // Rate limit (reuse the same per-identifier-per-hour cap as email)
      const MAX_OTP_PER_HOUR = 20; // TODO: 3 for production
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await OTP.countDocuments({
        identifier: phone,
        type,
        createdAt: { $gte: oneHourAgo },
      });
      if (recent >= MAX_OTP_PER_HOUR) {
        return {
          success: false,
          rateLimitExceeded: true,
          error: `Too many OTP requests (${recent}/${MAX_OTP_PER_HOUR} per hour). Please try again later.`,
        };
      }

      const providerManages = smsProvider.providerManagesCodes();

      if (providerManages) {
        // Twilio Verify path: provider sends + validates its own code.
        const result = await smsProvider.sendOtp(phone, { channel: 'sms' });
        if (!result.success) {
          return {
            success: false,
            error: result.error,
            trialRestriction: result.trialRestriction,
          };
        }
        // Store a lightweight marker so rate-limit counts and isPhoneOTPRecent
        // still work. No code hash — the provider owns the code.
        await OTP.create({
          identifier: phone,
          otpHash: 'provider-managed',
          type,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
          ipAddress,
          userAgent,
          verified: false,
        });
        return { success: true, expiresIn: 600 };
      }

      // Self-managed path: generate, hash, store, then send via provider.
      const otp = this.generateOTP();
      const otpHash = await bcrypt.hash(otp, 10);

      await OTP.updateMany(
        { identifier: phone, type, verified: false },
        { verified: true }
      );

      await OTP.create({
        identifier: phone,
        otpHash,
        type,
        expiresAt: new Date(Date.now() + 1 * 60 * 1000),
        ipAddress,
        userAgent,
      });

      const sendResult = await smsProvider.sendOtp(phone, {
        channel: 'sms',
        code: otp,
      });
      if (!sendResult.success) {
        return {
          success: false,
          error: sendResult.error,
          trialRestriction: sendResult.trialRestriction,
        };
      }
      return { success: true, expiresIn: 60 };
    } catch (error) {
      console.error('❌ [OTP SERVICE] createPhoneOTP error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify a phone OTP.
   * @param {string} rawPhone
   * @param {string} code
   * @param {string} type
   * @returns {Promise<{success, error?, attemptsLeft?}>}
   */
  async verifyPhoneOTP(rawPhone, code, type) {
    try {
      const phone = normalizePhoneNumber(rawPhone);
      console.log(`🔍 [OTP SERVICE] verifyPhoneOTP for ${phone} (${type})`);

      const providerManages = smsProvider.providerManagesCodes();

      if (providerManages) {
        // Twilio Verify path: ask the provider to validate the code.
        const result = await smsProvider.verifyOtp(phone, code);
        if (result.success) {
          // Mark the most recent unverified marker as verified for analytics.
          await OTP.updateOne(
            { identifier: phone, type, verified: false },
            { verified: true }
          ).sort({ createdAt: -1 });
        }
        return result;
      }

      // Self-managed path: compare against stored hash (mirror verifyOTP logic).
      const otpDoc = await OTP.findOne({
        identifier: phone,
        type,
        verified: false,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!otpDoc) {
        return { success: false, error: 'Invalid or expired OTP. Please request a new code.' };
      }
      if (otpDoc.attempts >= otpDoc.maxAttempts) {
        return { success: false, error: 'Maximum attempts exceeded. Please request a new code.' };
      }

      const isValid = await bcrypt.compare(code, otpDoc.otpHash);
      if (!isValid) {
        otpDoc.attempts += 1;
        await otpDoc.save();
        const attemptsLeft = otpDoc.maxAttempts - otpDoc.attempts;
        return {
          success: false,
          error: `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          attemptsLeft,
        };
      }

      otpDoc.verified = true;
      await otpDoc.save();
      return { success: true };
    } catch (error) {
      console.error('❌ [OTP SERVICE] verifyPhoneOTP error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check whether a phone OTP was recently verified (for downstream flows).
   */
  async isPhoneOTPVerified(rawPhone, type) {
    try {
      const phone = normalizePhoneNumber(rawPhone);
      const recentVerified = await OTP.findOne({
        identifier: phone,
        type,
        verified: true,
        createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
      }).sort({ createdAt: -1 });
      return !!recentVerified;
    } catch (error) {
      console.error('❌ [OTP SERVICE] isPhoneOTPVerified error:', error);
      return false;
    }
  }
}

module.exports = new OTPService();
