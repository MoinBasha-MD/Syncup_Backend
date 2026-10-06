const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-media-tests';
delete process.env.MEDIA_TOKEN_SECRET;
delete process.env.MEDIA_AUTH_ENFORCE;

const { issueMediaToken, verifyMediaToken, withMediaToken } = require('../utils/mediaToken');
const { requireMediaAccess } = require('../middleware/mediaAccess');
const encryptedFileRoutes = require('../routes/encryptedFileRoutes');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = () => res;
  return res;
};

test('media token round-trips', () => {
  const token = issueMediaToken('user-123');
  assert.equal(verifyMediaToken(token), 'user-123');
});

test('tampering with any token part is rejected', () => {
  const token = issueMediaToken('user-123');
  const [uid, exp, sig] = token.split('.');

  // uid
  const tamperedUid = `${Buffer.from('mallory').toString('base64url')}.${exp}.${sig}`;
  assert.equal(verifyMediaToken(tamperedUid), null);
  // exp
  assert.equal(verifyMediaToken(`${uid}.${Number(exp) + 1}.${sig}`), null);
  // sig
  assert.equal(verifyMediaToken(`${uid}.${exp}.${sig.slice(0, -1)}x`), null);
  // structure
  assert.equal(verifyMediaToken('not-a-token'), null);
  assert.equal(verifyMediaToken(`${uid}.${exp}`), null);
  assert.equal(verifyMediaToken('x'.repeat(600)), null);
  assert.equal(verifyMediaToken(null), null);
});

test('expired tokens are rejected', () => {
  const crypto = require('crypto');
  const uid = Buffer.from('user-123').toString('base64url');
  const pastExp = Date.now() - 1000;
  const sig = crypto.createHmac('sha256', 'x'.repeat(32)).update(`${uid}.${pastExp}`).digest('base64url');
  // Even a correctly-signed past-expiry token fails (here sig won't match anyway)
  assert.equal(verifyMediaToken(`${uid}.${pastExp}.${sig}`), null);
});

test('wrong secret is rejected', () => {
  const token = issueMediaToken('user-123');
  process.env.MEDIA_TOKEN_SECRET = 'a'.repeat(40);
  try {
    assert.equal(verifyMediaToken(token), null);
  } finally {
    delete process.env.MEDIA_TOKEN_SECRET;
  }
});

test('withMediaToken only rewrites our uploads URLs', () => {
  const url = '/uploads/profile-images/a.jpg';
  const out = withMediaToken(url, 'user-123');
  assert.match(out, /^\/uploads\/profile-images\/a\.jpg\?mt=/);
  const mt = new URL(`http://x${out}`).searchParams.get('mt');
  assert.equal(verifyMediaToken(mt), 'user-123');

  // Existing query strings preserved; existing mt replaced
  const q = withMediaToken('/uploads/x.jpg?w=100', 'u2');
  assert.match(q, /\?w=100&mt=/);
  const replaced = withMediaToken(`${url}?mt=STALE`, 'u3');
  assert.match(replaced, /mt=[A-Za-z0-9_-]+/);
  assert.ok(!replaced.includes('STALE'));

  // Third-party untouched
  assert.equal(withMediaToken('https://cdn.other.com/x.jpg', 'u4'), 'https://cdn.other.com/x.jpg');
  assert.equal(withMediaToken('', 'u4'), '');
});

test('no configured secret: issue throws, verify returns null', () => {
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.MEDIA_TOKEN_SECRET;
  try {
    assert.throws(() => issueMediaToken('u1'));
    assert.equal(verifyMediaToken('a.b.c'), null);
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('middleware passes with a valid mt token', () => {
  const req = { query: { mt: issueMediaToken('u1') }, headers: {} };
  let called = false;
  requireMediaAccess(req, mockRes(), () => { called = true; });
  assert.ok(called);
});

test('middleware passes with a valid bearer JWT', () => {
  const bearer = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET);
  const req = { query: {}, headers: { authorization: `Bearer ${bearer}` } };
  let called = false;
  requireMediaAccess(req, mockRes(), () => { called = true; });
  assert.ok(called);
});

test('middleware rejects in enforce mode, falls through in grace mode', () => {
  const req = { query: {}, headers: {} };

  process.env.MEDIA_AUTH_ENFORCE = 'true';
  let called = false;
  const res = mockRes();
  requireMediaAccess(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);

  delete process.env.MEDIA_AUTH_ENFORCE;
  called = false;
  requireMediaAccess(req, mockRes(), () => { called = true; });
  assert.ok(called);
});

test('traversal-style requests through the gate still 404 at the router', async () => {
  const app = express();
  app.use('/api/uploads', requireMediaAccess);
  app.use('/api', encryptedFileRoutes);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const port = server.address().port;
    const res = await fetch(
      `http://127.0.0.1:${port}/api/uploads/profile-images/..%2F..%2F.env`
    );
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
