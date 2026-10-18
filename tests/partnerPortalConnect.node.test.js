const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

process.env.SYNC_SPACE_DATA_KEY = 'ef'.repeat(32);
process.env.SYNC_SPACE_SUBJECT_KEY = 'subject-key-0123456789abcdef-32chars!!';
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

const chain = (result) => {
  const query = {};
  for (const method of ['select', 'lean', 'sort', 'skip', 'limit']) {
    query[method] = () => query;
  }
  query.then = (resolve, reject) => Promise.resolve(
    typeof result === 'function' ? result() : result
  ).then(resolve, reject);
  return query;
};

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

const partnerDoc = () => ({
  partnerId: 'p-1',
  sessionVersion: 2,
  approvalStatus: 'sandbox',
  emailVerifiedAt: new Date(),
  email: 'owner@example.com',
  businessName: 'Acme',
  website: '',
});

const appDoc = () => ({
  appId: 'sp_' + 'ab'.repeat(16),
  partnerId: 'p-1',
  name: 'Orders',
  environment: 'sandbox',
  requestedScopes: ['space.messages', 'space.codes'],
  status: 'active',
  sandboxUserIds: ['user-1'],
  website: 'https://orders.example.com',
  redirectUris: [],
  webhookUrl: '',
});

let spaceStub = {};
let spaceCalls = [];

const serviceStub = () => ({
  partnerDto: (p) => (p ? { partnerId: p.partnerId, email: p.email, businessName: p.businessName, approvalStatus: p.approvalStatus } : null),
  appDto: (a) => a,
  getApp: async () => appDoc(),
  listApiKeys: async () => [],
  listSandboxTesters: async () => [],
  listAppConnections: async () => ({
    activeCount: 1,
    items: [{
      subject: 'sub_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
      scopes: ['space.messages'],
      status: 'active',
      connectedAt: new Date('2026-01-02'),
      revokedAt: null,
      cursor: 'a'.repeat(24),
    }],
    nextCursor: null,
  }),
  listWebhookDeliveries: async () => [],
  setWebhookUrl: async () => ({}),
  rotateWebhookSecret: async () => ({ secret: 'whsec_x', app: appDoc() }),
});

const loadPortalApp = () => {
  const secPath = require.resolve('../middleware/partnerPortalSecurity');
  const cachedSec = require.cache[secPath];
  delete require.cache[secPath];
  try {
    return loadWithMocks('../routes/partnerPortalRoutes', {
      '../services/partnerService': serviceStub(),
      '../services/partnerSpaceService': {
        pairByQr: async (creds, payload) => {
          spaceCalls.push(['pairByQr', creds, payload]);
          if (payload === 'syncspace:pair:good') {
            return { subject: 'sub_pair123', scopes: ['space.messages'], connectedAt: new Date() };
          }
          const err = new Error('invalid');
          err.statusCode = 404;
          err.code = 'PAIRING_INVALID';
          throw err;
        },
        requestOtpPairing: async (creds, identifier) => {
          spaceCalls.push(['requestOtpPairing', creds, identifier]);
          return { pairingId: 'pr_' + 'ab'.repeat(8), expiresAt: new Date() };
        },
        verifyOtpPairing: async (creds, pairingId, code) => {
          spaceCalls.push(['verifyOtpPairing', creds, pairingId, code]);
          if (code === '482913') {
            return { subject: 'sub_pair123', scopes: ['space.messages'], connectedAt: new Date() };
          }
          const err = new Error('invalid');
          err.statusCode = 400;
          err.code = 'PAIRING_CODE_INVALID';
          throw err;
        },
      },
      '../models/PartnerAccount': { findOne: () => chain(partnerDoc()) },
      'express-session': expressSessionMock,
      'connect-mongo': { create: () => ({}) },
    });
  } finally {
    if (cachedSec) require.cache[secPath] = cachedSec;
    else delete require.cache[secPath];
  }
};

