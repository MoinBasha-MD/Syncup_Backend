const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');
const bcrypt = require('bcryptjs');

// Ephemeral ES256 key + issuer for the whole file.
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.SYNC_SPACE_OIDC_ISSUER = 'https://api.test/oauth';
process.env.SYNC_SPACE_OIDC_PRIVATE_KEY = PEM;
process.env.SYNC_SPACE_DATA_KEY = 'ef'.repeat(32);
process.env.SYNC_SPACE_SUBJECT_KEY = 'subject-key-0123456789abcdef-32chars!!';
process.env.SYNC_SPACE_SESSION_SECRET = 'oauth-session-secret-0123456789abcdef';

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
  query.then = (resolve, reject) =>
    Promise.resolve(typeof result === 'function' ? result() : result).then(resolve, reject);
  return query;
};

// ---- tiny in-memory mongoose stand-ins ------------------------------------

const matchQuery = (doc, query = {}) =>
  Object.entries(query).every(([key, want]) => {
    if (want && typeof want === 'object' && want.$in) return want.$in.includes(doc[key]);
    if (want && typeof want === 'object' && want.$lte) return doc[key] <= want.$lte;
    if (want === null) return doc[key] === null || doc[key] === undefined;
    return doc[key] === want;
  });

const applyUpdate = (doc, update) => {
  for (const [key, value] of Object.entries(update.$set || {})) doc[key] = value;
  for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
  for (const [key, value] of Object.entries(update.$push || {})) {
    doc[key] = [...(doc[key] || []), value];
  }
  for (const [key] of Object.entries(update.$unset || {})) delete doc[key];
  return doc;
};

const memModel = () => {
  const docs = [];
  return {
    docs,
    findOne: (q = {}) => chain(docs.find((d) => matchQuery(d, q)) || null),
    findOneAndUpdate: async (q, update, opts = {}) => {
      const doc = docs.find((d) => matchQuery(d, q));
      if (!doc) return null;
      return applyUpdate(doc, update);
    },
    find: (q = {}) => chain(docs.filter((d) => matchQuery(d, q))),
    findById: (id) => chain(docs.find((d) => String(d._id) === String(id)) || null),
    updateMany: async (q, update) => {
      let n = 0;
      docs.forEach((d) => { if (matchQuery(d, q)) { applyUpdate(d, update); n += 1; } });
      return { modifiedCount: n };
    },
    updateOne: async (q, update) => {
      const doc = docs.find((d) => matchQuery(d, q));
      if (doc) applyUpdate(doc, update);
      return { modifiedCount: doc ? 1 : 0 };
    },
    countDocuments: async (q = {}) => docs.filter((d) => matchQuery(d, q)).length,
    create: async (doc) => {
      const stored = { _id: crypto.randomBytes(12).toString('hex'), ...doc };
      docs.push(stored);
      return stored;
    },
    deleteMany: async (q = {}) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matchQuery(docs[i], q)) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    },
    save: async () => {},
  };
};

// ---- shared fixture state ---------------------------------------------------

const APP_ID = 'sp_' + 'ab'.repeat(16);
const APP_ID_2 = 'sp_' + 'cd'.repeat(16);
const USER_ID = 'user-oauth-1';
const CODE_CHALLENGE = crypto.createHash('sha256').update('v'.repeat(50)).digest('base64url');

let sessionState;
const expressSessionMock = (opts) => (req, res, next) => {
  if (!sessionState) sessionState = {};
  if (typeof sessionState.regenerate !== 'function') {
    sessionState.regenerate = (cb) => {
      for (const k of Object.keys(sessionState)) {
        if (!['regenerate', 'save', 'destroy'].includes(k)) delete sessionState[k];
      }
      cb();
    };
    sessionState.save = (cb) => cb && cb();
    sessionState.destroy = (cb) => { sessionState = {}; cb && cb(); };
  }
  req.session = sessionState;
  res.setHeader('Set-Cookie', `${opts.name}=sess; Path=${opts.cookie.path}; HttpOnly; SameSite=Lax`);
  next();
};

const partner = { partnerId: 'p-1', approvalStatus: 'approved', businessName: 'Acme Inc', emailVerifiedAt: new Date() };

const webApp = {
  appId: APP_ID,
  partnerId: 'p-1',
  kind: 'app',
  applicationType: 'web',
  environment: 'live',
  name: 'Acme Orders',
  website: 'https://orders.acme.com',
  requestedScopes: ['openid', 'profile', 'email', 'space.messages'],
  redirectUris: ['https://app.acme.com/cb'],
  status: 'active',
  clientSecretEncrypted: null,
  sandboxUserIds: [],
};

const nativeApp = {
  ...webApp,
  appId: APP_ID_2,
  applicationType: 'native',
  environment: 'sandbox',
  sandboxUserIds: [USER_ID],
  redirectUris: ['com.acme.app:/callback'],
  clientSecretEncrypted: null,
};

const userDoc = {
  userId: USER_ID,
  name: 'Maya Rao',
  username: 'maya',
  phoneNumber: '9876543210',
  email: 'maya@example.com',
  emailVerified: true,
  password: bcrypt.hashSync('hunter2!', 4),
};

