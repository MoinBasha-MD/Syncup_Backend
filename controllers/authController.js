const User = require('../models/userModel');
const { generateToken } = require('../utils/generateToken');
const { normalizePhoneNumber, isValidPhoneNumber } = require('../utils/phoneUtils');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    const { name, phoneNumber, email, password, dateOfBirth, gender } = req.body;

    // Validate required fields
    if (!name || !phoneNumber || !email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields: name, phoneNumber, email, password' 
      });
    }

    // Enhanced password validation
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

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one uppercase letter' 
      });
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one lowercase letter' 
      });
    }

    // Check for number
    if (!/\d/.test(password)) {
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one number' 
      });
    }

    // Check for special character
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return res.status(400).json({ 
        success: false,
        message: 'Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)' 
      });
    }

    // Normalize phone number using utility function
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ 
        success: false,
        message: 'Please enter a valid phone number' 
      });
    }

    // Enhanced date of birth validation
    if (dateOfBirth) {
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
        return res.status(400).json({ 
          success: false,
          message: 'Please enter a valid date of birth' 
        });
      }
    }

    if (gender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender)) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide a valid gender option' 
      });
    }

    // Check if user already exists with this email or normalized phone
    const userExistsWithEmail = await User.findOne({ email });
    if (userExistsWithEmail) {
      return res.status(400).json({ 
        success: false,
        message: 'User with this email already exists' 
      });
    }

    const userExistsWithPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (userExistsWithPhone) {
      return res.status(400).json({ 
        success: false,
        message: 'User with this phone number already exists' 
      });
    }

    // Create user with normalized phone number
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
      userData.gender = gender;
    }

    const user = await User.create(userData);

    if (user) {
      // Generate token
      const token = generateToken(user._id, user.userId);
      
      res.status(201).json({
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
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: 'Invalid user data' 
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
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
  try {
    const { phoneNumber, password } = req.body;

    // Validate required fields
    if (!phoneNumber || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide both phoneNumber and password' 
      });
    }

    // Normalize phone number for login lookup using utility function
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    // Check for user with normalized phone number
    const user = await User.findOne({ phoneNumber: normalizedPhone }).select('+password');

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid phone number or password' 
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid phone number or password' 
      });
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    // Generate token
    const token = generateToken(user._id, user.userId);

    res.json({
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
    });
  } catch (error) {
    console.error('Login error:', error);
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
