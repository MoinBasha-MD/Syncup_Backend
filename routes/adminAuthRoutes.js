const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');
const { recordAdminAction } = require('../services/adminAudit');

const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

const signAdminToken = (admin) => jwt.sign(
  {
    id: admin._id,
    username: admin.username,
    role: admin.role,
    typ: 'admin',
    tv: admin.tokenVersion || 0
  },
  getAdminJwtSecret(),
  { expiresIn: JWT_EXPIRES_IN, audience: ADMIN_JWT_AUDIENCE }
);

const isElevatedRole = (role) => role === 'owner' || role === 'super_admin';

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUDIENCE });

    if (decoded.typ !== 'admin') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    const admin = await Admin.findById(decoded.id).select('-password');

    if (!admin) {
      return res.status(401).json({ message: 'Admin not found' });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    // Tokens issued before an admin force-logout are stale
    if ((decoded.tv || 0) < (admin.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Token has been revoked', code: 'TOKEN_REVOKED' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Check if setup is needed (no admins exist)
router.get('/setup/check', async (req, res) => {
  try {
    if (process.env.ADMIN_SETUP_ENABLED !== 'true') {
      return res.json({
        setupRequired: false,
        message: 'First-time setup is disabled'
      });
    }
    const hasAdmins = await Admin.hasAdmins();
    res.json({ 
      setupRequired: !hasAdmins,
      message: hasAdmins ? 'Admin account exists' : 'First-time setup required'
    });
  } catch (error) {
    console.error('Setup check error:', error);
    res.status(500).json({ message: 'Server error checking setup status' });
  }
});

// First-time setup - Create initial admin
// Gated behind ADMIN_SETUP_ENABLED — a public takeover path otherwise.
router.post('/setup', async (req, res) => {
  if (process.env.ADMIN_SETUP_ENABLED !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }
  try {
    const { username, password, email } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if any admin already exists
    const hasAdmins = await Admin.hasAdmins();
    if (hasAdmins) {
      return res.status(400).json({ message: 'Admin account already exists. Please login.' });
    }

    // Create first admin with super_admin role
    const admin = new Admin({
      username: username.toLowerCase().trim(),
      password,
      email: email?.toLowerCase().trim() || null,
      role: 'super_admin',
      permissions: {
        canManageUsers: true,
        canManagePosts: true,
        canManageBroadcasts: true,
        canManageHashtags: true,
        canManageAnalytics: true,
        canManageAdmins: true
      }
    });

    await admin.save();

    // Generate JWT token
    const token = signAdminToken(admin);

    console.log(`✅ First admin created: ${admin.username}`);

    res.status(201).json({
      message: 'Admin account created successfully',
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      }
    });
  } catch (error) {
    console.error('Setup error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    
    res.status(500).json({ message: 'Server error during setup' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Find admin by username
    const admin = await Admin.findOne({ username: username.toLowerCase().trim() });

    if (!admin) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Check if account is locked
    if (admin.isLocked()) {
      const lockTimeRemaining = Math.ceil((admin.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ 
        message: `Account is locked due to too many failed login attempts. Try again in ${lockTimeRemaining} minutes.`
      });
    }

    // Check if account is active
    if (!admin.isActive) {
      return res.status(403).json({ message: 'Account is deactivated. Contact super admin.' });
    }

    // Verify password
    const isMatch = await admin.comparePassword(password);

    if (!isMatch) {
      // Increment login attempts
      await admin.incLoginAttempts();
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Reset login attempts on successful login
    if (admin.loginAttempts > 0) {
      await admin.resetLoginAttempts();
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate JWT token
    const token = signAdminToken(admin);

    console.log(`✅ Admin logged in: ${admin.username}`);

    res.json({
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Verify token and get current admin
router.get('/verify', verifyToken, async (req, res) => {
  try {
    res.json({
      valid: true,
      admin: {
        id: req.admin._id,
        username: req.admin.username,
        email: req.admin.email,
        role: req.admin.role,
        permissions: req.admin.permissions,
        lastLogin: req.admin.lastLogin
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Server error during verification' });
  }
});

// Logout (client-side token removal, but we can track it)
router.post('/logout', verifyToken, async (req, res) => {
  try {
    console.log(`✅ Admin logged out: ${req.admin.username}`);
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Server error during logout' });
  }
});

// Change password (authenticated)
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const admin = await Admin.findById(req.admin._id);
    const isMatch = await admin.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    admin.password = newPassword;
    await admin.save();

    console.log(`✅ Password changed for admin: ${admin.username}`);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error changing password' });
  }
});

// Get all admins (owner / super_admin only)
router.get('/admins', verifyToken, async (req, res) => {
  try {
    if (!isElevatedRole(req.admin.role)) {
      return res.status(403).json({ message: 'Access denied. Super admin only.' });
    }

    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.json({ admins });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ message: 'Server error fetching admins' });
  }
});

// Create new admin (owner / super_admin only)
router.post('/admins', verifyToken, async (req, res) => {
  try {
    if (!isElevatedRole(req.admin.role)) {
      return res.status(403).json({ message: 'Access denied. Super admin only.' });
    }

    const { username, password, email, role, permissions } = req.body;

    if (role === 'owner') {
      return res.status(403).json({ message: 'The owner role cannot be assigned' });
    }

    if (role === 'super_admin' && req.admin.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can create super admin accounts' });
    }

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const admin = new Admin({
      username: username.toLowerCase().trim(),
      password,
      email: email?.toLowerCase().trim() || null,
      role: role || 'admin',
      permissions: permissions || {},
      createdBy: req.admin._id
    });

    await admin.save();

    console.log(`✅ New admin created: ${admin.username} by ${req.admin.username}`);

    recordAdminAction({
      adminId: req.admin._id,
      adminUsername: req.admin.username,
      adminRole: req.admin.role,
      ip: req.ip,
      action: 'admin.create',
      targetType: 'admin',
      targetId: admin._id,
      after: { username: admin.username, email: admin.email, role: admin.role },
      result: 'success'
    }).catch(error => console.error('❌ [AUDIT] Failed to record admin.create:', error.message));

    res.status(201).json({
      message: 'Admin created successfully',
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    
    res.status(500).json({ message: 'Server error creating admin' });
  }
});

module.exports = { router, verifyToken };