const profileDoc = { userId: USER_ID, syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE', status: 'active', allowPromotions: false };

const stores = {
  PartnerApp: memModel(),
  PartnerAccount: memModel(),
  SyncSpaceProfile: memModel(),
  User: memModel(),
  SpaceConnection: memModel(),
  OAuthAuthorizationCode: memModel(),
  OAuthAccessToken: memModel(),
  OAuthRefreshToken: memModel(),
};

// The app is built once; reset mutates the shared docs arrays in place so the
// captured mock objects stay bound.
const resetStores = () => {
  Object.values(stores).forEach((m) => { m.docs.length = 0; });
  stores.PartnerApp.docs.push({ ...webApp }, { ...nativeApp });
  stores.PartnerAccount.docs.push({ ...partner });
  stores.SyncSpaceProfile.docs.push({ ...profileDoc });
  stores.User.docs.push({ ...userDoc });
};
resetStores();

const buildApp = () => {
  // Clear the cached security middleware module so its model deps rebind.
  const secPath = require.resolve('../middleware/partnerPortalSecurity');
  const cachedSec = require.cache[secPath];
  delete require.cache[secPath];
  try {
    return loadWithMocks('../routes/oauthRoutes', {
      'express-session': expressSessionMock,
      'connect-mongo': { create: () => ({}) },
      '../models/PartnerApp': stores.PartnerApp,
      '../models/PartnerAccount': stores.PartnerAccount,
      '../models/SyncSpaceProfile': stores.SyncSpaceProfile,
      '../models/userModel': stores.User,
      '../models/SpaceConnection': stores.SpaceConnection,
      '../models/OAuthAuthorizationCode': stores.OAuthAuthorizationCode,
      '../models/OAuthAccessToken': stores.OAuthAccessToken,
      '../models/OAuthRefreshToken': stores.OAuthRefreshToken,
      './partnerWebhooks': { enqueueConnectionEvent: async () => null },
      '../services/syncSpaceIdentity': {
        activateProfile: async (uid) => ({ userId: uid, status: 'active', syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' }),
        sharingPolicyOf: (profile) => ({
          phone: 'ask', sync_id: 'ask', picture: 'allow', birthdate: 'ask', gender: 'ask',
          ...((profile && profile.sharingPolicy) || {}),
        }),
      },
    });
  } finally {
    if (cachedSec) require.cache[secPath] = cachedSec;
    else delete require.cache[secPath];
  }
};

let server;
let base;
let oauthApp;
const start = async () => {
  const express = require('express');
  const outer = express();
  oauthApp = buildApp();
  outer.use('/oauth', oauthApp);
  server = http.createServer(outer);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/oauth`;
};

const resetLimits = () =>
  oauthApp.resetLoginLimits(['127.0.0.1', '::1', '::ffff:127.0.0.1'], ['9876543210', '9999999999']);

test.before(async () => { await start(); });
test.after(() => server && server.close());

const get = (path, headers = {}) => fetch(`${base}${path}`, { redirect: 'manual', headers });
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
const csrf = async (path) => {
  const res = await get(path);
  const html = await res.text();
  return { res, html, token: (html.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
};

const authorizePath = (overrides = {}) => {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: APP_ID,
    redirect_uri: 'https://app.acme.com/cb',
    scope: 'openid profile',
    state: 'state123',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  });
  return `/authorize?${p}`;
};

const loginAs = async () => {
  resetLimits();
  const { token } = await csrf('/login');
  return post('/login', { _csrf: token, phoneNumber: '9876543210', password: 'hunter2!' });
};

// ---------- discovery / JWKS ----------

test('discovery + JWKS shape and kid thumbprint', async () => {
  const disco = await get('/.well-known/openid-configuration');
  assert.equal(disco.status, 200);
  assert.match(disco.headers.get('cache-control'), /max-age=300/);
  const doc = await disco.json();
  assert.equal(doc.issuer, 'https://api.test/oauth');
  assert.equal(doc.authorization_endpoint, 'https://api.test/oauth/authorize');
  assert.equal(doc.token_endpoint, 'https://api.test/oauth/token');
  assert.equal(doc.revocation_endpoint, 'https://api.test/oauth/revoke');
  assert.deepEqual(doc.response_types_supported, ['code']);
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(doc.subject_types_supported, ['pairwise']);
  assert.deepEqual(doc.id_token_signing_alg_values_supported, ['ES256']);

  const jwksRes = await get('/jwks');
  const jwks = await jwksRes.json();
  const jwk = jwks.keys[0];
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'P-256');
  // kid = RFC 7638 JWK thumbprint
  const expectedKid = crypto
    .createHash('sha256')
    .update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`)
    .digest('base64url');
  assert.equal(jwk.kid, expectedKid);
});

// ---------- authorize ----------

test('authorize: unknown client and bad redirect render an error page, never redirect', async () => {
  sessionState = {};
  let res = await get(`/authorize?client_id=sp_${'00'.repeat(16)}&redirect_uri=https://x.example.com&response_type=code&state=s&scope=openid&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256`);
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /not registered/i);
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  res = await get(authorizePath({ redirect_uri: 'https://evil.example.com/cb' }));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /unregistered redirect/i);
});

test('authorize: missing state, bad scope, missing/plain PKCE redirect with error+state', async () => {
  sessionState = {};
  const check = async (overrides, expectError, expectState = 'state123') => {
    const res = await get(authorizePath(overrides));
    assert.equal(res.status, 302, JSON.stringify(overrides));
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://app.acme.com/cb');
    assert.equal(loc.searchParams.get('error'), expectError);
    assert.equal(loc.searchParams.get('state'), expectState);
  };
  await check({ response_type: 'token' }, 'unsupported_response_type');
  await check({ state: '' }, 'invalid_request', null); // no state to echo
  await check({ scope: 'openid space.messages' }, 'invalid_scope'); // business scope not identity
  await check({ scope: 'openid phone' }, 'invalid_scope'); // phone not requested by app
  await check({ scope: 'profile' }, 'invalid_scope'); // missing openid
  await check({ code_challenge: undefined }, 'invalid_request');
  await check({ code_challenge_method: 'plain' }, 'invalid_request');
  await check({ code_challenge: 'short' }, 'invalid_request');
  await check({ prompt: 'bogus' }, 'invalid_request');
});

test('authorize happy path stores the request and redirects to login; login issues session', async () => {
  sessionState = {};
  const res = await get(authorizePath());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/oauth/login');
  assert.ok(sessionState.oauthRequest);
  assert.equal(sessionState.oauthRequest.clientId, APP_ID);

  const login = await loginAs();
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/oauth/consent');
  assert.equal(sessionState.oauthUserId, USER_ID);
  assert.ok(sessionState.csrfToken);

  // consent renders — new connection needed
  const consent = await get('/consent');
  const html = await consent.text();
  assert.match(html, /Allow Acme Orders/);
  assert.match(html, /orders\.acme\.com/);
  assert.match(html, /app\.acme\.com/);
  assert.match(html, /Your name and username/);
  assert.match(html, /Always shared/);
});

