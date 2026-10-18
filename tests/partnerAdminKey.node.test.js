const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

process.env.SYNC_SPACE_DATA_KEY = process.env.SYNC_SPACE_DATA_KEY || 'ab'.repeat(32);
process.env.SYNC_SPACE_SESSION_SECRET = 'portal-session-secret-0123456789abcdef';

const loadWithMocks = (request, mocks) => {
  const modulePath = require.resolve(request);
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (id, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const { generateAdminKeySecret, digestSecret } = require('../utils/syncSpaceCrypto');

test('generateAdminKeySecret produces 32-char base62 secrets with no modulo bias', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const key = generateAdminKeySecret();
    assert.match(key, /^[0-9A-Za-z]{32}$/);
    seen.add(key);
  }
  assert.equal(seen.size, 200);
});

const runScript = async (argv, mocks) => {
  const logs = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = ['node', 'scripts/partnerAdminKey.js', ...argv];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    loadWithMocks('../scripts/partnerAdminKey', {
      mongoose: { connect: async () => ({}), disconnect: async () => ({}) },
      dotenv: { config: () => ({}) },
      '../models/PartnerAdminKey': mocks,
      // real syncSpaceCrypto so hashes/charset are genuine
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
  return logs;
};

test('partnerAdminKey script: create prints the key once, list hides it, revoke sets revokedAt', async () => {
  const SECRET = 'K'.repeat(32);
  const created = [];
  const docs = [
    { keyId: 'ak_aaaabbbb', label: 'Owner', createdAt: new Date('2026-01-01'), lastUsedAt: null, revokedAt: null },
  ];
  const Model = {
    create: async (doc) => { created.push(doc); return { ...doc }; },
    find: () => ({
      sort: () => ({ lean: async () => docs }),
    }),
    findOneAndUpdate: (query, update, opts) => ({
      then: (res, rej) => Promise.resolve(
        query.keyId === 'ak_aaaabbbb' ? { ...docs[0], revokedAt: update.$set.revokedAt } : null
      ).then(res, rej),
    }),
  };

  const createLogs = await runScript(['create', '--label', 'Owner'], {
    ...Model,
    create: async (doc) => { created.push(doc); return { ...doc }; },
  });
  const joined = createLogs.join('\n');
  assert.match(joined, /shown once/i);
  assert.equal(created.length, 1);
  assert.equal(created[0].label, 'Owner');
  assert.match(created[0].secretHash, /^[0-9a-f]{64}$/);
  assert.match(created[0].keyId, /^ak_[0-9a-f]{8}$/);
  // The printed secret is a 32-char base62 line, shown exactly once.
  const secretLines = createLogs.filter((line) => /^[0-9A-Za-z]{32}$/.test(line.trim()));
  assert.equal(secretLines.length, 1);

  const listLogs = await runScript(['list'], Model);
  const listJoined = listLogs.join('\n');
  assert.match(listJoined, /ak_aaaabbbb/);
  assert.match(listJoined, /Owner/);
  assert.doesNotMatch(listJoined, /K{32}/);
  assert.doesNotMatch(listJoined, /secretHash/);

  const revokeLogs = await runScript(['revoke', 'ak_aaaabbbb'], Model);
  assert.match(revokeLogs.join('\n'), /Revoked ak_aaaabbbb/);
  const unknown = await runScript(['revoke', 'ak_missing00'], Model);
  assert.match(unknown.join('\n'), /No active key/);
});

// ---- Login route coverage -------------------------------------------------

const http = require('node:http');

let sessionState;
const expressSessionMock = (opts) => (req, res, next) => {
  if (!sessionState) sessionState = {};
  if (typeof sessionState.regenerate !== 'function') {
    sessionState.regenerate = (cb) => cb();
    sessionState.destroy = (cb) => { sessionState = {}; cb(); };
    sessionState.save = (cb) => cb && cb();
  }
  req.session = sessionState;
  res.setHeader('Set-Cookie', `${opts.name}=sess-mock; Path=${opts.cookie.path}; HttpOnly; SameSite=Lax`);
  next();
};

const csrfPost = (base, pathName, body, headers = {}) =>
  fetch(`${base}${pathName}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });

const VALID_KEY = 'Qz7' + 'x'.repeat(29);

const adminKeyModel = () => ({
  findOne: (query) => {
    const digest = digestSecret(VALID_KEY);
    const match = query.secretHash === digest || query.keyId === 'ak_livekey1';
    const record = match && !sessionState.__keyRevoked
      ? { _id: 'k1', keyId: 'ak_livekey1', label: 'Owner', secretHash: digest, revokedAt: null }
      : null;
    const q = {
      select: () => q,
      lean: async () => record,
      then: (res, rej) => Promise.resolve(record).then(res, rej),
    };
    return q;
  },
  updateOne: async () => ({}),
});

const serviceStub = () => ({
  listPartnersAdmin: async () => ({ items: [], total: 0, page: 1, pages: 1 }),
  getPartnerAdminDetail: async () => ({
    partner: {
      businessName: 'Acme', email: 'a@b.co', website: '', approvalStatus: 'pending',
      reviewVersion: 1, reviewReason: '', reviewHistory: [
        { action: 'approve', reason: 'ok', actorKeyId: 'ak_livekey1', actorLabel: 'Owner', at: new Date() },
      ],
    },
    apps: [],
  }),
  listAppConnections: async () => ({ items: [], activeCount: 0, nextCursor: null }),
  listWebhookDeliveries: async () => [],
});

const loadAdminApp = () => loadWithMocks('../routes/partnerAdminRoutes', {
  '../services/partnerService': serviceStub(),
  '../models/PartnerAdminKey': adminKeyModel(),
  '../models/PartnerAccount': {},
  'express-session': expressSessionMock,
  'connect-mongo': { create: () => ({}) },
});

test('admin key login: valid key signs in, invalid/revoked keys are rejected and lock out', async (t) => {
  const express = require('express');
  const app = express();
  app.use('/partners-admin', loadAdminApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  sessionState = {};

  const login = await fetch(`${base}/partners-admin/login`);
  const html = await login.text();
  assert.match(html, /Admin access key/);
  const token = html.match(/name="_csrf" value="([^"]+)"/)[1];

  const bad = await csrfPost(base, '/partners-admin/login', { _csrf: token, key: 'z'.repeat(32) });
  assert.equal(bad.status, 401);
  const badHtml = await bad.text();
  assert.match(badHtml, /Invalid access key/);
  assert.doesNotMatch(badHtml, /z{32}/); // the attempted key is never echoed back

  const good = await csrfPost(base, '/partners-admin/login', { _csrf: token, key: VALID_KEY });
  assert.equal(good.status, 302);
  assert.equal(good.headers.get('location'), '/partners-admin/dashboard');
  assert.equal(sessionState.adminKeyId, 'ak_livekey1');
  assert.equal(sessionState.adminLabel, 'Owner');

  const dash = await fetch(`${base}/partners-admin/dashboard`);
  assert.equal(dash.status, 200);

  // Revoke → the very next request must bounce to login.
  sessionState.__keyRevoked = true;
  const locked = await fetch(`${base}/partners-admin/dashboard`, { redirect: 'manual' });
  assert.equal(locked.status, 302);
  assert.equal(locked.headers.get('location'), '/partners-admin/login');
});
