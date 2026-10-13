const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
const bcrypt = require('bcryptjs');
const otpService = require('../services/otpService');
const { generateToken } = require('../utils/generateToken');
const { normalizePhoneNumber, isValidPhoneNumber } = require('../utils/phoneUtils');
const LogSanitizer = require('../utils/logSanitizer');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRANT_REGEX = /^[a-f0-9]{64}$/i;
const VALID_GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// UTC date string (YYYY-MM-DD) `years` before today — for calendar-age checks.
const utcCutoffDate = (yearsAgo) => {
  const now = new Date();
  const year = now.getUTCFullYear() - yearsAgo;
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    console.log('🔵 [REGISTER] Registration request received');
    console.log('📥 [REGISTER] Request body:', LogSanitizer.sanitizeRequestBody(req.body));

    const body = req.body || {};
    const { registrationToken } = body;

    // Grant gate: a well-formed proof of email verification is required
    // before any database work. Missing/malformed -> 403 without a lookup.
    if (typeof registrationToken !== 'string' || !GRANT_REGEX.test(registrationToken)) {
      console.log('❌ [REGISTER] Missing or malformed registration grant');
      return res.status(403).json({
        success: false,
        message: 'Email verification is required before registering',
      });
    }

    const { name: rawName, phoneNumber: rawPhone, email: rawEmail, password, dateOfBirth, gender } = body;

    // Type-safe required field validation — a malformed body must be a 400,
    // never a 500 from a thrown property access.
    const requiredStrings = [rawName, rawPhone, rawEmail, password, dateOfBirth];
    if (
      requiredStrings.some((v) => typeof v !== 'string' || !v.trim()) ||
      (gender !== undefined && gender !== null && typeof gender !== 'string')
    ) {
      console.log('❌ [REGISTER] Missing or malformed required fields');
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, phoneNumber, email, password, dateOfBirth'
      });
    }

    const name = rawName.trim();
    const email = rawEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      console.log('❌ [REGISTER] Invalid email format');
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Password policy (checked on the exact value — no trimming).
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }
    if (password.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Password must be less than 20 characters long'
      });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter'
      });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one lowercase letter'
      });
    }
    if (!/\d/.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one number'
      });
    }

    // Phone number
    if (!isValidPhoneNumber(rawPhone)) {
      console.log('❌ [REGISTER] Invalid phone number format');
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number'
      });
    }
    const normalizedPhone = normalizePhoneNumber(rawPhone);

    // Date of birth: strict YYYY-MM-DD, calendar-valid, UTC date-only age.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid date of birth in YYYY-MM-DD format'
      });
    }
    const dobDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (isNaN(dobDate.getTime()) || dobDate.toISOString().slice(0, 10) !== dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid date of birth in YYYY-MM-DD format'
      });
    }
    const todayUTC = new Date().toISOString().slice(0, 10);
    if (dateOfBirth > todayUTC) {
      return res.status(400).json({
        success: false,
        message: 'Date of birth cannot be in the future'
      });
    }
    if (dateOfBirth > utcCutoffDate(16)) {
      return res.status(400).json({
        success: false,
        message: 'You must be at least 16 years old to register'
      });
    }
    if (dateOfBirth < utcCutoffDate(120)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid date of birth'
      });
    }

    // Gender (optional, normalized to the model enum).
    if (gender && !VALID_GENDERS.includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid gender option'
      });
    }

    // Duplicate checks — email is matched case-insensitively (older accounts
    // may have stored uppercase) with regex metacharacters escaped.
    const userExistsWithEmail = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegExp(email)}$`, 'i') },
    });
    if (userExistsWithEmail) {
      console.log('❌ [REGISTER] Email already exists:', LogSanitizer.maskEmail(email));
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const userExistsWithPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (userExistsWithPhone) {
      console.log('❌ [REGISTER] Phone number already exists:', LogSanitizer.maskPhoneNumber(normalizedPhone));
      return res.status(400).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    // Consume the single-use registration grant — after validation and
    // duplicate checks, before any user document is created.
    const grantConsumed = await otpService.consumeRegistrationToken(email, registrationToken);
    if (!grantConsumed) {
      console.log('❌ [REGISTER] Registration grant rejected');
      return res.status(403).json({
        success: false,
        message: 'Email verification is required before registering',
      });
    }

    const userData = {
      name,
      phoneNumber: normalizedPhone,
      email,
      password,
      dateOfBirth: dobDate,
      emailVerified: true,
      status: 'available',
      customStatus: '',
      statusUntil: null
    };

    if (gender) {
      userData.gender = gender.toLowerCase();
    }

    const user = await User.create(userData);
    console.log('✅ [REGISTER] User created successfully:', LogSanitizer.sanitizeUser(user));

    if (user) {
      // Create AI instance for the new user with timeout
      try {
        console.log(`🤖 [REGISTER] Creating AI instance for new user: ${LogSanitizer.maskName(user.name)} (${user._id})`);
        
        // ✅ FIX: Add timeout to prevent hanging
        const aiInstancePromise = AIInstance.create({
          userId: user._id.toString(),
          aiName: `${user.name}'s Maya`,
          status: 'offline', // Start as offline, will come online when user opens Maya
          capabilities: {
            canSchedule: true,
            canAccessCalendar: true,
            canMakeReservations: false,
            canShareLocation: false,
            maxConcurrentConversations: 5
          },
          preferences: {
            responseStyle: 'friendly',
            privacyLevel: 'moderate',
            autoApprovalSettings: {
              lowPriorityRequests: false,
              trustedAIsOnly: true,
              maxAutoApprovalDuration: 30
            },
            responseTimePreference: 'normal'
          },
          networkSettings: {
            allowDirectMentions: true,
            allowGroupMentions: true,
            trustedAIs: [],
            blockedAIs: [],
            allowedGroups: []
          },
          stats: {
            totalConversations: 0,
            successfulInteractions: 0,
            averageResponseTime: 0,
            lastCalculated: new Date()
          },
          version: '1.0.0',
          isActive: true
        });

        // ✅ FIX: Add 5-second timeout to prevent hanging — cleared when the
        // race finishes so no pending timer handle leaks.
        let aiTimeout;
        const timeoutPromise = new Promise((_, reject) =>
          { aiTimeout = setTimeout(() => reject(new Error('AI instance creation timeout')), 5000); }
        );

        const aiInstance = await Promise.race([aiInstancePromise, timeoutPromise])
          .finally(() => clearTimeout(aiTimeout));
        console.log(`✅ AI instance created successfully: ${aiInstance.aiId} for user ${LogSanitizer.maskName(user.name)}`);
        
      } catch (aiError) {
        console.error(`❌ Failed to create AI instance for user ${LogSanitizer.maskName(user.name)}:`, aiError.message);
        console.log('⚠️ [REGISTER] Continuing registration without AI instance');
        // Don't fail the registration if AI creation fails, just log it
        // The user can still use the app, and AI instance can be created later
      }

      // Generate token
      console.log('🔑 [REGISTER] Generating authentication token...');
      const token = generateToken(user._id, user.userId);
      console.log('✅ [REGISTER] Token generated successfully');
      
      const responseData = {
        success: true,
        data: {
          userId: user.userId,
          name: user.name,
          phoneNumber: user.phoneNumber,
          email: user.email,
          status: user.status,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          token
        }
      };
      
      console.log('✅ [REGISTER] Registration completed successfully, sending response');
      res.status(201).json(responseData);
    } else {
      console.log('❌ [REGISTER] User creation failed - no user object returned');
      res.status(400).json({ 
        success: false,
        message: 'Invalid user data' 
      });
    }
  } catch (error) {
    console.error('❌ [REGISTER] Registration error:', error);
    console.error('❌ [REGISTER] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

/**
 * @desc    Login user and get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res) => {
  console.log('🔐 [AUTH CONTROLLER] ========== LOGIN REQUEST RECEIVED ==========');
  console.log('📥 [AUTH CONTROLLER] Request body:', LogSanitizer.sanitizeRequestBody(req.body));
  console.log('📍 [AUTH CONTROLLER] Request IP:', req.ip);
  
  try {
    const { phoneNumber, password } = req.body || {};

    console.log('📞 [AUTH CONTROLLER] Phone number:', LogSanitizer.maskPhoneNumber(phoneNumber));

    // Validate required fields — non-string or empty values must be a 400,
    // never reach bcrypt/normalization where they'd throw into a 500.
    if (
      typeof phoneNumber !== 'string' || !phoneNumber.trim() ||
      typeof password !== 'string' || password.length === 0
    ) {
      console.error('❌ [AUTH CONTROLLER] Missing or malformed credentials');
      return res.status(400).json({
        success: false,
        message: 'Please provide both phoneNumber and password'
      });
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      console.error('❌ [AUTH CONTROLLER] Invalid phone number format');
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Normalize phone number for login lookup using utility function
    console.log('🔄 [AUTH CONTROLLER] Normalizing phone number...');
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log('📞 [AUTH CONTROLLER] Normalized phone:', LogSanitizer.maskPhoneNumber(normalizedPhone));

    // Check for user with normalized phone number
    console.log('🔍 [AUTH CONTROLLER] Looking up user in database...');
    const user = await User.findOne({ phoneNumber: normalizedPhone }).select('+password');
    console.log('👤 [AUTH CONTROLLER] User found:', !!user);

    if (!user) {
      console.error('❌ [AUTH CONTROLLER] User not found');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid phone number or password' 
      });
    }

    console.log('✅ [AUTH CONTROLLER] User found, checking password...');
    console.log('👤 [AUTH CONTROLLER] User details:', {
      userId: LogSanitizer.maskUserId(user.userId),
      name: LogSanitizer.maskName(user.name),
      phoneNumber: LogSanitizer.maskPhoneNumber(user.phoneNumber),
      hasPassword: !!user.password,
    });
    
    // Check if password matches
    console.log('🔐 [AUTH CONTROLLER] Calling matchPassword...');

    const isMatch = await bcrypt.compare(password, user.password);
    console.log('🔐 [AUTH CONTROLLER] Password match result:', isMatch);

    if (!isMatch) {
      console.error('❌ [AUTH CONTROLLER] Password does not match');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid phone number or password' 
      });
    }

    console.log('✅ [AUTH CONTROLLER] Password matches!');

    // Check if status timer has expired
    console.log('🔄 [AUTH CONTROLLER] Checking status timer...');
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      console.log('⏰ [AUTH CONTROLLER] Status timer expired, resetting...');
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
      console.log('✅ [AUTH CONTROLLER] Status reset complete');
    }

    // Generate token
    console.log('🎫 [AUTH CONTROLLER] Generating token...');
    const token = generateToken(user._id, user.userId);
    console.log('✅ [AUTH CONTROLLER] Token generated');

    console.log('📤 [AUTH CONTROLLER] Sending success response...');
    const responseData = {
      success: true,
      data: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        token
      }
    };

    res.json(responseData);
    console.log('✅ [AUTH CONTROLLER] Response sent successfully');
  } catch (error) {
    console.error('❌ [AUTH CONTROLLER] Login error:', error);
    console.error('❌ [AUTH CONTROLLER] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

/**
 * @desc    Check if user exists by phone number
 * @route   POST /api/auth/check
 * @access  Public
 */
const checkUserExists = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide a phone number' 
      });
    }

    const user = await User.findOne({ phoneNumber }).select('userId name');

    res.json({
      success: true,
      exists: !!user,
      data: user ? {
        userId: user.userId,
        name: user.name
      } : null
    });
  } catch (error) {
    console.error('Check user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking user'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  checkUserExists
};