test('login is rate limited per IP and fails generically', async () => {
  sessionState = {};
  await get(authorizePath());
  const { token } = await csrf('/login');
  const bad = await post('/login', { _csrf: token, phoneNumber: '9876543210', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Phone or password is incorrect/);
  for (let i = 0; i < 4; i += 1) {
    await post('/login', { _csrf: token, phoneNumber: '9999999999', password: 'x' });
  }
  const limited = await post('/login', { _csrf: token, phoneNumber: '9999999999', password: 'x' });
  assert.equal(limited.status, 429);
});

test('POST login/consent require CSRF', async () => {
  sessionState = {};
  await get(authorizePath());
  const res = await post('/login', { phoneNumber: '9876543210', password: 'hunter2!' });
  assert.equal(res.status, 403);
  const res2 = await post('/consent', { decision: 'approve' });
  assert.equal(res2.status, 403);
});

const fullFlow = async ({ scopes = 'openid profile', app = APP_ID, redirect = 'https://app.acme.com/cb', prompt } = {}) => {
  sessionState = {};
  const overrides = { client_id: app, redirect_uri: redirect, scope: scopes };
  if (prompt) overrides.prompt = prompt;
  await get(authorizePath(overrides));
  await loginAs();
  return get('/consent');
};

const extractCode = (loc) => new URL(loc).searchParams.get('code');

test('consent approve issues a code and merges scopes into the connection', async () => {
  resetStores();
  const res = await fullFlow();
  const { token } = { token: sessionState.csrfToken };
  const approve = await post('/consent', { _csrf: token, decision: 'approve' });
  assert.equal(approve.status, 302);
  const loc = approve.headers.get('location');
  assert.match(loc, /^https:\/\/app\.acme\.com\/cb\?/);
  const url = new URL(loc);
  assert.match(url.searchParams.get('code'), /^occ_/);
  assert.equal(url.searchParams.get('state'), 'state123');
  assert.equal(url.searchParams.get('iss'), 'https://api.test/oauth');
  const conn = stores.SpaceConnection.docs[0];
  assert.equal(conn.status, 'active');
  // openid/profile/email are always granted — even when not requested.
  assert.deepEqual(conn.scopes.sort(), ['email', 'openid', 'profile'].sort());
  assert.deepEqual(conn.requiredScopes.sort(), ['email', 'openid', 'profile'].sort());
  assert.equal(conn.consentVersion, 1);
  assert.equal(sessionState.oauthRequest, undefined);

  // second consent adds an optional extra scope while keeping merged scopes
  stores.PartnerApp.docs[0].requestedScopes = ['openid', 'profile', 'email', 'phone'];
  sessionState = { oauthUserId: USER_ID };
  await get(authorizePath({ scope: 'openid profile phone' }));
  const c2 = await post('/consent', {
    _csrf: sessionState.csrfToken,
    decision: 'approve',
    fields: 'phone',
  });
  assert.equal(c2.status, 302);
  const merged = stores.SpaceConnection.docs[0];
  assert.deepEqual(merged.scopes.sort(), ['email', 'openid', 'phone', 'profile'].sort());
  assert.equal(merged.consentVersion, 2);
});

test('consent is skipped when the connection already covers the scopes', async () => {
  resetStores();
  stores.SpaceConnection.docs.push({
    connectionId: 'conn_1', userId: USER_ID, appId: APP_ID, partnerId: 'p-1',
    status: 'active', consentVersion: 3, scopes: ['openid', 'profile', 'email', 'space.messages'],
    subject: 'sub_x', environment: 'live', connectedAt: new Date(),
  });
  sessionState = { oauthUserId: USER_ID };
  const res = await get(authorizePath());
  assert.equal(res.status, 302); // skipped straight to redirect with code
  assert.match(res.headers.get('location'), /^https:\/\/app\.acme\.com\/cb\?code=/);
  // merge preserved the business scope
  assert.deepEqual(stores.SpaceConnection.docs[0].scopes.sort(), ['openid', 'profile', 'email', 'space.messages'].sort());
});

test('deny redirects access_denied; prompt=consent forces the page; prompt=none redirects errors', async () => {
  resetStores();
  // deny
  sessionState = {};
  await get(authorizePath());
  await loginAs();
  const deny = await post('/consent', { _csrf: sessionState.csrfToken, decision: 'deny' });
  assert.equal(deny.status, 302);
  const loc = new URL(deny.headers.get('location'));
  assert.equal(loc.searchParams.get('error'), 'access_denied');
  assert.equal(loc.searchParams.get('state'), 'state123');

  // prompt=consent with an already-covering connection still shows the page
  stores.SpaceConnection.docs.push({
    connectionId: 'conn_1', userId: USER_ID, appId: APP_ID, partnerId: 'p-1',
    status: 'active', consentVersion: 1, scopes: ['openid', 'profile', 'email'],
    subject: 's', environment: 'live', connectedAt: new Date(),
  });
  sessionState = { oauthUserId: USER_ID };
  const forced = await get(authorizePath({ prompt: 'consent' }));
  assert.equal(forced.status, 200);
  assert.match(await forced.text(), /Allow Acme Orders/);

  // prompt=none while consent needed → consent_required
  sessionState = {};
  const anon = await get(authorizePath({ prompt: 'none' }));
  assert.equal(anon.status, 302);
  assert.equal(new URL(anon.headers.get('location')).searchParams.get('error'), 'login_required');
});

test('sandbox non-tester sees a testing-only error page', async () => {
  resetStores();
  sessionState = { oauthUserId: 'user-outsider' };
  await get(authorizePath({ client_id: APP_ID_2, redirect_uri: 'com.acme.app:/callback' }));
  const res = await get('/consent');
  assert.equal(res.status, 403);
  assert.match(await res.text(), /in testing/);
});

test('suspended profile gets an error page, no code', async () => {
  resetStores();
  stores.SyncSpaceProfile.docs[0].status = 'suspended';
  sessionState = { oauthUserId: USER_ID };
  await get(authorizePath());
  const res = await get('/consent');
  assert.equal(res.status, 403);
  assert.match(await res.text(), /suspended/i);
  assert.equal(stores.OAuthAuthorizationCode.docs.length, 0);
  stores.SyncSpaceProfile.docs[0].status = 'active';
});

test('missing profile offers Sync Space activation', async () => {
  resetStores();
  stores.SyncSpaceProfile.docs.length = 0;
  sessionState = { oauthUserId: USER_ID };
  await get(authorizePath());
  const res = await get('/consent');
  assert.match(await res.text(), /Activate Sync Space/);
  const act = await post('/activate', { _csrf: sessionState.csrfToken });
  assert.equal(act.status, 302);
  assert.equal(act.headers.get('location'), '/oauth/consent');
});

// ---------- token ----------

const issueCode = async ({ appId = APP_ID, redirect = 'https://app.acme.com/cb', scopes = ['openid', 'profile'], nonce = null } = {}) => {
  const oidc = require('../services/oidcProvider');
  const raw = `occ_${crypto.randomBytes(32).toString('base64url')}`;
  const conn = stores.SpaceConnection.docs.find((c) => c.appId === appId) || (() => {
    const c = { connectionId: 'conn_x', userId: USER_ID, appId, partnerId: 'p-1', status: 'active', consentVersion: 1, scopes, subject: 's', environment: 'live', connectedAt: new Date() };
    stores.SpaceConnection.docs.push(c);
    return c;
  })();
  await stores.OAuthAuthorizationCode.create({
    codeHash: crypto.createHash('sha256').update(raw).digest('hex'),
    appId, userId: USER_ID, connectionId: conn.connectionId, consentVersion: conn.consentVersion,
    redirectUri: redirect, scopes, nonce, codeChallenge: CODE_CHALLENGE,
    authTime: new Date(), expiresAt: new Date(Date.now() + 60_000),
  });
  return raw;
};

const tokenPost = (body, headers = {}) => post('/token', { grant_type: 'authorization_code', code_verifier: 'v'.repeat(50), ...body }, headers);

test('token exchange: PKCE, redirect, client checks and success', async () => {
  resetStores();
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = (id, secret) => ({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}` });
  const redirect = 'https://app.acme.com/cb';

  // wrong verifier
  let code = await issueCode();
  let res = await tokenPost({ code, redirect_uri: redirect, code_verifier: 'w'.repeat(50) }, basic(APP_ID, 'sekret'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');

  // wrong redirect
  code = await issueCode();
  res = await tokenPost({ code, redirect_uri: 'https://other.example.com/cb' }, basic(APP_ID, 'sekret'));
  assert.equal((await res.json()).error, 'invalid_grant');

  // wrong client
  code = await issueCode();
  res = await tokenPost({ code, redirect_uri: redirect }, basic(APP_ID_2, 'x'));
  assert.equal(res.status, 401); // native must not send a secret → invalid_client
  code = await issueCode();
  res = await tokenPost({ code, redirect_uri: redirect, client_id: APP_ID_2 }, basic(APP_ID, 'sekret'));
  assert.equal((await res.json()).error, 'invalid_request'); // basic + post creds together

  // web without secret → 401 + WWW-Authenticate
  code = await issueCode();
  res = await tokenPost({ code, redirect_uri: redirect, client_id: APP_ID });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /Basic/);

  // wrong secret → 401
  res = await tokenPost({ code, redirect_uri: redirect }, basic(APP_ID, 'nope'));
  assert.equal(res.status, 401);

  // success
  code = await issueCode();
  res = await tokenPost({ code, redirect_uri: redirect }, basic(APP_ID, 'sekret'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.access_token, /^sat_/);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, 'openid profile');

  // verify id_token ES256 ieee-p1363
  const [h, p, s] = body.id_token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(header.alg, 'ES256');
  assert.ok(header.kid);
  const valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), {
    key: crypto.createPublicKey(PEM), dsaEncoding: 'ieee-p1363',
  }, Buffer.from(s, 'base64url'));
  assert.equal(valid, true);
  assert.equal(payload.iss, 'https://api.test/oauth');
  assert.equal(payload.aud, APP_ID);
  assert.equal(payload.azp, APP_ID);
  assert.equal(payload.name, 'Maya Rao');
  assert.equal(payload.preferred_username, 'maya');
  // pairwise sub — same as business API subject
  const { pairwiseSubject } = require('../utils/syncSpaceCrypto');
  assert.equal(payload.sub, pairwiseSubject(APP_ID, USER_ID));
  assert.notEqual(payload.sub, pairwiseSubject(APP_ID_2, USER_ID));

  // replay → invalid_grant + issued token revoked
  const again = await tokenPost({ code, redirect_uri: redirect }, basic(APP_ID, 'sekret'));
  assert.equal(again.status, 400);
  const tokenDoc = stores.OAuthAccessToken.docs[0];
  assert.equal(tokenDoc.revokedAt instanceof Date, true);
  // the consume recorded the token id in the same atomic update
  const codeDoc = stores.OAuthAuthorizationCode.docs.filter((d) => d.consumedAt).at(-1);
  assert.deepEqual(codeDoc.issuedTokenIds, [tokenDoc.tokenId]);
});

test('a leaked code cannot be burned or replayed by a different client', async () => {
  resetStores();
  const code = await issueCode(); // belongs to APP_ID
  // native public client presents it — invalid_grant, code left unconsumed
  const res = await tokenPost({ code, redirect_uri: 'https://app.acme.com/cb', client_id: APP_ID_2 });
  assert.equal((await res.json()).error, 'invalid_grant');
  assert.ok(!stores.OAuthAuthorizationCode.docs[0].consumedAt);
  assert.equal(stores.OAuthAccessToken.docs.length, 0);

  // a different client replaying an already-consumed code revokes nothing
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}`;
  const code2 = await issueCode();
  await tokenPost({ code: code2, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic });
  const foreignReplay = await tokenPost({ code: code2, redirect_uri: 'https://app.acme.com/cb', client_id: APP_ID_2 });
  assert.equal((await foreignReplay.json()).error, 'invalid_grant');
  // the legit token survives the foreign replay
  assert.ok(!stores.OAuthAccessToken.docs[0].revokedAt);
});

test('suspended profile fails the code exchange', async () => {
  resetStores();
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}`;
  stores.SyncSpaceProfile.docs[0].status = 'suspended';
  const code = await issueCode();
  const res = await tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic });
  assert.equal((await res.json()).error, 'invalid_grant');
  assert.equal(stores.OAuthAccessToken.docs.length, 0);
});

test('expired code and dead connection fail the exchange', async () => {
  resetStores();
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}`;

  const code = await issueCode();
  stores.OAuthAuthorizationCode.docs[0].expiresAt = new Date(Date.now() - 1000);
  let res = await tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic });
  assert.equal((await res.json()).error, 'invalid_grant');

  const code2 = await issueCode();
  stores.SpaceConnection.docs[0].status = 'revoked';
  res = await tokenPost({ code2, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic });
  assert.equal((await res.json()).error, 'invalid_grant');
  stores.SpaceConnection.docs[0].status = 'active';
});

