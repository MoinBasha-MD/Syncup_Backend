const User = require('../models/userModel');
const otpService = require('../services/otpService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_REGEX = /^[a-f0-9]{64}$/i;

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidPassword = password =>
  typeof password === 'string' &&
  password.length >= 8 &&
  password.length <= 20 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /\d/.test(password);

const resetPasswordOTP = async (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const { newPassword, resetToken } = body;

  if (
    !EMAIL_REGEX.test(email) ||
    !isValidPassword(newPassword) ||
    typeof resetToken !== 'string' ||
    !RESET_TOKEN_REGEX.test(resetToken)
  ) {
    return res.status(400).json({
      success: false,
      message: 'A valid email, reset token, and new password are required',
    });
  }

  try {
    const user = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email address',
      });
    }

    const tokenConsumed = await otpService.consumePasswordResetToken(email, resetToken);
    if (!tokenConsumed) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired password reset token',
      });
    }

    user.password = newPassword;
    user.encryptedPassword = undefined;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.',
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.',
    });
  }
};

module.exports = { resetPasswordOTP };
