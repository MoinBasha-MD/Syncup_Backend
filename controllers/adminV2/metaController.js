const { PERMISSIONS, ROLE_PERMISSIONS } = require('../../config/adminPermissions');
const { ok, handle } = require('../../utils/adminV2Response');
const pkg = require('../../package.json');

// Keep in sync with OWNER_ONLY_GRANTS in adminsController.
const OWNER_ONLY_GRANTS = ['system.restart', 'ops.control', 'ops.deploy', 'ops.power'];
const ROLES = ['super_admin', 'admin', 'moderator', 'viewer'];

/**
 * GET /meta — the permission catalog the admin UI needs to render grant
 * checkboxes without hardcoding the list. Authenticated admins only.
 */
const getMeta = handle(async (_req, res) =>
  ok(res, {
    permissions: PERMISSIONS,
    roles: ROLES,
    rolePermissions: ROLE_PERMISSIONS,
    ownerOnlyGrants: OWNER_ONLY_GRANTS,
    serverVersion: pkg.version,
  }),
);

module.exports = { getMeta, OWNER_ONLY_GRANTS };