test('native client works without a secret and rejects one', async () => {
  resetStores();
  const code = await issueCode({ appId: APP_ID_2, redirect: 'com.acme.app:/callback' });
  const res = await tokenPost({ code, redirect_uri: 'com.acme.app:/callback', client_id: APP_ID_2 });
  assert.equal(res.status, 200);

  const code2 = await issueCode({ appId: APP_ID_2, redirect: 'com.acme.app:/callback' });
  const bad = await tokenPost(
    { code: code2, redirect_uri: 'com.acme.app:/callback', client_id: APP_ID_2, client_secret: 'x' },
  );
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get('www-authenticate'), /Basic/);
});

test('concurrent exchange has a single winner', async () => {
  resetStores();
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}`;
  const code = await issueCode();
  const [a, b] = await Promise.all([
    tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic }),
    tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, { authorization: basic }),
  ]);
  const results = [a.status, b.status].sort();
  assert.deepEqual(results, [200, 400]);
});

// ---------- userinfo / revoke ----------

test('userinfo returns scoped claims; revoked connection or consent bump → 401', async () => {
  resetStores();
  const conn = { connectionId: 'conn_1', userId: USER_ID, appId: APP_ID, partnerId: 'p-1', status: 'active', consentVersion: 2, scopes: ['openid', 'email', 'sync_id'], subject: 's', environment: 'live', connectedAt: new Date() };
  stores.SpaceConnection.docs.push(conn);
  const { digestSecret } = require('../utils/syncSpaceCrypto');
  const raw = 'sat_' + crypto.randomBytes(32).toString('base64url');
  await stores.OAuthAccessToken.create({
    tokenId: 'satid_1', tokenHash: digestSecret(raw), appId: APP_ID, userId: USER_ID,
    connectionId: 'conn_1', consentVersion: 2, scopes: ['openid', 'email', 'sync_id'],
    expiresAt: new Date(Date.now() + 3600_000),
  });
  let res = await get('/userinfo', { authorization: `Bearer ${raw}` });
  assert.equal(res.status, 200);
  const claims = await res.json();
  assert.equal(claims.email, 'maya@example.com');
  assert.equal(claims.email_verified, true);
  assert.equal(claims.sync_id, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.equal(claims.phone_number, undefined); // not in scope
  const { pairwiseSubject } = require('../utils/syncSpaceCrypto');
  assert.equal(claims.sub, pairwiseSubject(APP_ID, USER_ID));

  // missing token
  res = await get('/userinfo');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /invalid_token/);

  // consent version bump invalidates
  conn.consentVersion = 3;
  res = await get('/userinfo', { authorization: `Bearer ${raw}` });
  assert.equal(res.status, 401);
  conn.consentVersion = 2;

  // connection revoked
  conn.status = 'revoked';
  res = await get('/userinfo', { authorization: `Bearer ${raw}` });
  assert.equal(res.status, 401);
  conn.status = 'active';

  // suspended profile → invalid_token
  stores.SyncSpaceProfile.docs[0].status = 'suspended';
  res = await get('/userinfo', { authorization: `Bearer ${raw}` });
  assert.equal(res.status, 401);
  stores.SyncSpaceProfile.docs[0].status = 'active';
});

test('revoke endpoint revokes client tokens and always 200s', async () => {
  resetStores();
  const { digestSecret, encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}`;
  const raw = 'sat_' + crypto.randomBytes(32).toString('base64url');
  await stores.OAuthAccessToken.create({
    tokenId: 'satid_1', tokenHash: digestSecret(raw), appId: APP_ID, userId: USER_ID,
    connectionId: 'c', consentVersion: 1, scopes: ['openid'], expiresAt: new Date(Date.now() + 3600_000),
  });
  const res = await post('/revoke', { token: raw }, { authorization: basic });
  assert.equal(res.status, 200);
  assert.ok(stores.OAuthAccessToken.docs[0].revokedAt);
  // unknown token → still 200
  const again = await post('/revoke', { token: 'sat_nope' }, { authorization: basic });
  assert.equal(again.status, 200);
});

