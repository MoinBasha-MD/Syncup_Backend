const Admin = require('../models/adminModel');

/**
 * List all admins
 */
const listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().sort({ createdAt: -1 }).lean();
    
    res.render('admin/admin-users/list', {
      title: 'Admin Users',
      layout: 'admin/layouts/main',
      admins
    });
  } catch (error) {
    console.error('List admins error:', error);
    res.status(500).send('Error loading admins');
  }
};

/**
 * Show create admin form
 */
const showCreateAdminForm = (req, res) => {
  res.render('admin/admin-users/create', {
    title: 'Create Admin',
    layout: 'admin/layouts/main'
  });
};

/**
 * Create new admin
 */
const createAdmin = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    // Check if email exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    
    const admin = new Admin({
      username,
      email,
      password, // Will be hashed by pre-save hook
      role: role || 'moderator',
      isActive: true
    });
    
    await admin.save();
    
    res.json({ success: true, message: 'Admin created successfully' });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, message: 'Error creating admin' });
  }
};

/**
 * Show edit admin form
 */
const showEditAdminForm = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).lean();
    
    if (!admin) {
      return res.status(404).send('Admin not found');
    }
    
    res.render('admin/admin-users/edit', {
      title: 'Edit Admin',
      layout: 'admin/layouts/main',
      admin
    });
  } catch (error) {
    console.error('Edit admin form error:', error);
    res.status(500).send('Error loading form');
  }
};

/**
 * Update admin
 */
const updateAdmin = async (req, res) => {
  try {
    const { username, email, role, isActive } = req.body;
    
    const admin = await Admin.findById(req.params.id);
    
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    admin.username = username || admin.username;
    admin.email = email || admin.email;
    admin.role = role || admin.role;
    admin.isActive = isActive !== undefined ? isActive : admin.isActive;
    
    await admin.save();
    
    res.json({ success: true, message: 'Admin updated successfully' });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({ success: false, message: 'Error updating admin' });
  }
};

/**
 * Delete admin
 */
const deleteAdmin = async (req, res) => {
  try {
    // Prevent deleting yourself
    if (req.params.id === req.session.adminUser.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }
    
    await Admin.findByIdAndDelete(req.params.id);
    
    res.json({ success: true, message: 'Admin deleted successfully' });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ success: false, message: 'Error deleting admin' });
  }
};

module.exports = {
  listAdmins,
  showCreateAdminForm,
  createAdmin,
  showEditAdminForm,
  updateAdmin,
  deleteAdmin
};
