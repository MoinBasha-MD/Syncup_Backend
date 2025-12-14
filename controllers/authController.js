const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
const { generateToken } = require('../utils/generateToken');
const { normalizePhoneNumber, isValidPhoneNumber } = require('../utils/phoneUtils');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    console.log('🔵 [REGISTER] Registration request received');
    console.log('📥 [REGISTER] Request body:', {
      name: req.body.name,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber,
      dateOfBirth: req.body.dateOfBirth,
      gender: req.body.gender,
      passwordProvided: !!req.body.password,
      passwordLength: req.body.password?.length
    });
    
    const { name, phoneNumber, email, password, dateOfBirth, gender } = req.body;

    // Validate required fields
    if (!name || !phoneNumber || !email || !password) {
      console.log('❌ [REGISTER] Missing required fields');
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields: name, phoneNumber, email, password' 
      });
    }

    // Enhanced password validation
    console.log('🔍 [REGISTER] Validating password...');
    if (password.length < 8) {
      console.log('❌ [REGISTER] Password too short');
      return res.status(400).json({ 
        success: false,
        message: 'Password must be at least 8 characters long' 
      });
    }

    if (password.length > 20) {
      console.log('❌ [REGISTER] Password too long');
      return res.status(400).json({ 
        success: false,
        message: 'Password must be less than 20 characters long' 
      });
    }

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
      console.log('❌ [REGISTER] Password missing uppercase letter');
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one uppercase letter' 
      });
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
      console.log('❌ [REGISTER] Password missing lowercase letter');
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one lowercase letter' 
      });
    }

    // Check for number
    if (!/\d/.test(password)) {
      console.log('❌ [REGISTER] Password missing number');
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one number' 
      });
    }
    console.log('✅ [REGISTER] Password validation passed');

    // Special character is now optional but recommended
    // Removed strict requirement to make registration easier

    // Normalize phone number using utility function
    console.log('🔍 [REGISTER] Validating phone number...');
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log('📞 [REGISTER] Normalized phone:', normalizedPhone);
    
    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      console.log('❌ [REGISTER] Invalid phone number format');
      return res.status(400).json({ 
        success: false,
        message: 'Please enter a valid phone number' 
      });
    }
    console.log('✅ [REGISTER] Phone number validation passed');

    // Enhanced date of birth validation
    if (dateOfBirth) {
      console.log('🔍 [REGISTER] Validating date of birth...');
      const dobDate = new Date(dateOfBirth);
      if (isNaN(dobDate.getTime())) {
        return res.status(400).json({ 
          success: false,
          message: 'Please provide a valid date of birth in YYYY-MM-DD format' 
        });
      }

      // Check if date is not in the future
      const today = new Date();
      if (dobDate > today) {
        return res.status(400).json({ 
          success: false,
          message: 'Date of birth cannot be in the future' 
        });
      }

      // Check if person is at least 13 years old
      const thirteenYearsAgo = new Date();
      thirteenYearsAgo.setFullYear(thirteenYearsAgo.getFullYear() - 13);
      if (dobDate > thirteenYearsAgo) {
        return res.status(400).json({ 
          success: false,
          message: 'You must be at least 13 years old to register' 
        });
      }

      // Check if date is reasonable (not more than 120 years ago)
      const oneHundredTwentyYearsAgo = new Date();
      oneHundredTwentyYearsAgo.setFullYear(oneHundredTwentyYearsAgo.getFullYear() - 120);
      if (dobDate < oneHundredTwentyYearsAgo) {
        console.log('❌ [REGISTER] Date of birth too old');
        return res.status(400).json({ 
          success: false,
          message: 'Please enter a valid date of birth' 
        });
      }
      console.log('✅ [REGISTER] Date of birth validation passed');
    }

    // ✅ FIX: Gender validation - case-insensitive
    console.log('🔍 [REGISTER] Validating gender...');
    if (gender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender.toLowerCase())) {
      console.log('❌ [REGISTER] Invalid gender:', gender);
      return res.status(400).json({ 
        success: false,
        message: 'Please provide a valid gender option' 
      });
    }
    console.log('✅ [REGISTER] Gender validation passed');

    // Check if user already exists with this email or normalized phone
    console.log('🔍 [REGISTER] Checking for existing users...');
    const userExistsWithEmail = await User.findOne({ email });
    if (userExistsWithEmail) {
      console.log('❌ [REGISTER] Email already exists:', email);
      return res.status(400).json({ 
        success: false,
        message: 'User with this email already exists' 
      });
    }

    const userExistsWithPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (userExistsWithPhone) {
      console.log('❌ [REGISTER] Phone number already exists:', normalizedPhone);
      return res.status(400).json({ 
        success: false,
        message: 'User with this phone number already exists' 
      });
    }
    console.log('✅ [REGISTER] No existing user found, proceeding with registration');

    // Create user with normalized phone number
    console.log('📝 [REGISTER] Creating user document...');
    const userData = {
      name,
      phoneNumber: normalizedPhone,
      email,
      password,
      status: 'available',
      customStatus: '',
      statusUntil: null
    };

    // Add optional fields if provided
    if (dateOfBirth) {
      userData.dateOfBirth = new Date(dateOfBirth);
    }
    if (gender) {
      // ✅ FIX: Convert gender to lowercase to match Mongoose enum
      userData.gender = gender.toLowerCase();
      console.log('📝 [REGISTER] Gender normalized to:', userData.gender);
    }

    const user = await User.create(userData);
    console.log('✅ [REGISTER] User created successfully:', {
      userId: user.userId,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber
    });

    if (user) {
      // Create AI instance for the new user with timeout
      try {
        console.log(`🤖 [REGISTER] Creating AI instance for new user: ${user.name} (${user._id})`);
        
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

        // ✅ FIX: Add 5-second timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI instance creation timeout')), 5000)
        );

        const aiInstance = await Promise.race([aiInstancePromise, timeoutPromise]);
        console.log(`✅ AI instance created successfully: ${aiInstance.aiId} for user ${user.name}`);
        
      } catch (aiError) {
        console.error(`❌ Failed to create AI instance for user ${user.name}:`, aiError.message);
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
      message: 'Server error during registration', 
      error: error.message 
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
  console.log('📥 [AUTH CONTROLLER] Request body:', JSON.stringify(req.body, null, 2));
  console.log('📍 [AUTH CONTROLLER] Request IP:', req.ip);
  console.log('🌐 [AUTH CONTROLLER] Request headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    const { phoneNumber, password } = req.body;
    
    console.log('📞 [AUTH CONTROLLER] Phone number:', phoneNumber);
    console.log('🔑 [AUTH CONTROLLER] Password length:', password?.length);

    // Validate required fields
    if (!phoneNumber || !password) {
      console.error('❌ [AUTH CONTROLLER] Missing required fields');
      return res.status(400).json({ 
        success: false,
        message: 'Please provide both phoneNumber and password' 
      });
    }

    // Normalize phone number for login lookup using utility function
    console.log('🔄 [AUTH CONTROLLER] Normalizing phone number...');
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log('📞 [AUTH CONTROLLER] Normalized phone:', normalizedPhone);

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
      userId: user.userId,
      name: user.name,
      phoneNumber: user.phoneNumber,
      hasPassword: !!user.password,
      passwordHashLength: user.password?.length,
      passwordHashPrefix: user.password?.substring(0, 10)
    });
    
    // Check if password matches
    console.log('🔐 [AUTH CONTROLLER] Calling matchPassword...');
    console.log('🔐 [AUTH CONTROLLER] Entered password:', password);
    console.log('🔐 [AUTH CONTROLLER] Stored hash:', user.password);
    
    const bcrypt = require('bcryptjs');
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
    console.log('📦 [AUTH CONTROLLER] Response data:', JSON.stringify(responseData, null, 2));
    
    res.json(responseData);
    console.log('✅ [AUTH CONTROLLER] Response sent successfully');
  } catch (error) {
    console.error('❌ [AUTH CONTROLLER] Login error:', error);
    console.error('❌ [AUTH CONTROLLER] Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Server error during login', 
      error: error.message 
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
      message: 'Server error while checking user', 
      error: error.message 
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  checkUserExists
};