// ---------- redirect URI registration rules ----------

test('redirect URI registration enforces scheme, fragment and count rules', async () => {
  const mk = (app) => loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': { findOne: () => chain({ partnerId: 'p-1', approvalStatus: 'sandbox', emailVerifiedAt: new Date() }) },
    '../models/PartnerApp': {
      findOne: () => chain(app),
      findOneAndUpdate: (q, u) => chain({ ...app, ...(u.$set || {}) }),
    },
    '../models/PartnerApiKey': {},
    '../models/PartnerEmailChallenge': {},
    '../models/PartnerWebhookDelivery': {},
    '../models/SpaceConnection': {},
    '../models/SyncSpaceProfile': {},
    './emailService': {},
    './partnerWebhooks': {},
    bcryptjs: { hash: async () => 'h', compare: async () => false },
  });
  const base = { ...webApp, environment: 'sandbox' };

  const update = async (uris, app = base) =>
    mk(app).updateApp('p-1', app.appId, { redirectUris: uris });

  // web: https ok, loopback http ok in sandbox, non-loopback http rejected
  await assert.rejects(update(['http://app.acme.com/cb']), { statusCode: 400 });
  const ok = await update(['https://app.acme.com/cb', 'http://localhost:3000/cb']);
  assert.deepEqual(ok.redirectUris.length, 2);
  // fragments rejected
  await assert.rejects(update(['https://app.acme.com/cb#frag']), { statusCode: 400 });
  // live web: loopback http rejected
  await assert.rejects(update(['http://localhost:3000/cb'], { ...base, environment: 'live' }), { statusCode: 400 });
  // native: dotted private-use scheme ok, bare scheme rejected
  const native = { ...base, applicationType: 'native' };
  const okNative = await update(['com.acme.app:/cb', 'https://app.acme.com/cb'], native);
  assert.deepEqual(okNative.redirectUris.length, 2);
  await assert.rejects(update(['acmeapp:/cb'], native), { statusCode: 400 });
  // max 10
  const tooMany = Array.from({ length: 11 }, (_, i) => `https://app${i}.example.com/cb`);
  await assert.rejects(update(tooMany), { statusCode: 400 });
});

