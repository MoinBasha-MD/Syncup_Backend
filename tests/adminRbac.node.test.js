const assert = require('node:assert/strict');
const test = require('node:test');

const { PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions, hasPermission } = require('../config/adminPermissions');

test('owner gets wildcard', () => {
  assert.deepEqual(effectivePermissions({ role: 'owner' }), ['*']);
  assert.equal(hasPermission({ role: 'owner' }, 'system.restart'), true);
});

test('super_admin gets everything except system.restart', () => {
  const perms = effectivePermissions({ role: 'super_admin' });
  assert.equal(perms.includes('system.restart'), false);
  assert.ok(perms.includes('users.ban'));
  assert.ok(perms.includes('admins.manage'));
  assert.equal(hasPermission({ role: 'super_admin' }, 'system.restart'), false);
});

test('admin role set', () => {
  const perms = effectivePermissions({ role: 'admin' });
  for (const p of ['users.read', 'users.write', 'users.suspend', 'users.ban', 'users.forceLogout',
    'users.export', 'content.read', 'content.moderate', 'reports.read', 'reports.resolve',
    'messages.meta', 'broadcasts.send', 'system.read', 'audit.read']) {
    assert.ok(perms.includes(p), `admin should have ${p}`);
  }
  assert.equal(perms.includes('users.delete'), false);
  assert.equal(perms.includes('admins.manage'), false);
  assert.equal(perms.includes('system.write'), false);
});

test('moderator role set', () => {
  const perms = effectivePermissions({ role: 'moderator' });
  assert.deepEqual(perms.sort(), ['users.read', 'users.suspend', 'content.read', 'content.moderate', 'reports.read', 'reports.resolve'].sort());
});

test('viewer role set', () => {
  const perms = effectivePermissions({ role: 'viewer' });
  assert.deepEqual(perms.sort(), ['users.read', 'content.read', 'reports.read', 'system.read'].sort());
});

test('grants union in; invalid grants dropped', () => {
  const perms = effectivePermissions({ role: 'viewer', grants: ['users.ban', 'bogus.perm'] });
  assert.ok(perms.includes('users.ban'));
  assert.equal(perms.includes('bogus.perm'), false);
});

// requirePermission middleware behaviour
const { requirePermission } = require('../middleware/adminV2Auth');

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const call = (mw, req) => {
  const res = responseMock();
  let called = false;
  mw(req, res, () => { called = true; });
  return { res, called };
};

test('moderator gets 403 on ban permission', () => {
  const req = { adminPermissions: effectivePermissions({ role: 'moderator' }) };
  const { res, called } = call(requirePermission('users.ban'), req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('owner wildcard passes every check', () => {
  const req = { adminPermissions: ['*'] };
  const { called } = call(requirePermission('system.restart', 'admins.manage'), req);
  assert.equal(called, true);
});

test('all declared role permissions are valid PERMISSIONS', () => {
  const valid = new Set(PERMISSIONS);
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of perms) {
      if (p === '*') continue;
      assert.ok(valid.has(p), `${role} has undeclared permission ${p}`);
    }
  }
});
