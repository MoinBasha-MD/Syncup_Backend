const assert = require('node:assert/strict');
const test = require('node:test');

const { getAccountBlock, isTokenStale } = require('../utils/accountState');

const NOW = new Date('2026-01-01T00:00:00Z');
const HOUR = 60 * 60 * 1000;

test('active and missing accountStatus are not blocked', () => {
  assert.equal(getAccountBlock({}), null);
  assert.equal(getAccountBlock({ accountStatus: { state: 'active' } }), null);
  assert.equal(getAccountBlock(null), null);
});

test('banned users are blocked with ACCOUNT_BANNED', () => {
  const block = getAccountBlock(
    { accountStatus: { state: 'banned', reason: 'spam' } },
    NOW
  );
  assert.equal(block.code, 'ACCOUNT_BANNED');
  assert.equal(block.reason, 'spam');
});

test('deleted state or deletedAt blocks with ACCOUNT_DELETED', () => {
  const byState = getAccountBlock(
    { accountStatus: { state: 'deleted' } },
    NOW
  );
  assert.equal(byState.code, 'ACCOUNT_DELETED');

  const byTimestamp = getAccountBlock(
    { accountStatus: { state: 'active' }, deletedAt: new Date() },
    NOW
  );
  assert.equal(byTimestamp.code, 'ACCOUNT_DELETED');
});

test('suspension blocks while `until` is in the future or absent', () => {
  const future = getAccountBlock(
    { accountStatus: { state: 'suspended', until: new Date(NOW.getTime() + HOUR) } },
    NOW
  );
  assert.equal(future.code, 'ACCOUNT_SUSPENDED');
  assert.ok(future.until instanceof Date);

  const indefinite = getAccountBlock(
    { accountStatus: { state: 'suspended' } },
    NOW
  );
  assert.equal(indefinite.code, 'ACCOUNT_SUSPENDED');
});

test('an expired suspension does not block', () => {
  const expired = getAccountBlock(
    { accountStatus: { state: 'suspended', until: new Date(NOW.getTime() - HOUR) } },
    NOW
  );
  assert.equal(expired, null);
});

test('isTokenStale compares tv against tokenVersion', () => {
  const user = { tokenVersion: 2 };
  assert.equal(isTokenStale({ tv: 2 }, user), false);
  assert.equal(isTokenStale({ tv: 3 }, user), false);
  assert.equal(isTokenStale({ tv: 1 }, user), true);
  // Legacy tokens without tv count as 0
  assert.equal(isTokenStale({}, user), true);
  assert.equal(isTokenStale({}, { tokenVersion: 0 }), false);
  assert.equal(isTokenStale({}, {}), false);
});