// ---------- portal identity-field configuration ----------

test('setIdentityFields validates scopes, uniqueness and the required flag', async () => {
  const mk = (app) => loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': { findOne: () => chain({ partnerId: 'p-1', approvalStatus: 'sandbox', emailVerifiedAt: new Date() }) },
    '../models/PartnerApp': {
      findOne: () => chain(app),
      findOneAndUpdate: (q, u) => chain({ ...app, ...(u.$set || {}) }),
    },
    '../models/PartnerApiKey': {},
    '../models/PartnerEmailChallenge': {},
    '../models/PartnerWebhookDelivery': {},
    '../models/SpaceConnection': {},
    '../models/SyncSpaceProfile': {},
    './emailService': {},
    './partnerWebhooks': {},
    bcryptjs: { hash: async () => 'h', compare: async () => false },
  });
  const app = { ...webApp, environment: 'sandbox' };
  const svc = mk(app);

  await assert.rejects(svc.setIdentityFields('p-1', app.appId, 'phone'), { statusCode: 400 });
  await assert.rejects(svc.setIdentityFields('p-1', app.appId, [{ scope: 'email', required: true }]), { statusCode: 400 });
  await assert.rejects(svc.setIdentityFields('p-1', app.appId, [{ scope: 'phone' }]), { statusCode: 400 });
  await assert.rejects(svc.setIdentityFields('p-1', app.appId, [
    { scope: 'phone', required: true }, { scope: 'phone', required: false },
  ]), { statusCode: 400 });
  const saved = await svc.setIdentityFields('p-1', app.appId, [
    { scope: 'phone', required: true },
    { scope: 'picture', required: false },
  ]);
  assert.deepEqual(saved.identityFields, [
    { scope: 'phone', required: true },
    { scope: 'picture', required: false },
  ]);
});

// ---------- refresh tokens & late-usability gates ----------

const seedWebSecret = () => {
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  stores.PartnerApp.docs[0].clientSecretEncrypted = encryptSecret('sekret', `client:${APP_ID}`);
  return { authorization: `Basic ${Buffer.from(`${encodeURIComponent(APP_ID)}:${encodeURIComponent('sekret')}`).toString('base64')}` };
};

const exchangeOfflineCode = async () => {
  const basic = seedWebSecret();
  const conn = {
    connectionId: 'conn_off', userId: USER_ID, appId: APP_ID, partnerId: 'p-1',
    status: 'active', consentVersion: 1, scopes: ['openid', 'profile', 'offline_access'],
    subject: 's', environment: 'live', connectedAt: new Date(),
  };
  stores.SpaceConnection.docs.push(conn);
  const code = await issueCode({ scopes: ['openid', 'profile', 'offline_access'] });
  const res = await tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, basic);
  assert.equal(res.status, 200);
  return { basic, conn, body: await res.json() };
};

const refreshPost = (token, extra = {}, headers) =>
  post('/token', { grant_type: 'refresh_token', refresh_token: token, ...extra }, headers);

test('offline_access issues a refresh token; discovery advertises the grant', async () => {
  resetStores();
  const { body } = await exchangeOfflineCode();
  assert.match(body.refresh_token, /^srt_/);
  assert.equal(stores.OAuthRefreshToken.docs.length, 1);
  assert.equal(stores.OAuthAccessToken.docs[0].familyId, stores.OAuthRefreshToken.docs[0].familyId);

  // without offline_access there is no refresh token
  const code2 = await issueCode({ scopes: ['openid'] });
  const res2 = await tokenPost({ code: code2, redirect_uri: 'https://app.acme.com/cb' }, seedWebSecret());
  const body2 = await res2.json();
  assert.equal(body2.refresh_token, undefined);

  const disco = await (await get('/.well-known/openid-configuration')).json();
  assert.ok(disco.grant_types_supported.includes('refresh_token'));
  assert.ok(disco.scopes_supported.includes('offline_access'));
});

test('refresh rotation issues new tokens in the same family; reuse revokes it all', async () => {
  resetStores();
  const { basic, body } = await exchangeOfflineCode();
  const refresh1 = body.refresh_token;
  const access1 = body.access_token;

  const res = await refreshPost(refresh1, {}, basic);
  assert.equal(res.status, 200);
  const rotated = await res.json();
  assert.match(rotated.refresh_token, /^srt_/);
  assert.notEqual(rotated.refresh_token, refresh1);
  // id_token present, no nonce claim
  const payload = JSON.parse(Buffer.from(rotated.id_token.split('.')[1], 'base64url').toString());
  assert.equal(payload.nonce, undefined);
  assert.equal(stores.OAuthRefreshToken.docs.length, 2);
  assert.equal(stores.OAuthRefreshToken.docs[1].familyId, stores.OAuthRefreshToken.docs[0].familyId);

  // replaying the consumed refresh token → invalid_grant + family + access revoked
  const replay = await refreshPost(refresh1, {}, basic);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');
  assert.ok(stores.OAuthRefreshToken.docs.every((d) => d.revokedAt));
  assert.ok(stores.OAuthAccessToken.docs.every((d) => d.revokedAt));
  // access token via userinfo now dead
  const ui = await get('/userinfo', { authorization: `Bearer ${access1}` });
  assert.equal(ui.status, 401);
  // the rotated token is also dead (family revoked)
  const replay2 = await refreshPost(rotated.refresh_token, {}, basic);
  assert.equal(replay2.status, 400);
});

