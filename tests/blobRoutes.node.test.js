const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-blob-tests';
process.env.BLOB_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blobs-test-'));

const blobStore = new Map();

const loadRoutes = () => {
  const modulePath = require.resolve('../routes/blobRoutes');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (request === '../models/Blob') {
      return {
        create: async (doc) => { blobStore.set(doc.blobId, doc); return doc; },
        findOne: async ({ blobId }) => blobStore.get(blobId) || null,
        deleteOne: async ({ blobId }) => { blobStore.delete(blobId); },
      };
    }
    if (request === '../middleware/authMiddleware') {
      return {
        protect: (req, res, next) => {
          req.user = { userId: req.headers['x-test-user'] || 'test-user' };
          next();
        },
      };
    }
    if (request === '../middleware/securityMiddleware') {
      return { uploadLimiter: (req, res, next) => next() };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
};

const { issueMediaToken } = require('../utils/mediaToken');
const blobRoutes = loadRoutes();

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use('/api/blobs', blobRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/blobs`;
});

after(() => {
  server.close();
  fs.rmSync(process.env.BLOB_STORAGE_DIR, { recursive: true, force: true });
});

const bearer = (userId = 'test-user') =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;

test('POST uploads a blob and returns a 32-hex blobId', async () => {
  const form = new FormData();
  form.append('blob', new Blob([Buffer.from('ciphertext-bytes')], { type: 'application/octet-stream' }), 'blob');
  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'x-test-user': 'test-user' },
    body: form,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.data.blobId, /^[0-9a-f]{32}$/);
  assert.equal(body.data.size, 16);
  // File must land in the blob dir, not uploads/
  assert.ok(fs.existsSync(path.join(process.env.BLOB_STORAGE_DIR, body.data.blobId)));
});

test('GET streams the blob with a Bearer JWT or an mt token, rejects anonymous', async () => {
  const form = new FormData();
  form.append('blob', new Blob([Buffer.from('secret-ciphertext')]));
  const up = await fetch(`${baseUrl}/`, { method: 'POST', headers: { 'x-test-user': 'u1' }, body: form });
  const { blobId } = (await up.json()).data;

  const byBearer = await fetch(`${baseUrl}/${blobId}`, { headers: { authorization: bearer('u1') } });
  assert.equal(byBearer.status, 200);
  assert.equal(byBearer.headers.get('content-type'), 'application/octet-stream');
  assert.equal(await byBearer.text(), 'secret-ciphertext');

  const byToken = await fetch(`${baseUrl}/${blobId}?mt=${issueMediaToken('u1')}`);
  assert.equal(byToken.status, 200);

  const anon = await fetch(`${baseUrl}/${blobId}`);
  assert.equal(anon.status, 401);

  const missing = await fetch(`${baseUrl}/${'f'.repeat(32)}`, { headers: { authorization: bearer() } });
  assert.equal(missing.status, 404);
});

test('bad/traversal blobIds are rejected', async () => {
  for (const id of ['../x', 'nothex', 'zz'.repeat(16), '../../.env']) {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { headers: { authorization: bearer() } });
    assert.ok(res.status === 400 || res.status === 404, `${id} -> ${res.status}`);
  }
});

test('DELETE is owner-only', async () => {
  const form = new FormData();
  form.append('blob', new Blob([Buffer.from('x')]));
  const up = await fetch(`${baseUrl}/`, { method: 'POST', headers: { 'x-test-user': 'owner-1' }, body: form });
  const { blobId } = (await up.json()).data;

  const forbidden = await fetch(`${baseUrl}/${blobId}`, { method: 'DELETE', headers: { 'x-test-user': 'mallory' } });
  assert.equal(forbidden.status, 403);

  const ok = await fetch(`${baseUrl}/${blobId}`, { method: 'DELETE', headers: { 'x-test-user': 'owner-1' } });
  assert.equal(ok.status, 200);
  assert.ok(!fs.existsSync(path.join(process.env.BLOB_STORAGE_DIR, blobId)));
});
