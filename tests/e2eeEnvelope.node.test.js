const assert = require('node:assert/strict');
const test = require('node:test');
const { validateDmEnvelope } = require('../utils/e2eeEnvelope');

const alice = 'user-alice';
const bob = 'user-bob';

const validEnvelope = () => ({
  v: 2,
  alg: 'x25519-hkdf-sha256-aes256gcm+ed25519',
  sender: { userId: alice, deviceId: 'a'.repeat(32) },
  ctx: 'dm:user-alice:user-bob',
  msgId: 'AAAAAAAAAAAAAAAAAAAAAA==',
  ts: 1700000000000,
  iv: 'AAAAAAAAAAAAAAAA',
  ct: 'BBBBBBBB',
  keys: [{ userId: bob, deviceId: 'b'.repeat(32), spkId: 1, epk: 'CCCC', iv: 'DDDD', wk: 'EEEE' }],
  sig: 'FFFF',
});

test('valid envelope passes', () => {
  assert.equal(validateDmEnvelope({ v: 2, envelope: validEnvelope() }, alice, bob), null);
  // ctx is sorted — works regardless of sender/receiver argument order
  assert.equal(validateDmEnvelope({ v: 2, envelope: validEnvelope() }, alice, bob), null);
});

test('wrong outer or inner version rejected', () => {
  assert.equal(validateDmEnvelope({ v: 1, envelope: validEnvelope() }, alice, bob), 'INVALID_VERSION');
  const inner = validEnvelope();
  inner.v = 1;
  assert.equal(validateDmEnvelope({ v: 2, envelope: inner }, alice, bob), 'INVALID_VERSION');
});

test('wrong algorithm rejected', () => {
  const env = validEnvelope();
  env.alg = 'other';
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'INVALID_ALG');
});

test('sender claim must match authenticated user', () => {
  assert.equal(validateDmEnvelope({ v: 2, envelope: validEnvelope() }, 'mallory', bob), 'SENDER_MISMATCH');
});

test('ctx must bind to this DM pair', () => {
  const env = validEnvelope();
  env.ctx = 'dm:user-alice:user-carol';
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'CTX_MISMATCH');
  env.ctx = 'group:whatever';
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'CTX_MISMATCH');
});

test('keys must be non-empty, bounded, and limited to the two parties', () => {
  const env = validEnvelope();
  env.keys = [];
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'INVALID_KEYS');

  env.keys = Array.from({ length: 21 }, () => validEnvelope().keys[0]);
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'INVALID_KEYS');

  env.keys = [{ userId: 'mallory', deviceId: 'd'.repeat(32), spkId: 1, epk: 'x', iv: 'y', wk: 'z' }];
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'INVALID_KEYS');

  env.keys = validEnvelope().keys;
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), null);
});

test('required string fields must be present', () => {
  for (const field of ['msgId', 'iv', 'ct', 'sig']) {
    const env = validEnvelope();
    delete env[field];
    assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'MISSING_FIELD', field);
  }
});

test('oversized envelope rejected', () => {
  const env = validEnvelope();
  env.ct = 'A'.repeat(256 * 1024 + 1);
  assert.equal(validateDmEnvelope({ v: 2, envelope: env }, alice, bob), 'ENVELOPE_TOO_LARGE');
});

test('non-object envelope rejected', () => {
  assert.equal(validateDmEnvelope({ v: 2, envelope: 'nope' }, alice, bob), 'INVALID_ENVELOPE');
  assert.equal(validateDmEnvelope({ v: 2, envelope: [1] }, alice, bob), 'INVALID_ENVELOPE');
});