const serve = async () => {
  const express = require('express');
  const app = express();
  app.use('/partners', loadPortalApp());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const csrf = async (base, pathName) => {
  const res = await fetch(`${base}${pathName}`);
  const html = await res.text();
  return { res, html, token: html.match(/name="_csrf" value="([^"]+)"/)[1] };
};

test('connect page renders scan + OTP panels with camera permission only on this page', async (t) => {
  sessionState = { partnerId: 'p-1', partnerSessionVersion: 2 };
  const { server, base } = await serve();
  t.after(() => server.close());
  const appPath = `/partners/apps/${appDoc().appId}`;

  const { res, html } = await csrf(base, `${appPath}/connect`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('permissions-policy'), 'camera=(self)');
  assert.match(html, /Scan a Sync Space QR/);
  assert.match(html, /connect with a code/);
  assert.match(html, /syncspace:pair:/);

  // other pages keep the default (no camera) policy
  const other = await fetch(`${base}${appPath}`);
  assert.notEqual(other.headers.get('permissions-policy'), 'camera=(self)');
});

test('QR scan form calls pairByQr and shows the pairwise subject', async (t) => {
  sessionState = { partnerId: 'p-1', partnerSessionVersion: 2 };
  const { server, base } = await serve();
  t.after(() => server.close());
  const appPath = `/partners/apps/${appDoc().appId}`;

  const { token } = await csrf(base, `${appPath}/connect`);
  const ok = await csrfPost(base, `${appPath}/connect/scan`, { _csrf: token, qrPayload: 'syncspace:pair:good' });
  const html = await ok.text();
  assert.match(html, /Customer connected/);
  assert.match(html, /sub_pair123/);
  assert.equal(spaceCalls[0][0], 'pairByQr');
  // portal credentials = app + its business scopes
  assert.deepEqual(spaceCalls[0][1].key.scopes, ['space.messages', 'space.codes']);

  const bad = await csrfPost(base, `${appPath}/connect/scan`, { _csrf: token, qrPayload: 'syncspace:pair:bad' });
  const badHtml = await bad.text();
  assert.match(badHtml, /invalid or expired/);
  assert.doesNotMatch(badHtml, /sub_/);
});

test('OTP request + verify flow completes the pairing in the portal', async (t) => {
  sessionState = { partnerId: 'p-1', partnerSessionVersion: 2 };
  const { server, base } = await serve();
  t.after(() => server.close());
  const appPath = `/partners/apps/${appDoc().appId}`;

  const { token } = await csrf(base, `${appPath}/connect`);
  const requested = await csrfPost(base, `${appPath}/connect/otp`, { _csrf: token, identifier: 'maya' });
  const html = await requested.text();
  assert.match(html, /pairing request was sent/);
  assert.match(html, /6-digit code/);

  const verified = await csrfPost(base, `${appPath}/connect/verify`, { _csrf: token, pairingId: 'pr_' + 'ab'.repeat(8), code: '482913' });
  const done = await verified.text();
  assert.match(done, /Customer connected/);

  const wrong = await csrfPost(base, `${appPath}/connect/verify`, { _csrf: token, pairingId: 'pr_' + 'ab'.repeat(8), code: '000000' });
  const wrongHtml = await wrong.text();
  assert.match(wrongHtml, /invalid or expired/);
});

test('customers list shows truncated subjects and never user ids', async (t) => {
  sessionState = { partnerId: 'p-1', partnerSessionVersion: 2 };
  const { server, base } = await serve();
  t.after(() => server.close());

  const res = await fetch(`${base}/partners/apps/${appDoc().appId}`);
  const html = await res.text();
  assert.match(html, /Customers/);
  assert.match(html, /sub_ABCDEFGHIJK/); // first 12 chars shown
  assert.match(html, /data-subject="sub_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"/);
  assert.doesNotMatch(html, /user-1/);
  assert.doesNotMatch(html, /userId/i);
});
