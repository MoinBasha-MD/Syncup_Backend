const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('crypto');

const { verifyDeviceSignature, encrypt, decrypt, sha256hex } = require('../utils/adminCrypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

test('verifyDeviceSignature accepts a valid RSA-SHA256 signature', () => {
  const payload = 'syncup-admin-login:nonce123:device-1';
  const signature = crypto.sign('RSA-SHA256', Buffer.from(payload, 'utf8'), privateKey).toString('base64');
  assert.equal(verifyDeviceSignature(publicKeyBase64, payload, signature), true);
});

test('verifyDeviceSignature rejects a tampered payload', () => {
  const payload = 'syncup-admin-login:nonce123:device-1';
  const signature = crypto.sign('RSA-SHA256', Buffer.from(payload, 'utf8'), privateKey).toString('base64');
  assert.equal(verifyDeviceSignature(publicKeyBase64, 'syncup-admin-login:OTHER:device-1', signature), false);
});

test('verifyDeviceSignature returns false on garbage input', () => {
  assert.equal(verifyDeviceSignature('not-base64!', 'payload', 'also-not-base64'), false);
  assert.equal(verifyDeviceSignature(publicKeyBase64, 'payload', 'bad'), false);
});

test('AES-256-GCM encrypt/decrypt round-trips and fails on tampering', () => {
  const enc = encrypt('JBSWY3DPEHPK3PXP');
  assert.equal(decrypt(enc), 'JBSWY3DPEHPK3PXP');
  const [iv, tag, data] = enc.split(':');
  const tampered = `${iv}:${tag}:${Buffer.from('AAAA', 'base64').toString('base64')}`;
  assert.equal(decrypt(tampered), null);
  assert.equal(decrypt('garbage'), null);
});

test('sha256hex', () => {
  assert.equal(sha256hex('x').length, 64);
});