test('refresh may only narrow scope; expired/family-expired/revoked-conn fail', async () => {
  resetStores();
  const { basic, body, conn } = await exchangeOfflineCode();
  const rt = body.refresh_token;

  // widening → invalid_scope
  const wide = await refreshPost(rt, { scope: 'openid profile phone' }, basic);
  assert.equal(wide.status, 400);
  assert.equal((await wide.json()).error, 'invalid_scope');

  // narrowing works
  const narrow = await refreshPost(rt, { scope: 'openid' }, basic);
  assert.equal(narrow.status, 200);
  const narrowed = await narrow.json();
  assert.equal(narrowed.scope, 'openid');
  assert.equal(stores.OAuthAccessToken.docs.at(-1).scopes.join(' '), 'openid');

  // expired refresh → invalid_grant
  const expiredRt = crypto.randomBytes(32).toString('base64url');
  await stores.OAuthRefreshToken.create({
    tokenHash: crypto.createHash('sha256').update(`srt_x${expiredRt}`).digest('hex'),
    familyId: 'fam_x', appId: APP_ID, userId: USER_ID, connectionId: conn.connectionId,
    consentVersion: conn.consentVersion, scopes: ['openid'],
    expiresAt: new Date(Date.now() - 1000), familyExpiresAt: new Date(Date.now() + 86400_000),
  });
  const dead = await refreshPost(`srt_x${expiredRt}`, {}, basic);
  assert.equal(dead.status, 400);

  // revoked connection → invalid_grant
  const fresh = await stores.OAuthRefreshToken.create({
    tokenHash: crypto.createHash('sha256').update('srt_live').digest('hex'),
    familyId: 'fam_y', appId: APP_ID, userId: USER_ID, connectionId: conn.connectionId,
    consentVersion: conn.consentVersion, scopes: ['openid'],
    expiresAt: new Date(Date.now() + 86400_000), familyExpiresAt: new Date(Date.now() + 86400_000),
  });
  conn.status = 'revoked';
  const badConn = await refreshPost('srt_live', {}, basic);
  assert.equal(badConn.status, 400);
  conn.status = 'active';
});

test('appUsable gates exchange, refresh and userinfo', async () => {
  resetStores();
  const basic = seedWebSecret();
  const code = await issueCode();
  // partner suspended → invalid_grant at code exchange
  stores.PartnerAccount.docs[0].approvalStatus = 'suspended';
  let res = await tokenPost({ code, redirect_uri: 'https://app.acme.com/cb' }, basic);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');

  // live app but partner only sandbox-approved → invalid_grant
  stores.PartnerAccount.docs[0].approvalStatus = 'sandbox';
  const code2 = await issueCode();
  res = await tokenPost({ code: code2, redirect_uri: 'https://app.acme.com/cb' }, basic);
  assert.equal(res.status, 400);
  stores.PartnerAccount.docs[0].approvalStatus = 'approved';

  // userinfo also refuses when the partner later gets suspended
  const conn = { connectionId: 'conn_1', userId: USER_ID, appId: APP_ID, partnerId: 'p-1', status: 'active', consentVersion: 1, scopes: ['openid'], subject: 's', environment: 'live', connectedAt: new Date() };
  stores.SpaceConnection.docs.push(conn);
  const { digestSecret } = require('../utils/syncSpaceCrypto');
  const raw = 'sat_' + crypto.randomBytes(32).toString('base64url');
  await stores.OAuthAccessToken.create({
    tokenId: 'satid_u', tokenHash: digestSecret(raw), appId: APP_ID, userId: USER_ID,
    connectionId: 'conn_1', consentVersion: 1, scopes: ['openid'],
    expiresAt: new Date(Date.now() + 3600_000),
  });
  assert.equal((await get('/userinfo', { authorization: `Bearer ${raw}` })).status, 200);
  stores.PartnerAccount.docs[0].approvalStatus = 'suspended';
  assert.equal((await get('/userinfo', { authorization: `Bearer ${raw}` })).status, 401);
  stores.PartnerAccount.docs[0].approvalStatus = 'approved';
});

test('revoking a refresh token kills the whole family', async () => {
  resetStores();
  const { basic, body } = await exchangeOfflineCode();
  // rotate once so two refresh tokens share the family
  const rotated = await (await refreshPost(body.refresh_token, {}, basic)).json();

  const res = await post('/revoke', { token: rotated.refresh_token }, basic);
  assert.equal(res.status, 200);
  assert.ok(stores.OAuthRefreshToken.docs.every((d) => d.revokedAt));
  assert.ok(stores.OAuthAccessToken.docs.every((d) => d.revokedAt));
});

// ---------- field-level sharing ----------

test('authorize rejects extra scopes the app did not configure; configured ones pass', async () => {
  resetStores();
  sessionState = {};
  stores.PartnerApp.docs[0].requestedScopes = ['openid', 'profile', 'email', 'phone', 'picture'];
  stores.PartnerApp.docs[0].identityFields = [{ scope: 'phone', required: true }];
  // 'picture' is in requestedScopes but NOT configured → invalid_scope
  let res = await get(authorizePath({ scope: 'openid picture' }));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.searchParams.get('error'), 'invalid_scope');
  // configured extra → passes on to login
  res = await get(authorizePath({ scope: 'openid phone' }));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/oauth/login');
  // legacy app with no identityFields config → any extra is optional
  stores.PartnerApp.docs[0].identityFields = [];
  res = await get(authorizePath({ scope: 'openid picture' }));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/oauth/login');
});

