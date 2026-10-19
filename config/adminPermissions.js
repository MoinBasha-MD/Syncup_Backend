const PERMISSIONS = [
  'users.read',
  'users.write',
  'users.suspend',
  'users.ban',
  'users.delete',
  'users.forceLogout',
  'users.impersonate',
  'users.export',
  'content.read',
  'content.moderate',
  'reports.read',
  'reports.resolve',
  'messages.meta',
  'broadcasts.send',
  'system.read',
  'system.write',
  'system.restart',
  'admins.manage',
  'audit.read',
];

const PERMISSION_SET = new Set(PERMISSIONS);

const ADMIN_ALL = [
  'users.read', 'users.write', 'users.suspend', 'users.ban', 'users.forceLogout',
  'users.export', 'content.read', 'content.moderate', 'reports.read',
  'reports.resolve', 'messages.meta', 'broadcasts.send', 'system.read', 'audit.read',
];

const ROLE_PERMISSIONS = {
  owner: ['*'],
  super_admin: PERMISSIONS.filter(p => p !== 'system.restart'),
  admin: ADMIN_ALL,
  moderator: [
    'users.read', 'users.suspend',
    'content.read', 'content.moderate',
    'reports.read', 'reports.resolve',
  ],
  viewer: ['users.read', 'content.read', 'reports.read', 'system.read'],
};

/**
 * Role defaults ∪ explicit grants (unknown grant strings dropped).
 * '*' only exists for the owner role itself.
 */
const effectivePermissions = (admin) => {
  const base = ROLE_PERMISSIONS[admin?.role] || [];
  if (base.includes('*')) return ['*'];
  const grants = Array.isArray(admin?.grants) ? admin.grants : [];
  return [...new Set([...base, ...grants.filter(g => PERMISSION_SET.has(g))])];
};

const hasPermission = (admin, permission) => {
  const effective = effectivePermissions(admin);
  return effective.includes('*') || effective.includes(permission);
};

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions, hasPermission };
