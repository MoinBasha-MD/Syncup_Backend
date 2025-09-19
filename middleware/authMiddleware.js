const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const { UnauthorizedError } = require('../utils/errorClasses');

// Protect routes middleware
const protect = async (req, res, next) => {
  try {
    let token;

    console.log('🔐 [AUTH MIDDLEWARE] Checking authorization for:', req.method, req.path);
    console.log('🔐 [AUTH MIDDLEWARE] Headers:', {
      authorization: req.headers.authorization ? 'Bearer ***' : 'Missing',
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...'
    });

    // Check for token in Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      // Extract token from Bearer header
      token = req.headers.authorization.split(' ')[1];

      if (!token || token === 'null' || token === 'undefined') {
        console.log('❌ [AUTH MIDDLEWARE] No valid token provided');
        throw new UnauthorizedError('No token provided');
      }

      console.log('🔑 [AUTH MIDDLEWARE] Token found, length:', token.length);

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ [AUTH MIDDLEWARE] Token verified for user:', decoded.id);

      // Get user from the token (exclude password)
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        console.log('❌ [AUTH MIDDLEWARE] User not found for token:', decoded.id);
        throw new UnauthorizedError('User not found - token may be invalid');
      }

      console.log('👤 [AUTH MIDDLEWARE] User found:', {
        id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber
      });

      // Check if user account is active (if you have such field)
      if (user.isActive === false) {
        console.log('❌ [AUTH MIDDLEWARE] User account is deactivated:', user._id);
        throw new UnauthorizedError('Account is deactivated');
      }
      
      // Attach user to request object with explicit userId for compatibility
      req.user = {
        ...user.toObject(),
        id: user._id, // Set id to _id for controller compatibility
        userId: user.userId, // Ensure userId is explicitly available
        _id: user._id
      };
      
      console.log('✅ [AUTH MIDDLEWARE] User authenticated successfully');
      next();
    } else {
      console.log('❌ [AUTH MIDDLEWARE] No authorization header or invalid format');
      console.log('🔍 [AUTH MIDDLEWARE] Available headers:', Object.keys(req.headers));
      throw new UnauthorizedError('Not authorized, no token provided');
    }
  } catch (error) {
    console.error('❌ [AUTH MIDDLEWARE] Authentication error:', {
      name: error.name,
      message: error.message,
      path: req.path,
      method: req.method
    });

    // Handle JWT specific errors
    if (error.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('Invalid token'));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token expired'));
    }
    
    // Pass other errors to error handler
    next(error);
  }
};

// Optional: Admin role check middleware
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    next(new UnauthorizedError('Admin access required'));
  }
};

// Optional: Check if user owns resource or is admin
const checkOwnership = (req, res, next) => {
  const resourceUserId = req.params.userId || req.body.userId;
  
  if (req.user.userId === resourceUserId || req.user.role === 'admin') {
    next();
  } else {
    next(new UnauthorizedError('Access denied - insufficient permissions'));
  }
};

module.exports = { 
  protect,
  requireAdmin,
  checkOwnership
};
