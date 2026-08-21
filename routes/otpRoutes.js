const express = require('express');
const router = express.Router();
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');

/**
 * @route   POST /api/otp/send
 * @desc    Send OTP to email
 * @access  Public
 */
router.post('/send', async (req, res) => {
  try {
    const { email, type } = req.body;

    console.log(`📧 [OTP ROUTES] Send OTP request: ${email} (${type})`);

    // Validate input
    if (!email || !type) {
      return res.status(400).json({
        success: false,
        message: 'Email and type are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    // Validate type
    const validTypes = ['registration', 'password_reset', 'email_change', 'password_change', 'phone_change', 'account_deletion', '2fa'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP type',
      });
    }

    // Create OTP
    const otpResult = await otpService.createOTP(
      email.toLowerCase(),
      type,
      req.ip,
      req.get('user-agent')
    );

    if (!otpResult.success) {
      return res.status(429).json({
        success: false,
        message: otpResult.error,
      });
    }

    // Send email
    const emailResult = await emailService.sendOTP(email, otpResult.otp, type);

    if (!emailResult.success) {
      console.error('❌ [OTP ROUTES] Failed to send email:', emailResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.',
      });
    }

    console.log(`✅ [OTP ROUTES] OTP sent successfully to ${email}`);
    res.json({
      success: true,
      message: 'OTP sent successfully to your email',
      expiresIn: 60, // 1 minute in seconds
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /send:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

/**
 * @route   POST /api/otp/verify
 * @desc    Verify OTP
 * @access  Public
 */
router.post('/verify', async (req, res) => {
  try {
    const { email, otp, type } = req.body;

    console.log(`🔍 [OTP ROUTES] Verify OTP request: ${email} (${type})`);

    // Validate input
    if (!email || !otp || !type) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and type are required',
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Must be 6 digits.',
      });
    }

    // Verify OTP
    const result = await otpService.verifyOTP(email.toLowerCase(), otp, type);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
        attemptsLeft: result.attemptsLeft,
      });
    }

    console.log(`✅ [OTP ROUTES] OTP verified successfully for ${email}`);
    res.json({
      success: true,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /verify:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

/**
 * @route   POST /api/otp/resend
 * @desc    Resend OTP to email
 * @access  Public
 */
router.post('/resend', async (req, res) => {
  try {
    const { email, type } = req.body;

    console.log(`🔄 [OTP ROUTES] Resend OTP request: ${email} (${type})`);

    // Validate input
    if (!email || !type) {
      return res.status(400).json({
        success: false,
        message: 'Email and type are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    // Create new OTP
    const otpResult = await otpService.createOTP(
      email.toLowerCase(),
      type,
      req.ip,
      req.get('user-agent')
    );

    if (!otpResult.success) {
      return res.status(429).json({
        success: false,
        message: otpResult.error,
      });
    }

    // Send email
    const emailResult = await emailService.sendOTP(email, otpResult.otp, type);

    if (!emailResult.success) {
      console.error('❌ [OTP ROUTES] Failed to resend email:', emailResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP email. Please try again.',
      });
    }

    console.log(`✅ [OTP ROUTES] OTP resent successfully to ${email}`);
    res.json({
      success: true,
      message: 'OTP resent successfully',
      expiresIn: 60, // 1 minute in seconds
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /resend:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

/**
 * @route   GET /api/otp/test-connection
 * @desc    Test Gmail SMTP connection
 * @access  Public
 */
router.get('/test-connection', async (req, res) => {
  try {
    console.log('🔍 [OTP ROUTES] Testing Gmail SMTP connection...');
    
    const isConnected = await emailService.verifyConnection();
    
    if (isConnected) {
      res.json({
        success: true,
        message: 'Gmail SMTP connection verified successfully',
        email: process.env.EMAIL_USER,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Gmail SMTP connection failed. Check your credentials.',
        hint: 'Make sure EMAIL_USER and EMAIL_APP_PASSWORD are set correctly in .env file',
      });
    }
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /test-connection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test connection',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/otp/stats
 * @desc    Get OTP statistics (for debugging)
 * @access  Public (should be protected in production)
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await otpService.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   GET /api/otp/test-email
 * @desc    Test email service connection
 * @access  Public (for debugging)
 */
router.get('/test-email', async (req, res) => {
  try {
    console.log('🔍 [OTP ROUTES] Testing email service...');
    
    // Check if email credentials are configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      return res.status(500).json({
        success: false,
        message: 'Email credentials not configured in .env file',
        configured: false,
      });
    }

    // Verify SMTP connection
    const isConnected = await emailService.verifyConnection();
    
    if (isConnected) {
      console.log('✅ [OTP ROUTES] Email service test passed');
      res.json({
        success: true,
        message: 'Email service is working correctly',
        configured: true,
        emailUser: process.env.EMAIL_USER,
      });
    } else {
      console.error('❌ [OTP ROUTES] Email service test failed');
      res.status(500).json({
        success: false,
        message: 'Email service connection failed',
        configured: true,
        emailUser: process.env.EMAIL_USER,
      });
    }
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /test-email:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      configured: !!process.env.EMAIL_USER,
    });
  }
});

/**
 * @route   POST /api/otp/send-sms
 * @desc    Send an OTP to a phone number via the active SMS provider
 * @access  Public
 */
router.post('/send-sms', async (req, res) => {
  try {
    const { phoneNumber, type } = req.body;

    console.log(`📱 [OTP ROUTES] Send SMS OTP: ${phoneNumber} (${type})`);

    if (!phoneNumber || !type) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber and type are required',
      });
    }

    const validTypes = ['phone_verification', 'phone_test', 'phone_reverify'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP type for SMS. Use one of: ' + validTypes.join(', '),
      });
    }

    const { isValidPhoneNumber } = require('../utils/phoneUtils');
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
      });
    }

    const result = await otpService.createPhoneOTP(
      phoneNumber,
      type,
      req.ip,
      req.get('user-agent')
    );

    if (!result.success) {
      const status = result.rateLimitExceeded ? 429 : 502;
      return res.status(status).json({
        success: false,
        message: result.error,
        trialRestriction: result.trialRestriction,
      });
    }

    res.json({
      success: true,
      message: 'OTP sent successfully to your phone',
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /send-sms:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

/**
 * @route   POST /api/otp/verify-sms
 * @desc    Verify a phone OTP
 * @access  Public
 */
router.post('/verify-sms', async (req, res) => {
  try {
    const { phoneNumber, otp, type } = req.body;

    console.log(`🔍 [OTP ROUTES] Verify SMS OTP: ${phoneNumber} (${type})`);

    if (!phoneNumber || !otp || !type) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber, otp, and type are required',
      });
    }

    if (!/^\d{4,8}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP format. Must be 4-8 digits.',
      });
    }

    const validTypes = ['phone_verification', 'phone_test', 'phone_reverify'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP type for SMS.',
      });
    }

    const result = await otpService.verifyPhoneOTP(phoneNumber, otp, type);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
        attemptsLeft: result.attemptsLeft,
      });
    }

    res.json({
      success: true,
      message: 'Phone OTP verified successfully',
    });
  } catch (error) {
    console.error('❌ [OTP ROUTES] Error in /verify-sms:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

module.exports = router;