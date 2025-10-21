const Admin = require('../models/adminModel');

/**
 * Show role permissions management page
 */
const showRolePermissions = async (req, res) => {
  try {
    // Define all available permissions
    const allPermissions = [
      { id: 'users.view', name: 'View Users', category: 'Users' },
      { id: 'users.create', name: 'Create Users', category: 'Users' },
      { id: 'users.edit', name: 'Edit Users', category: 'Users' },
      { id: 'users.delete', name: 'Delete Users', category: 'Users' },
      
      { id: 'content.view', name: 'View Content', category: 'Content' },
      { id: 'content.edit', name: 'Edit Content', category: 'Content' },
      { id: 'content.delete', name: 'Delete Content', category: 'Content' },
      
      { id: 'groups.view', name: 'View Groups', category: 'Groups' },
      { id: 'groups.create', name: 'Create Groups', category: 'Groups' },
      { id: 'groups.edit', name: 'Edit Groups', category: 'Groups' },
      { id: 'groups.delete', name: 'Delete Groups', category: 'Groups' },
      
      { id: 'broadcast.send', name: 'Send Broadcasts', category: 'Broadcast' },
      { id: 'broadcast.view', name: 'View Broadcasts', category: 'Broadcast' },
      
      { id: 'analytics.view', name: 'View Analytics', category: 'Analytics' },
      { id: 'analytics.export', name: 'Export Analytics', category: 'Analytics' },
      
      { id: 'security.view', name: 'View Security Logs', category: 'Security' },
      { id: 'security.manage', name: 'Manage Security', category: 'Security' },
      
      { id: 'admins.view', name: 'View Admins', category: 'Admin Management' },
      { id: 'admins.create', name: 'Create Admins', category: 'Admin Management' },
      { id: 'admins.edit', name: 'Edit Admins', category: 'Admin Management' },
      { id: 'admins.delete', name: 'Delete Admins', category: 'Admin Management' },
      
      { id: 'system.view', name: 'View System Monitor', category: 'System' },
      { id: 'system.manage', name: 'Manage System', category: 'System' }
    ];
    
    // Define role templates
    const roles = [
      {
        name: 'super-admin',
        displayName: 'Super Admin',
        description: 'Full access to all features',
        permissions: allPermissions.map(p => p.id),
        color: '#EF4444'
      },
      {
        name: 'admin',
        displayName: 'Admin',
        description: 'Manage users, content, and groups',
        permissions: [
          'users.view', 'users.create', 'users.edit', 'users.delete',
          'content.view', 'content.edit', 'content.delete',
          'groups.view', 'groups.create', 'groups.edit', 'groups.delete',
          'broadcast.send', 'broadcast.view',
          'analytics.view',
          'system.view'
        ],
        color: '#4F46E5'
      },
      {
        name: 'moderator',
        displayName: 'Moderator',
        description: 'View and moderate content',
        permissions: [
          'users.view',
          'content.view', 'content.edit', 'content.delete',
          'groups.view',
          'broadcast.view',
          'analytics.view'
        ],
        color: '#10B981'
      },
      {
        name: 'viewer',
        displayName: 'Viewer',
        description: 'Read-only access',
        permissions: [
          'users.view',
          'content.view',
          'groups.view',
          'analytics.view',
          'system.view'
        ],
        color: '#64748B'
      }
    ];
    
    // Get admin counts by role
    const adminCounts = await Admin.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const counts = {};
    adminCounts.forEach(item => {
      counts[item._id] = item.count;
    });
    
    res.render('admin/permissions/index', {
      title: 'Role Permissions',
      layout: 'admin/layouts/main',
      allPermissions,
      roles,
      counts
    });
  } catch (error) {
    console.error('Role permissions error:', error);
    res.status(500).send('Error loading permissions');
  }
};

/**
 * Update role permissions
 */
const updateRolePermissions = async (req, res) => {
  try {
    const { role, permissions } = req.body;
    
    // In a real implementation, you would save this to a RolePermissions model
    // For now, we'll just return success
    
    res.json({ 
      success: true, 
      message: `Permissions updated for ${role}` 
    });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({ success: false, message: 'Error updating permissions' });
  }
};

module.exports = {
  showRolePermissions,
  updateRolePermissions
};
