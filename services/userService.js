const User = require('../models/userModel');

/**
 * User service - handles business logic for user operations
 */
class UserService {
  /**
   * Register a new user
   * @param {Object} userData - User data (name, phoneNumber, email, password)
   * @returns {Promise<Object>} - Newly created user
   */
  async registerUser(userData) {
    const { name, phoneNumber, email, password } = userData;

    // Check if user already exists with this email or phone
    const userExistsWithEmail = await User.findOne({ email });
    if (userExistsWithEmail) {
      const error = new Error('User with this email already exists');
      error.statusCode = 400;
      throw error;
    }

    const userExistsWithPhone = await User.findOne({ phoneNumber });
    if (userExistsWithPhone) {
      const error = new Error('User with this phone number already exists');
      error.statusCode = 400;
      throw error;
    }

    // Create user
    const user = await User.create({
      name,
      phoneNumber,
      email,
      password,
      status: 'available',
      customStatus: '',
      statusUntil: null
    });

    return user;
  }

  /**
   * Authenticate user
   * @param {string} phoneNumber - User's phone number
   * @param {string} password - User's password
   * @returns {Promise<Object>} - Authenticated user
   */
  async loginUser(phoneNumber, password) {
    // Check for user with phone number
    const user = await User.findOne({ phoneNumber }).select('+password');

    if (!user) {
      const error = new Error('Invalid phone number or password');
      error.statusCode = 401;
      throw error;
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      const error = new Error('Invalid phone number or password');
      error.statusCode = 401;
      throw error;
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    return user;
  }

  /**
   * Get user profile
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - User profile
   */
  async getUserProfile(userId) {
    const user = await User.findById(userId);

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    return user;
  }

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} userData - User data to update
   * @returns {Promise<Object>} - Updated user
   */
  async updateUserProfile(userId, userData) {
    const user = await User.findById(userId);

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    user.name = userData.name || user.name;
    user.email = userData.email || user.email;
    
    // Only update phone number if provided and different
    if (userData.phoneNumber && userData.phoneNumber !== user.phoneNumber) {
      // Check if phone number is already in use
      const phoneExists = await User.findOne({ phoneNumber: userData.phoneNumber });
      if (phoneExists) {
        const error = new Error('Phone number already in use');
        error.statusCode = 400;
        throw error;
      }
      user.phoneNumber = userData.phoneNumber;
    }

    // Update password if provided
    if (userData.password) {
      user.password = userData.password;
    }

    const updatedUser = await user.save();
    return updatedUser;
  }

  /**
   * Update user status
   * @param {string} userId - User ID
   * @param {Object} statusData - Status data to update
   * @returns {Promise<Object>} - Updated user
   */
  async updateUserStatus(userId, statusData) {
    const user = await User.findById(userId);

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const { status, customStatus, duration } = statusData;
    
    // Check if status is provided
    if (!status) {
      const error = new Error('Status is required');
      error.statusCode = 400;
      throw error;
    }
    
    // Update status fields - accept any status value
    user.status = status;
    
    // Update custom status if provided
    if (customStatus) {
      user.customStatus = customStatus;
    } else {
      user.customStatus = '';
    }
    
    // Set status expiration if duration provided (in minutes)
    if (duration && duration > 0) {
      const expirationTime = new Date();
      expirationTime.setMinutes(expirationTime.getMinutes() + duration);
      user.statusUntil = expirationTime;
    } else {
      user.statusUntil = null; // No expiration
    }
    
    const updatedUser = await user.save();
    return updatedUser;
  }
}

module.exports = new UserService();
