const test = require('node:test');
const assert = require('node:assert');

const { computeFriendIds } = require('../services/openNetworkVisibility');
const { toPushData } = require('../services/openNetworkNotify');

/* ------------------------------ computeFriendIds ------------------------------ */

test('computeFriendIds: one-sided app friend counts', () => {
  // I hold an accepted non-device-contact row for them.
  const friends = computeFriendIds(
    [{ friendUserId: 'u2', isDeviceContact: false }],
    [],
  );
  assert.ok(friends.has('u2'));

  // …or they hold one for me.
  const reverse = computeFriendIds(
    [],
    [{ userId: 'u2', isDeviceContact: false }],
  );
  assert.ok(reverse.has('u2'));
});

test('computeFriendIds: one-sided device contact does NOT count', () => {
  const mine = computeFriendIds(
    [{ friendUserId: 'u2', isDeviceContact: true }],
    [],
  );
  assert.ok(!mine.has('u2'));

  const theirs = computeFriendIds(
    [],
    [{ userId: 'u2', isDeviceContact: true }],
  );
  assert.ok(!theirs.has('u2'));
});

test('computeFriendIds: mutual device contacts count', () => {
  const friends = computeFriendIds(
    [{ friendUserId: 'u2', isDeviceContact: true }],
    [{ userId: 'u2', isDeviceContact: true }],
  );
  assert.ok(friends.has('u2'));
});

test('computeFriendIds: no rows → not friends', () => {
  assert.equal(computeFriendIds([], []).size, 0);
  // A row for someone unrelated must not leak in.
  const friends = computeFriendIds(
    [{ friendUserId: 'u3', isDeviceContact: false }],
    [],
  );
  assert.ok(!friends.has('u2'));
});

/* --------------------------------- toPushData -------------------------------- */

test('toPushData drops null/undefined values', () => {
  const out = toPushData({ a: null, b: undefined, c: 'x' });
  assert.deepEqual(out, { c: 'x' });
});

test('toPushData JSON-stringifies objects and arrays', () => {
  const out = toPushData({ connection: { id: 'c1' }, tags: ['a', 'b'] });
  assert.equal(out.connection, '{"id":"c1"}');
  assert.equal(out.tags, '["a","b"]');
});

test('toPushData stringifies numbers and booleans', () => {
  const out = toPushData({ n: 42, flag: true });
  assert.equal(out.n, '42');
  assert.equal(out.flag, 'true');
});
