const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const DATA_KEY = 'cd'.repeat(32);
const SESSION_SECRET = 'portal-session-secret-0123456789abcdef';
process.env.SYNC_SPACE_DATA_KEY = DATA_KEY;
process.env.SYNC_SPACE_SESSION_SECRET = SESSION_SECRET;

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

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  locals: {},
  redirected: null,
  rendered: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  redirect(target) { this.redirected = target; return this; },
  render(view, locals) { this.rendered = { view, locals }; return this; },
  set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
  getHeader(name) { return this.headers[String(name).toLowerCase()]; },
});

let sessionState;
const sessionOpts = [];
const storeOpts = [];
const expressSessionMock = (opts) => {
  sessionOpts.push(opts);
  return (req, res, next) => {
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
};
const connectMongoMock = { create: (opts) => { storeOpts.push(opts); return {}; } };

const securityDeps = {
  'express-session': expressSessionMock,
  'connect-mongo': connectMongoMock,
};

const loadSecurity = (mocks = {}) =>
  loadWithMocks('../middleware/partnerPortalSecurity', {
    ...securityDeps,
    '../models/PartnerAccount': {},
    '../models/PartnerAdminKey': {},
    ...mocks,
  });

const fakeBcrypt = {
  hash: async (value) => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

test('syncSpaceCrypto round-trips AES-256-GCM and fails on wrong AAD or tampering', () => {
  const { encryptSecret, decryptSecret, digestSecret, requireDataKey } =
    require('../utils/syncSpaceCrypto');
  const stored = encryptSecret('super-secret-value', 'client:sp_abc');
  const segments = stored.split('.');
  assert.equal(segments.length, 3);
  assert.equal(decryptSecret(stored, 'client:sp_abc'), 'super-secret-value');
  assert.throws(() => decryptSecret(stored, 'client:sp_other'));
  assert.throws(() => decryptSecret(stored, 'aud:different'));
  const tampered = [segments[0], segments[1], Buffer.from('forged').toString('base64')].join('.');
  assert.throws(() => decryptSecret(tampered, 'client:sp_abc'));
  assert.throws(() => decryptSecret('two.segments', 'client:sp_abc'));
  assert.throws(() => decryptSecret(null, 'client:sp_abc'));
  assert.equal(digestSecret('abc'), crypto.createHash('sha256').update('abc').digest('hex'));
  assert.deepEqual(requireDataKey(), Buffer.from(DATA_KEY, 'hex'));
});

test('requireDataKey fails closed without a valid 64-hex key', () => {
  const { requireDataKey } = require('../utils/syncSpaceCrypto');
  const previous = process.env.SYNC_SPACE_DATA_KEY;
  try {
    delete process.env.SYNC_SPACE_DATA_KEY;
    assert.throws(() => requireDataKey(), { statusCode: 503 });
    process.env.SYNC_SPACE_DATA_KEY = 'too-short';
    assert.throws(() => requireDataKey(), { statusCode: 503 });
    process.env.SYNC_SPACE_DATA_KEY = 'z'.repeat(64);
    assert.throws(() => requireDataKey(), { statusCode: 503 });
  } finally {
    process.env.SYNC_SPACE_DATA_KEY = previous;
  }
});

test('portal headers set a strict CSP, no-store, and no-referrer', () => {
  const sec = loadSecurity();
  const res = responseMock();
  sec.portalHeaders({ headers: {} }, res, () => {});
  const csp = res.headers['content-security-policy'];
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(!csp.includes('unsafe-inline'));
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('partner and admin sessions use dedicated cookie names, paths, and lifetimes', async () => {
  const sec = loadSecurity();
  const before = sessionOpts.length;
  const res = responseMock();
  sessionState = {};
  await new Promise((resolve) => sec.partnerSession({ headers: {} }, res, resolve));
  const partnerOpts = sessionOpts.at(-1);
  assert.equal(partnerOpts.name, 'syncspace.partner.sid');
  assert.equal(partnerOpts.secret, SESSION_SECRET);
  assert.equal(partnerOpts.cookie.path, '/partners');
  assert.equal(partnerOpts.cookie.httpOnly, true);
  assert.equal(partnerOpts.cookie.sameSite, 'lax');
  assert.equal(partnerOpts.cookie.maxAge, 8 * 60 * 60 * 1000);
  assert.equal(storeOpts.at(-1).collectionName, 'sync_space_portal_sessions');

  await new Promise((resolve) => sec.adminSession({ headers: {} }, res, resolve));
  const adminOpts = sessionOpts.at(-1);
  assert.equal(adminOpts.name, 'syncspace.admin.sid');
  assert.equal(adminOpts.cookie.path, '/partners-admin');
  assert.equal(adminOpts.cookie.maxAge, 60 * 60 * 1000);
  assert.ok(sessionOpts.length > before);
});

test('session middleware refuses to start without a 32+ char dedicated secret', async () => {
  const sec = loadSecurity();
  const previous = process.env.SYNC_SPACE_SESSION_SECRET;
  try {
    process.env.SYNC_SPACE_SESSION_SECRET = 'short';
    assert.throws(
      () => sec.partnerSession({ headers: {} }, responseMock(), () => {}),
      { statusCode: 503 }
    );
  } finally {
    process.env.SYNC_SPACE_SESSION_SECRET = previous;
  }
});

test('CSRF tokens are per-session, required on POST, and compared strictly', () => {
  const sec = loadSecurity();
  const req = { session: {}, headers: {}, body: {} };
  const res = responseMock();
  sec.ensureCsrfToken(req, res, () => {});
  assert.match(req.session.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(res.locals.csrfToken, req.session.csrfToken);

  for (const body of [{}, { _csrf: 'wrong' }, { _csrf: ['x'] }, { _csrf: 42 }, { _csrf: req.session.csrfToken + 'x' }]) {
    const request = { session: { csrfToken: req.session.csrfToken }, body };
    const errors = [];
    sec.requireCsrf(request, responseMock(), (err) => errors.push(err));
    assert.equal(errors.length, 1, JSON.stringify(body));
    assert.equal(errors[0].statusCode, 403);
  }
  const errors = [];
  sec.requireCsrf(
    { session: { csrfToken: req.session.csrfToken }, body: { _csrf: req.session.csrfToken } },
    responseMock(),
    (err) => { if (err) errors.push(err); }
  );
  assert.equal(errors.length, 0);
});

test('same-origin guard rejects cross-origin POSTs and accepts the configured origin', () => {
  const sec = loadSecurity();
  const previous = process.env.SYNC_SPACE_PORTAL_ORIGIN;
  process.env.SYNC_SPACE_PORTAL_ORIGIN = 'https://partners.example.com';
  try {
    for (const origin of ['https://evil.example.com', 'https://partners.example.com.evil.com']) {
      const errors = [];
      sec.sameOriginGuard(
        { method: 'POST', headers: { origin, host: 'partners.example.com' }, protocol: 'https', get: () => 'partners.example.com' },
        responseMock(),
        (err) => errors.push(err)
      );
      assert.equal(errors.length, 1);
      assert.equal(errors[0].statusCode, 403);
    }
    const errors = [];
    sec.sameOriginGuard(
      { method: 'POST', headers: { origin: 'https://partners.example.com', host: 'partners.example.com' }, protocol: 'https', get: () => 'partners.example.com' },
      responseMock(),
      (err) => { if (err) errors.push(err); }
    );
    assert.equal(errors.length, 0);
    const getErrors = [];
    sec.sameOriginGuard(
      { method: 'GET', headers: { origin: 'https://evil.example.com' } },
      responseMock(),
      (err) => { if (err) getErrors.push(err); }
    );
    assert.equal(getErrors.length, 0);
  } finally {
    if (previous === undefined) delete process.env.SYNC_SPACE_PORTAL_ORIGIN;
    else process.env.SYNC_SPACE_PORTAL_ORIGIN = previous;
  }
});

test('requirePartner reloads the account, checks sessionVersion, and blocks suspended writes', async () => {
  const partner = {
    partnerId: 'p-1',
    sessionVersion: 3,
    approvalStatus: 'sandbox',
    emailVerifiedAt: new Date(),
  };
  const sec = loadSecurity({
    '../models/PartnerAccount': { findOne: async () => partner },
  });
  const res = responseMock();
  await sec.requirePartner()({ session: {}, headers: {} }, res, () => { throw new Error('unreachable'); });
  assert.equal(res.redirected, '/partners/login');

  const resMismatch = responseMock();
  await sec.requirePartner()(
    { session: { partnerId: 'p-1', partnerSessionVersion: 2, destroy: (cb) => cb() }, headers: {} },
    resMismatch,
    () => { throw new Error('unreachable'); }
  );
  assert.equal(resMismatch.redirected, '/partners/login');

  const resOk = responseMock();
  const req = { session: { partnerId: 'p-1', partnerSessionVersion: 3 }, headers: {} };
  await sec.requirePartner()(req, resOk, () => {});
  assert.equal(req.partner, partner);

  const resSuspended = responseMock();
  const secSuspended = loadSecurity({
    '../models/PartnerAccount': {
      findOne: async () => ({ ...partner, approvalStatus: 'suspended' }),
    },
  });
  await secSuspended.requirePartner()(
    { session: { partnerId: 'p-1', partnerSessionVersion: 3 }, headers: {} },
    resSuspended,
    () => { throw new Error('unreachable'); }
  );
  assert.equal(resSuspended.statusCode, 403);
  assert.equal(resSuspended.rendered.view, 'error');

  const resAllowed = responseMock();
  const reqAllowed = { session: { partnerId: 'p-1', partnerSessionVersion: 3 }, headers: {} };
  await secSuspended.requirePartner({ allowSuspended: true })(reqAllowed, resAllowed, () => {});
  assert.equal(reqAllowed.partner.approvalStatus, 'suspended');
});

test('requireAdmin permits only non-revoked admin keys and locks out on revoke', async () => {
  const build = (key) => loadSecurity({
    '../models/PartnerAdminKey': { findOne: () => ({ lean: async () => key }) },
  });
  const resAnon = responseMock();
  await build(null).requireAdmin({ session: {}, headers: {} }, resAnon, () => { throw new Error('unreachable'); });
  assert.equal(resAnon.redirected, '/partners-admin/login');

  for (const key of [
    { keyId: 'ak_1', label: 'Owner', revokedAt: new Date() },
    null,
  ]) {
    const sec = build(key);
    const res = responseMock();
    await sec.requireAdmin(
      { session: { adminKeyId: 'ak_1', destroy: (cb) => cb() }, headers: {} },
      res,
      () => { throw new Error('unreachable'); }
    );
    assert.equal(res.redirected, '/partners-admin/login');
  }

  const sec = build({ keyId: 'ak_2', label: 'Ops', revokedAt: null });
  const res = responseMock();
  const req = { session: { adminKeyId: 'ak_2' }, headers: {} };
  await sec.requireAdmin(req, res, () => {});
  assert.deepEqual(req.admin, { keyId: 'ak_2', label: 'Ops' });
});

test('signInPartner regenerates the session and rotates the CSRF token', async () => {
  const sec = loadSecurity();
  let regenerated = false;
  const req = {
    session: {
      csrfToken: 'old-token-old-token-old-token',
      regenerate: (cb) => { regenerated = true; cb(); },
    },
  };
  await sec.signInPartner(req, { partnerId: 'p-1', sessionVersion: 7 });
  assert.equal(regenerated, true);
  assert.equal(req.session.partnerId, 'p-1');
  assert.equal(req.session.partnerSessionVersion, 7);
  assert.notEqual(req.session.csrfToken, 'old-token-old-token-old-token');
  assert.match(req.session.csrfToken, /^[A-Za-z0-9_-]{43}$/);
});

const partnerModelMock = () => ({
  findOne: async (query) => (sessionState && sessionState.__partner) || null,
});

const serviceStub = () => ({
  partnerDto: (p) => (p ? {
    partnerId: p.partnerId,
    email: p.email,
    businessName: p.businessName,
    website: p.website,
    emailVerified: !!p.emailVerifiedAt,
    approvalStatus: p.approvalStatus,
    reviewVersion: p.reviewVersion || 0,
    reviewReason: p.reviewReason || '',
    requestedAt: p.requestedAt || null,
    createdAt: p.createdAt,
  } : null),
  appDto: (a) => a,
  authenticatePartner: async (email, password) => {
    if (email === 'owner@example.com' && password === 'long-enough-password') {
      return sessionState.__partner;
    }
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  },
  listApps: async () => (sessionState.__apps || []),
  getPartnerPortalDetail: async () => ({ ...(sessionState.__partner || {}), reviewHistory: [] }),
  createPartner: async () => ({ partner: { email: 'a@b.co' }, challengeId: 'cd'.repeat(32), emailSent: true }),
  verifyPartnerEmail: async () => ({}),
  resendChallenge: async () => ({ challengeId: 'ef'.repeat(32), sent: true }),
  requestPasswordReset: async () => ({ ok: true }),
  resetPassword: async () => ({}),
  requestVerificationEmail: async () => ({ challengeId: 'ef'.repeat(32), sent: true }),
  listPartnersAdmin: async () => ({ items: [], total: 0, page: 1, pages: 1 }),
  listAppConnections: async () => ({ items: [], activeCount: 0, nextCursor: null }),
  listWebhookDeliveries: async () => [],
  setWebhookUrl: async () => ({}),
  rotateWebhookSecret: async () => ({ secret: 'whsec_x', app: {} }),
  getPartnerAdminDetail: async () => ({
    partner: {
      businessName: 'Acme', email: 'a@b.co', website: '', approvalStatus: 'pending',
      reviewVersion: 1, reviewReason: '', reviewHistory: [
        { action: 'approve', reason: 'ok', actorKeyId: 'ak_test1234', actorLabel: 'Owner', at: new Date() },
      ],
    },
    apps: [],
  }),
  reviewPartner: async () => ({}),
});

const loadPortalApp = () => {
  const PartnerAccount = partnerModelMock();
  return loadWithMocks('../routes/partnerPortalRoutes', {
    '../services/partnerService': serviceStub(),
    'express-session': expressSessionMock,
    'connect-mongo': connectMongoMock,
    '../models/PartnerAccount': PartnerAccount,
    '../models/Admin': {},
    bcryptjs: fakeBcrypt,
  });
};

const VALID_ADMIN_KEY = 'Abc1' + 'k'.repeat(28);

const adminKeyModelMock = () => ({
  findOne: (query) => {
    const digest = require('../utils/syncSpaceCrypto').digestSecret(VALID_ADMIN_KEY);
    const match = query.secretHash === digest || query.keyId === 'ak_test1234';
    const record = match && !sessionState.__keyRevoked
      ? { _id: 'k1', keyId: 'ak_test1234', label: 'Owner', secretHash: digest, revokedAt: null }
      : null;
    const q = { select: () => q, lean: async () => record, then: (res, rej) => Promise.resolve(record).then(res, rej) };
    return q;
  },
  updateOne: async () => ({}),
});

const loadAdminApp = () => {
  // partnerPortalSecurity may be cached by earlier loadSecurity calls with a
  // different PartnerAdminKey binding — evict it so the route's nested
  // require picks up this test's mocks.
  const secPath = require.resolve('../middleware/partnerPortalSecurity');
  const cachedSec = require.cache[secPath];
  delete require.cache[secPath];
  try {
    return loadWithMocks('../routes/partnerAdminRoutes', {
      '../services/partnerService': serviceStub(),
      '../models/PartnerAdminKey': adminKeyModelMock(),
      'express-session': expressSessionMock,
      'connect-mongo': connectMongoMock,
      '../models/PartnerAccount': {},
      bcryptjs: fakeBcrypt,
    });
  } finally {
    if (cachedSec) require.cache[secPath] = cachedSec;
    else delete require.cache[secPath];
  }
};

const serve = async (mount, subApp) => {
  const express = require('express');
  const app = express();
  app.use(mount, subApp);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const csrfPost = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });

test('portal smoke: login page, CSRF enforcement, guards, and session cookies', async (t) => {
  sessionState = {};
  const { server, base } = await serve('/partners', loadPortalApp());
  t.after(() => server.close());

  const login = await fetch(`${base}/partners/login`);
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /name="_csrf" value="[A-Za-z0-9_-]{43}"/);
  assert.match(login.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.match(login.headers.get('referrer-policy'), /no-referrer/);
  const cookie = login.headers.get('set-cookie') || '';
  assert.match(cookie, /syncspace\.partner\.sid=/);

  const token = html.match(/name="_csrf" value="([^"]+)"/)[1];

  Object.assign(sessionState, {
    partnerId: 'p-1',
    partnerSessionVersion: 3,
    __partner: {
      partnerId: 'p-1',
      sessionVersion: 3,
      approvalStatus: 'sandbox',
      emailVerifiedAt: new Date(),
      email: 'owner@example.com',
      businessName: 'Acme <img src=x onerror=alert(1)>',
    },
  });
  const noCsrf = await csrfPost(base, '/partners/login', { email: 'owner@example.com', password: 'long-enough-password' });
  assert.equal(noCsrf.status, 403);
  const badCsrf = await csrfPost(base, '/partners/login', { _csrf: 'nope', email: 'owner@example.com', password: 'long-enough-password' });
  assert.equal(badCsrf.status, 403);

  const evilOrigin = await csrfPost(base, '/partners/login',
    { _csrf: token, email: 'owner@example.com', password: 'long-enough-password' },
    { Origin: 'https://evil.example.com' });
  assert.equal(evilOrigin.status, 403);

  const badLogin = await csrfPost(base, '/partners/login', { _csrf: token, email: 'owner@example.com', password: 'wrong-password!' });
  assert.equal(badLogin.status, 401);
  const badHtml = await badLogin.text();
  assert.match(badHtml, /Invalid email or password/);
  assert.doesNotMatch(badHtml, /wrong-password!/);

  const goodLogin = await csrfPost(base, '/partners/login', { _csrf: token, email: 'owner@example.com', password: 'long-enough-password' });
  assert.equal(goodLogin.status, 302);
  assert.equal(goodLogin.headers.get('location'), '/partners/dashboard');

  const dashboard = await fetch(`${base}/partners/dashboard`);
  assert.equal(dashboard.status, 200);
  const dashHtml = await dashboard.text();
  assert.match(dashHtml, /Acme &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(dashHtml, /<img src=x onerror=/);

  sessionState = {};
  const anonDash = await fetch(`${base}/partners/dashboard`, { redirect: 'manual' });
  assert.equal(anonDash.status, 302);
  assert.equal(anonDash.headers.get('location'), '/partners/login');
});

test('admin smoke: login page renders, dashboard requires an admin session', async (t) => {
  sessionState = {};
  const { server, base } = await serve('/partners-admin', loadAdminApp());
  t.after(() => server.close());

  const login = await fetch(`${base}/partners-admin/login`);
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /name="_csrf"/);
  const cookie = login.headers.get('set-cookie') || '';
  assert.match(cookie, /syncspace\.admin\.sid=/);

  const dash = await fetch(`${base}/partners-admin/dashboard`, { redirect: 'manual' });
  assert.equal(dash.status, 302);
  assert.equal(dash.headers.get('location'), '/partners-admin/login');
});

test('admin key login: success creates a session, bad/revoked keys are rejected', async (t) => {
  sessionState = {};
  const { server, base } = await serve('/partners-admin', loadAdminApp());
  t.after(() => server.close());

  const login = await fetch(`${base}/partners-admin/login`);
  const html = await login.text();
  assert.match(html, /Admin access key/);
  const token = html.match(/name="_csrf" value="([^"]+)"/)[1];

  const bad = await csrfPost(base, '/partners-admin/login', { _csrf: token, key: 'z'.repeat(32) });
  assert.equal(bad.status, 401);

  const good = await csrfPost(base, '/partners-admin/login', { _csrf: token, key: VALID_ADMIN_KEY });
  assert.equal(good.status, 302);
  assert.equal(good.headers.get('location'), '/partners-admin/dashboard');
  assert.equal(sessionState.adminKeyId, 'ak_test1234');
  assert.equal(sessionState.adminLabel, 'Owner');

  const dash = await fetch(`${base}/partners-admin/dashboard`);
  assert.equal(dash.status, 200);

  // Revocation is effective on the very next request.
  sessionState.__keyRevoked = true;
  const locked = await fetch(`${base}/partners-admin/dashboard`, { redirect: 'manual' });
  assert.equal(locked.status, 302);
  assert.equal(locked.headers.get('location'), '/partners-admin/login');
});

test('EJS templates escape partner-controlled content and contain no Aadhaar hooks', async () => {
  const ejs = require('ejs');
  const dashboard = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'partners', 'dashboard.ejs'),
    {
      title: 'Overview',
      csrfToken: 'token',
      partner: {
        businessName: '<script>alert(1)</script>',
        email: 'x<script>@y.com',
        emailVerified: true,
        approvalStatus: 'sandbox',
      },
      apps: [{
        appId: 'sp_1"><img src=x>',
        name: '<svg onload=alert(1)>',
        environment: 'sandbox',
        status: 'active',
        applicationType: 'web',
        kind: 'app',
        requestedScopes: [],
      }],
    }
  );
  assert.match(dashboard, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(dashboard, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(dashboard, /<img src=x>/);
  assert.match(dashboard, /&lt;svg onload=alert\(1\)&gt;/);

  const viewDirs = ['views/partners', 'views/partners-admin'];
  for (const dir of viewDirs) {
    for (const file of fs.readdirSync(path.join(__dirname, '..', dir))) {
      const content = fs.readFileSync(path.join(__dirname, '..', dir, file), 'utf8');
      assert.doesNotMatch(content, /aadhaar/i, `${dir}/${file}`);
      assert.doesNotMatch(content, /<script(?![^>]*src=)/i, `${dir}/${file} has inline script`);
    }
  }
});