test('consent shows locked/required/optional sections and policy defaults', async () => {
  resetStores();
  stores.PartnerApp.docs[0].requestedScopes = ['openid', 'profile', 'email', 'phone', 'birthdate', 'sync_id'];
  stores.PartnerApp.docs[0].identityFields = [
    { scope: 'phone', required: true },
    { scope: 'birthdate', required: false },
    { scope: 'sync_id', required: false },
  ];
  // phone policy 'never' (required → needs override), birthdate 'allow' (checked),
  // sync_id 'ask' (unchecked)
  stores.SyncSpaceProfile.docs[0].sharingPolicy = { phone: 'never', birthdate: 'allow', sync_id: 'ask' };
  sessionState = { oauthUserId: USER_ID };
  const res = await get(authorizePath({ scope: 'openid profile phone birthdate sync_id' }));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Always shared/);
  assert.match(html, /Required by Acme Orders/);
  assert.match(html, /You chose never to share this/);
  assert.match(html, /name="share_once_phone"/);
  assert.match(html, /value="birthdate"\s*checked/);        // allow → checked
  assert.match(html, /value="sync_id"(?!\s*checked)/);      // ask → unchecked
});

test('required field under a never policy needs the share-once override; policy unchanged', async () => {
  resetStores();
  stores.PartnerApp.docs[0].requestedScopes = ['openid', 'profile', 'email', 'phone'];
  stores.PartnerApp.docs[0].identityFields = [{ scope: 'phone', required: true }];
  stores.SyncSpaceProfile.docs[0].sharingPolicy = { phone: 'never' };
  sessionState = { oauthUserId: USER_ID };
  await get(authorizePath({ scope: 'openid profile phone' }));
  // approve without the override → 400 re-render
  const bad = await post('/consent', { _csrf: sessionState.csrfToken, decision: 'approve' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Share once/);
  assert.equal(stores.SpaceConnection.docs.length, 0);
  // with the override → granted, and the global policy stays 'never'
  const ok = await post('/consent', {
    _csrf: sessionState.csrfToken,
    decision: 'approve',
    share_once_phone: 'on',
  });
  assert.equal(ok.status, 302);
  const conn = stores.SpaceConnection.docs[0];
  assert.ok(conn.scopes.includes('phone'));
  assert.deepEqual(conn.requiredScopes.sort(), ['email', 'openid', 'phone', 'profile'].sort());
  assert.equal(stores.SyncSpaceProfile.docs[0].sharingPolicy.phone, 'never');
});

test('optional unchecked extras are not granted; mandatory always are', async () => {
  resetStores();
  stores.PartnerApp.docs[0].requestedScopes = ['openid', 'profile', 'email', 'gender'];
  stores.PartnerApp.docs[0].identityFields = [{ scope: 'gender', required: false }];
  stores.SyncSpaceProfile.docs[0].sharingPolicy = { gender: 'ask' };
  sessionState = { oauthUserId: USER_ID };
  await get(authorizePath({ scope: 'openid gender' }));
  const res = await post('/consent', { _csrf: sessionState.csrfToken, decision: 'approve' });
  assert.equal(res.status, 302);
  const conn = stores.SpaceConnection.docs[0];
  assert.ok(!conn.scopes.includes('gender'));           // unchecked 'ask' → not granted
  assert.deepEqual(conn.scopes.sort(), ['email', 'openid', 'profile'].sort()); // mandatory always in
});

test('a user with no email sees the blocking notice and cannot approve', async () => {
  resetStores();
  stores.User.docs[0].email = '';
  sessionState = { oauthUserId: USER_ID };
  const res = await get(authorizePath());
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /Add an email to your Syncup account/);
  assert.ok(!html.includes('value="approve"'));
  // POST approve is still blocked server-side
  const post2 = await post('/consent', { _csrf: sessionState.csrfToken, decision: 'approve' });
  assert.notEqual(post2.status, 302);
  assert.equal(stores.SpaceConnection.docs.length, 0);
});

test('consent-skip path also requires an email (existing connection)', async () => {
  resetStores();
  sessionState = { oauthUserId: USER_ID };
  // First sign-in with an email creates the connection.
  await get(authorizePath());
  await post('/consent', { _csrf: sessionState.csrfToken, decision: 'approve' });
  assert.equal(stores.SpaceConnection.docs.length, 1);
  // Email removed later → re-sign-in must not silently skip consent.
  stores.User.docs[0].email = '';
  const res = await get(authorizePath());
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Add an email to your Syncup account/);
});

test('claimsFor emits only granted extra claims and never decrypts profile photos', async () => {
  const provider = require('../services/oidcProvider');
  const user = {
    userId: 'u1', name: 'Maya Rao', username: 'maya',
    email: 'maya@x.com', emailVerified: true, phoneNumber: '9876543210',
    profileImage: 'https://cdn.example.com/p.png', profileImageEncrypted: false,
    dateOfBirth: new Date('1990-01-02T00:00:00Z'), gender: 'female',
  };
  const profile = { syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' };
  const all = provider.claimsFor(
    user, profile, ['openid', 'profile', 'email', 'phone', 'sync_id', 'picture', 'birthdate', 'gender'], 'sub1');
  assert.equal(all.picture, 'https://cdn.example.com/p.png');
  assert.equal(all.birthdate, '1990-01-02');
  assert.equal(all.gender, 'female');
  assert.equal(all.phone_number, '9876543210');
  assert.equal(all.sync_id, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  const minimal = provider.claimsFor(user, profile, ['openid', 'profile', 'email'], 'sub1');
  for (const key of ['picture', 'birthdate', 'gender', 'phone_number', 'sync_id']) {
    assert.equal(minimal[key], undefined, key);
  }
  // encrypted profile image → claim omitted, never decrypted for partners
  const enc = provider.claimsFor(
    { ...user, profileImage: 'encblob', profileImageEncrypted: true },
    profile, ['openid', 'picture'], 'sub1');
  assert.equal(enc.picture, undefined);
  // non-URL junk → omitted
  const junk = provider.claimsFor({ ...user, profileImage: 'not-a-url' }, profile, ['picture'], 's');
  assert.equal(junk.picture, undefined);
});

test('discovery advertises the new scopes and claims', async () => {
  const doc = await (await get('/.well-known/openid-configuration')).json();
  for (const s of ['picture', 'birthdate', 'gender']) {
    assert.ok(doc.scopes_supported.includes(s), s);
    assert.ok(doc.claims_supported.includes(s), s);
  }
});
