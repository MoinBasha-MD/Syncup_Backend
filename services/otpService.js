const OTP = require('../models/otpModel');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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

      // Check rate limiting (max 3 OTPs per hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentOTPs = await OTP.countDocuments({
        identifier,
        type,
        createdAt: { $gte: oneHourAgo },
      });

      if (recentOTPs >= 3) {
        console.log(`⚠️ [OTP SERVICE] Rate limit exceeded for ${identifier}`);
        return {
          success: false,
          error: 'Too many OTP requests. Please try again in an hour.',
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
}

module.exports = new OTPService();
