/**
 * Admin Authentication Middleware
 * Protects admin routes and checks permissions
 */

// Check if user is authenticated as admin
const isAdminAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminUser) {
    return next();
  }
  
  // If AJAX request, return JSON
  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized. Please login.' 
    });
  }
  
  // Otherwise redirect to login
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
};

// Check if admin is already logged in (for login page)
const isAdminLoggedIn = (req, res, next) => {
  if (req.session && req.session.adminUser) {
    return res.redirect('/admin/dashboard');
  }
  next();
};

// Check admin role/permissions
const checkAdminRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.adminUser) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }
    
    const adminRole = req.session.adminUser.role;
    
    if (allowedRoles.includes(adminRole)) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false, 
      message: 'Forbidden. Insufficient permissions.' 
    });
  };
};

// Check specific permission
const checkPermission = (resource, action) => {
  return (req, res, next) => {
    if (!req.session || !req.session.adminUser) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }
    
    const permissions = req.session.adminUser.permissions;
    
    if (permissions[resource] && permissions[resource][action]) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false, 
      message: `Forbidden. You don't have permission to ${action} ${resource}.` 
    });
  };
};

// Attach admin user to res.locals for views
const attachAdminUser = async (req, res, next) => {
  if (req.session && req.session.adminUser) {
    res.locals.adminUser = req.session.adminUser;
  } else {
    res.locals.adminUser = null;
  }
  
  // Attach basic stats for sidebar
  try {
    const User = require('../models/userModel');
    const totalUsers = await User.countDocuments();
    res.locals.stats = { totalUsers };
  } catch (error) {
    res.locals.stats = { totalUsers: 0 };
  }
  
  next();
};

module.exports = {
  isAdminAuthenticated,
  isAdminLoggedIn,
  checkAdminRole,
  checkPermission,
  attachAdminUser
};
