const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

process.env.SYNC_SPACE_DATA_KEY = 'ab'.repeat(32);

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

const fakeBcrypt = {
  hash: async (value) => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

const emailSpy = () => {
  const sent = [];
  return {
    sent,
    sendOTP: async (email, code, type) => {
      sent.push({ email, code, type });
      return { success: true, messageId: 'mock' };
    },
  };
};

const loadService = ({ PartnerAccount = {}, PartnerApp = {}, PartnerApiKey = {}, PartnerEmailChallenge = {}, email = emailSpy() } = {}) =>
  loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': PartnerAccount,
    '../models/PartnerApp': PartnerApp,
    '../models/PartnerApiKey': PartnerApiKey,
    '../models/PartnerEmailChallenge': PartnerEmailChallenge,
    './emailService': email,
    bcryptjs: fakeBcrypt,
  });

const partnerDoc = (overrides = {}) => ({
  _id: 'doc-1',
  partnerId: 'p-1',
  email: 'owner@example.com',
  businessName: 'Acme Inc',
  website: 'https://acme.example.com',
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  approvalStatus: 'sandbox',
  reviewVersion: 0,
  reviewReason: '',
  requestedAt: null,
  failedLoginAttempts: 0,
  lockUntil: null,
  sessionVersion: 0,
  passwordHash: 'hash:Sup3rSecret!',
  ...overrides,
});

const appDoc = (overrides = {}) => ({
  appId: 'sp_' + 'ab'.repeat(16),
  partnerId: 'p-1',
  name: 'Orders App',
  kind: 'business',
  applicationType: 'service',
  environment: 'sandbox',
  website: '',
  requestedScopes: ['space.messages'],
  redirectUris: [],
  status: 'active',
  secretVersion: 0,
  clientSecretEncrypted: undefined,
  sandboxUserIds: [],
  ...overrides,
});

test('createPartner normalizes input, stores only a password hash, and emails a challenge', async () => {
  const email = emailSpy();
  const captured = { create: null, challenge: null };
  const service = loadService({
    PartnerAccount: {
      findOne: () => chain(null),
      create: async (doc) => { captured.create = doc; return partnerDoc({ ...doc, partnerId: 'p-1' }); },
    },
    PartnerEmailChallenge: {
      find: () => chain([]),
      updateMany: async () => ({}),
      create: async (doc) => { captured.challenge = doc; return { ...doc, challengeId: 'ch-1' }; },
    },
    email,
  });
  const result = await service.createPartner({
    email: '  Owner@Example.COM ',
    password: 'a-very-long-password',
    businessName: ' Acme Inc ',
    website: 'https://acme.example.com',
  });
  assert.equal(captured.create.email, 'owner@example.com');
  assert.equal(captured.create.businessName, 'Acme Inc');
  assert.equal(captured.create.passwordHash, 'hash:a-very-long-password');
  assert.equal(captured.create.password, undefined);
  assert.equal(captured.create.approvalStatus, 'sandbox');
  assert.equal(captured.challenge.purpose, 'verify');
  assert.equal(captured.challenge.codeHash, `hash:${email.sent[0].code}`);
  assert.match(email.sent[0].code, /^\d{6}$/);
  assert.equal(email.sent[0].email, 'owner@example.com');
  assert.equal(result.challengeId, 'ch-1');
  assert.equal(result.emailSent, true);
  assert.equal(Object.hasOwn(result.partner, 'passwordHash'), false);
  assert.equal(Object.hasOwn(result.partner, 'sessionVersion'), false);
});

test('createPartner rejects malformed input before touching storage', async () => {
  let queries = 0;
  const service = loadService({
    PartnerAccount: {
      findOne: () => { queries += 1; return chain(null); },
      create: async () => ({}),
    },
  });
  const base = { email: 'a@b.co', password: 'long-enough-password', businessName: 'Acme' };
  for (const body of [
    { ...base, email: ['a@b.co'] },
    { ...base, email: 'not-an-email' },
    { ...base, email: { value: 'a@b.co' } },
    { ...base, password: 'short' },
    { ...base, password: 'x'.repeat(129) },
    { ...base, password: 123456789012 },
    { ...base, businessName: '' },
    { ...base, businessName: 'x'.repeat(121) },
    { ...base, businessName: ['Acme'] },
    { ...base, website: 'http://example.com' },
    { ...base, website: 'javascript:alert(1)' },
    { ...base, website: ['https://x.co'] },
  ]) {
    await assert.rejects(service.createPartner(body), { statusCode: 400 }, JSON.stringify(body));
  }
  assert.equal(queries, 0);
  await assert.rejects(service.createPartner(null), { statusCode: 400 });
});

test('createPartner rejects duplicate email and still reports email failures as retryable', async () => {
  const existing = loadService({
    PartnerAccount: { findOne: () => chain({ _id: 'dup' }) },
  });
  await assert.rejects(
    existing.createPartner({ email: 'a@b.co', password: 'long-enough-password', businessName: 'Acme' }),
    { statusCode: 409 }
  );

  const failingMail = { sendOTP: async () => ({ success: false, error: 'smtp down' }) };
  const service = loadService({
    PartnerAccount: {
      findOne: () => chain(null),
      create: async (doc) => partnerDoc(doc),
    },
    PartnerEmailChallenge: {
      find: () => chain([]),
      updateMany: async () => ({}),
      create: async (doc) => ({ ...doc, challengeId: 'ch-9' }),
    },
    email: failingMail,
  });
  const result = await service.createPartner({
    email: 'a@b.co', password: 'long-enough-password', businessName: 'Acme',
  });
  assert.equal(result.emailSent, false);
  assert.equal(result.challengeId, 'ch-9');
});

const challengeStore = ({ partnerId = 'p-1', purpose = 'verify', codeHash = 'hash:123456', attempts = 0, expiresIn = 600000 }) => {
  const doc = {
    _id: 'c-1',
    challengeId: 'cd'.repeat(32),
    partnerId,
    purpose,
    codeHash,
    attempts,
    consumedAt: null,
    expiresAt: new Date(Date.now() + expiresIn),
  };
  const updates = [];
  const model = {
    doc,
    updates,
    findOneAndUpdate: (query, update) => {
      updates.push({ query, update });
      if (update.$inc && update.$inc.attempts) {
        const valid =
          query.challengeId === doc.challengeId &&
          query.purpose === doc.purpose &&
          doc.consumedAt === null &&
          doc.attempts < 5 &&
          doc.expiresAt > query.expiresAt.$gt;
        if (!valid) return chain(null);
        doc.attempts += 1;
        return chain({ ...doc });
      }
      if (update.$set && update.$set.consumedAt) {
        if (doc.consumedAt !== null) return chain(null);
        doc.consumedAt = new Date();
        return chain({ ...doc });
      }
      return chain(null);
    },
  };
  return model;
};

test('verifyPartnerEmail consumes a valid challenge and marks the account verified', async () => {
  const store = challengeStore({});
  let accountUpdate = null;
  const service = loadService({
    PartnerAccount: {
      findOneAndUpdate: (query, update) => {
        accountUpdate = { query, update };
        return chain(partnerDoc({ emailVerifiedAt: update.$set.emailVerifiedAt }));
      },
    },
    PartnerEmailChallenge: store,
  });
  const result = await service.verifyPartnerEmail({
    challengeId: store.doc.challengeId,
    code: '123456',
  });
  assert.equal(result.emailVerified, true);
  assert.equal(store.doc.consumedAt !== null, true);
  assert.equal(accountUpdate.query.partnerId, 'p-1');
  assert.ok(accountUpdate.update.$set.emailVerifiedAt instanceof Date);
});

test('challenges fail closed on wrong code, expiry, replay, exhaustion, and races', async () => {
  const wrong = challengeStore({});
  const svcWrong = loadService({ PartnerEmailChallenge: wrong });
  await assert.rejects(
    svcWrong.verifyPartnerEmail({ challengeId: wrong.doc.challengeId, code: '000000' }),
    { statusCode: 400 }
  );
  assert.equal(wrong.doc.attempts, 1);
  assert.equal(wrong.doc.consumedAt, null);

  const expired = challengeStore({ expiresIn: -1000 });
  const svcExpired = loadService({ PartnerEmailChallenge: expired });
  await assert.rejects(
    svcExpired.verifyPartnerEmail({ challengeId: expired.doc.challengeId, code: '123456' }),
    { statusCode: 400 }
  );

  const raced = challengeStore({});
  const svcRaced = loadService({
    PartnerAccount: { findOneAndUpdate: () => chain(partnerDoc()) },
    PartnerEmailChallenge: raced,
  });
  const results = await Promise.allSettled([
    svcRaced.verifyPartnerEmail({ challengeId: raced.doc.challengeId, code: '123456' }),
    svcRaced.verifyPartnerEmail({ challengeId: raced.doc.challengeId, code: '123456' }),
  ]);
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(okCount, 1);

  const exhausted = challengeStore({ attempts: 5 });
  const svcExhausted = loadService({ PartnerEmailChallenge: exhausted });
  await assert.rejects(
    svcExhausted.verifyPartnerEmail({ challengeId: exhausted.doc.challengeId, code: '123456' }),
    { statusCode: 400 }
  );

  const malformed = loadService({ PartnerEmailChallenge: challengeStore({}) });
  for (const bad of [
    { challengeId: 'nope', code: '123456' },
    { challengeId: 'cd'.repeat(32), code: 'abcdef' },
    { challengeId: ['x'], code: '123456' },
    { challengeId: 'cd'.repeat(32), code: '12345' },
  ]) {
    await assert.rejects(malformed.verifyPartnerEmail(bad), { statusCode: 400 });
  }
});

test('resendChallenge enforces cooldown and hourly caps and invalidates prior codes', async () => {
  const recent = { sentAt: new Date(Date.now() - 10 * 1000) };
  const limited = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc({ emailVerifiedAt: null })) },
    PartnerEmailChallenge: {
      findOne: () => chain({ challengeId: 'cd'.repeat(32), partnerId: 'p-1', purpose: 'verify' }),
      find: () => chain([recent]),
      updateMany: async () => ({}),
      create: async (doc) => doc,
    },
  });
  await assert.rejects(
    limited.resendChallenge({ challengeId: 'cd'.repeat(32), purpose: 'verify' }),
    { statusCode: 429 }
  );

  const hourly = Array.from({ length: 5 }, (_, i) => ({
    sentAt: new Date(Date.now() - (i + 2) * 61 * 1000),
  }));
  const capped = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc({ emailVerifiedAt: null })) },
    PartnerEmailChallenge: {
      findOne: () => chain({ challengeId: 'cd'.repeat(32), partnerId: 'p-1', purpose: 'verify' }),
      find: () => chain(hourly),
      updateMany: async () => ({}),
      create: async (doc) => doc,
    },
  });
  await assert.rejects(
    capped.resendChallenge({ challengeId: 'cd'.repeat(32), purpose: 'verify' }),
    { statusCode: 429 }
  );

  let invalidated = null;
  const email = emailSpy();
  const ok = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc({ emailVerifiedAt: null })) },
    PartnerEmailChallenge: {
      findOne: () => chain({ challengeId: 'cd'.repeat(32), partnerId: 'p-1', purpose: 'verify' }),
      find: () => chain([]),
      updateMany: async (filter, update) => { invalidated = { filter, update }; return {}; },
      create: async (doc) => ({ ...doc, challengeId: 'ef'.repeat(32) }),
    },
    email,
  });
  const result = await ok.resendChallenge({ challengeId: 'cd'.repeat(32), purpose: 'verify' });
  assert.equal(result.challengeId, 'ef'.repeat(32));
  assert.deepEqual(invalidated.filter, { partnerId: 'p-1', purpose: 'verify', consumedAt: null });
  assert.equal(email.sent.length, 1);
});

test('authenticatePartner is generic for bad input and locks after 5 failures', async () => {
  const updates = [];
  const account = partnerDoc({ emailVerifiedAt: null, passwordHash: 'hash:right-password' });
  const service = loadService({
    PartnerAccount: {
      findOne: () => chain(account),
      updateOne: async (query, update) => { updates.push(update); },
    },
  });
  for (const [email, password] of [
    ['not-an-email', 'x'],
    [['a@b.co'], 'x'],
    ['owner@example.com', 'wrong-password'],
    ['unknown@example.com', 'x'],
  ]) {
    const svc = email === 'unknown@example.com'
      ? loadService({ PartnerAccount: { findOne: () => chain(null), updateOne: async () => {} } })
      : service;
    await assert.rejects(svc.authenticatePartner(email, password), { statusCode: 401, message: 'Invalid email or password' });
  }
  assert.deepEqual(updates[0].$set, { failedLoginAttempts: 1 });

  const fourFailures = [];
  const nearLock = partnerDoc({ failedLoginAttempts: 4, passwordHash: 'hash:right-password' });
  const lockService = loadService({
    PartnerAccount: {
      findOne: () => chain(nearLock),
      updateOne: async (query, update) => { fourFailures.push(update); },
    },
  });
  await assert.rejects(lockService.authenticatePartner('owner@example.com', 'bad'), { statusCode: 401 });
  assert.ok(fourFailures[0].$set.lockUntil instanceof Date);
  assert.equal(fourFailures[0].$set.failedLoginAttempts, 0);

  const locked = partnerDoc({ lockUntil: new Date(Date.now() + 60000) });
  const lockedService = loadService({
    PartnerAccount: { findOne: () => chain(locked), updateOne: async () => {} },
  });
  await assert.rejects(lockedService.authenticatePartner('owner@example.com', 'right-password'), { statusCode: 429 });

  const cleared = [];
  const success = loadService({
    PartnerAccount: {
      findOne: () => chain(partnerDoc({ failedLoginAttempts: 2, passwordHash: 'hash:right-password' })),
      updateOne: async (query, update) => { cleared.push(update); },
    },
  });
  const authed = await success.authenticatePartner('owner@example.com', 'right-password');
  assert.equal(authed.partnerId, 'p-1');
  assert.deepEqual(cleared[0].$set, { failedLoginAttempts: 0, lockUntil: null });
});

test('password reset is generic for unknown emails and bumps sessionVersion on success', async () => {
  const resetChallenge = challengeStore({ purpose: 'reset' });
  let accountUpdate = null;
  const service = loadService({
    PartnerAccount: {
      findOne: () => chain(null),
      findOneAndUpdate: (query, update) => {
        accountUpdate = { query, update };
        return chain(partnerDoc());
      },
    },
    PartnerEmailChallenge: resetChallenge,
    email: emailSpy(),
  });
  assert.deepEqual(await service.requestPasswordReset('nobody@example.com'), { ok: true });
  const done = await service.resetPassword({
    challengeId: resetChallenge.doc.challengeId,
    code: '123456',
    password: 'brand-new-password-1',
  });
  assert.equal(done.partnerId, 'p-1');
  assert.equal(accountUpdate.update.$set.passwordHash, 'hash:brand-new-password-1');
  assert.deepEqual(accountUpdate.update.$inc, { sessionVersion: 1 });
  assert.equal(accountUpdate.update.$set.lockUntil, null);
  await assert.rejects(
    service.resetPassword({ challengeId: 'x', code: '123456', password: 'short' }),
    { statusCode: 400 }
  );
});

test('createApp enforces verification, approval, and redirect-URI rules', async () => {
  const build = (partner, captures = {}) => loadService({
    PartnerAccount: { findOne: () => chain(partner) },
    PartnerApp: { create: async (doc) => { captures.doc = doc; return doc; } },
  });

  const unverified = build(partnerDoc({ emailVerifiedAt: null }));
  await assert.rejects(
    unverified.createApp('p-1', { name: 'x', kind: 'app', applicationType: 'service' }),
    { statusCode: 403, code: 'PARTNER_EMAIL_UNVERIFIED' }
  );

  const suspended = build(partnerDoc({ approvalStatus: 'suspended' }));
  await assert.rejects(
    suspended.createApp('p-1', { name: 'x', kind: 'app', applicationType: 'service' }),
    { statusCode: 403, code: 'PARTNER_SUSPENDED' }
  );

  const liveBlocked = build(partnerDoc());
  await assert.rejects(
    liveBlocked.createApp('p-1', { name: 'x', kind: 'app', applicationType: 'service', environment: 'live' }),
    { statusCode: 403, code: 'PARTNER_NOT_APPROVED' }
  );

  const serviceCaps = {};
  const svc = build(partnerDoc(), serviceCaps);
  const serviceApp = await svc.createApp('p-1', {
    name: 'Backend job', kind: 'business', applicationType: 'service',
    redirectUris: ['https://ignored.example.com/cb'],
  });
  assert.deepEqual(serviceCaps.doc.redirectUris, []);
  assert.equal(serviceApp.clientSecret, null);
  assert.equal(serviceCaps.doc.clientSecretEncrypted, undefined);

  const webCaps = {};
  const web = build(partnerDoc(), webCaps);
  const webApp = await web.createApp('p-1', {
    name: 'Web app', kind: 'app', applicationType: 'web',
    redirectUris: ['https://app.example.com/callback', 'http://localhost:3000/cb'],
    requestedScopes: ['openid', 'space.messages'],
  });
  assert.match(webApp.app.appId, /^sp_[a-f0-9]{32}$/);
  assert.match(webApp.clientSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(webCaps.doc.clientSecretEncrypted.split('.').length, 3);
  assert.notEqual(webCaps.doc.clientSecretEncrypted, webApp.clientSecret);
  const { decryptSecret } = require('../utils/syncSpaceCrypto');
  assert.equal(
    decryptSecret(webCaps.doc.clientSecretEncrypted, `client:${webCaps.doc.appId}`),
    webApp.clientSecret
  );

  for (const badUri of [
    ['http://evil.example.com/cb'],
    ['https://app.example.com/cb#frag'],
    ['https://user:pw@app.example.com/cb'],
    Array.from({ length: 11 }, (_, i) => `https://r${i}.example.com/cb`),
  ]) {
    await assert.rejects(
      web.createApp('p-1', { name: 'w', kind: 'app', applicationType: 'web', redirectUris: badUri }),
      { statusCode: 400 },
      JSON.stringify(badUri)
    );
  }

  const nativeCaps = {};
  const native = build(partnerDoc(), nativeCaps);
  const nativeApp = await native.createApp('p-1', {
    name: 'Mobile', kind: 'app', applicationType: 'native',
    redirectUris: ['com.example.app:/oauth/callback', 'https://app.example.com/cb'],
  });
  assert.equal(nativeApp.clientSecret, null);
  assert.equal(nativeCaps.doc.clientSecretEncrypted, undefined);
  for (const bad of [['javascript:alert(1)'], ['data:text/html,x'], ['syncup://cb'], ['http://nonloop.example.com/cb'], ['myscheme:/cb']]) {
    await assert.rejects(
      native.createApp('p-1', { name: 'm', kind: 'app', applicationType: 'native', redirectUris: bad }),
      { statusCode: 400 },
      JSON.stringify(bad)
    );
  }

  await assert.rejects(
    svc.createApp('p-1', { name: 'x', kind: 'app', applicationType: 'service', requestedScopes: ['root.access'] }),
    { statusCode: 400 }
  );
});

test('updateApp uses an allowlist, blocks immutable fields, and bumps secretVersion on metadata change', async () => {
  const app = appDoc({ applicationType: 'web', environment: 'sandbox' });
  const captured = [];
  const service = loadService({
    PartnerAccount: {
      findOne: (query) => chain(query.partnerId === 'p-1' ? partnerDoc() : null),
    },
    PartnerApp: {
      findOne: (query) => { captured.push({ findOne: query }); return chain(query.partnerId === 'p-1' ? app : null); },
      findOneAndUpdate: (query, update, options) => {
        captured.push({ update });
        return chain({ ...app, ...update.$set, secretVersion: app.secretVersion + (update.$inc ? 1 : 0) });
      },
    },
  });
  for (const body of [
    { environment: 'live' },
    { kind: 'business' },
    { applicationType: 'service' },
    { status: 'disabled' },
    { partnerId: 'attacker' },
    { clientSecret: 'x' },
    { adminField: true },
  ]) {
    await assert.rejects(service.updateApp('p-1', app.appId, body), { statusCode: 400 }, JSON.stringify(body));
  }

  const renamed = await service.updateApp('p-1', app.appId, { name: 'New name' });
  assert.equal(renamed.name, 'New name');
  assert.deepEqual(captured.at(-1).update.$inc, undefined);

  const updated = await service.updateApp('p-1', app.appId, {
    redirectUris: ['https://app.example.com/new'],
  });
  assert.equal(updated.secretVersion, 1);

  await assert.rejects(service.updateApp('other', app.appId, { name: 'x' }), { statusCode: 404 });
  await assert.rejects(service.updateApp('p-1', app.appId, []), { statusCode: 400 });
});

test('createApiKey stores only a digest, shows the secret once, and enforces scope/approval gates', async () => {
  const app = appDoc({ requestedScopes: ['space.messages', 'space.codes'] });
  const captured = {};
  const service = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    PartnerApp: { findOne: () => chain(app) },
    PartnerApiKey: { create: async (doc) => { captured.doc = doc; return doc; } },
  });
  const result = await service.createApiKey('p-1', app.appId, { name: 'Backend', scopes: ['space.messages'] });
  assert.match(result.key, /^sk_test_[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(captured.doc.keyId, result.key.split('.')[0]);
  assert.equal(captured.doc.secretHash, crypto.createHash('sha256').update(result.key).digest('hex'));
  assert.equal(captured.doc.secretHash === result.key, false);
  assert.ok(captured.doc.expiresAt.getTime() > Date.now() + 89 * 24 * 60 * 60 * 1000);
  assert.equal(Object.hasOwn(result.record, 'secretHash'), false);
  assert.equal(result.record.keyId, captured.doc.keyId);

  for (const scopes of [['openid'], ['space.messages', 'space.receipts'], 'space.messages', []]) {
    await assert.rejects(
      service.createApiKey('p-1', app.appId, { name: 'k', scopes }),
      { statusCode: 400 },
      JSON.stringify(scopes)
    );
  }

  const disabled = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    PartnerApp: { findOne: () => chain(appDoc({ status: 'disabled' })) },
  });
  await assert.rejects(disabled.createApiKey('p-1', app.appId, { name: 'k' }), { statusCode: 403, code: 'PARTNER_APP_DISABLED' });

  const liveApp = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc({ approvalStatus: 'sandbox' })) },
    PartnerApp: { findOne: () => chain(appDoc({ environment: 'live' })) },
  });
  await assert.rejects(liveApp.createApiKey('p-1', app.appId, { name: 'k' }), { statusCode: 403, code: 'PARTNER_NOT_APPROVED' });
});

test('authenticateApiKey rejects malformed, revoked, expired, disabled, and suspended credentials', async () => {
  const token = `sk_test_${'ab'.repeat(6)}.${crypto.randomBytes(32).toString('base64url')}`;
  const keyId = token.split('.')[0];
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const build = ({ record, app, partner }) => loadService({
    PartnerApiKey: {
      findOne: (query) => chain(query.keyId === keyId ? record : null),
      updateOne: async () => ({}),
    },
    PartnerApp: { findOne: () => chain(app) },
    PartnerAccount: { findOne: () => chain(partner) },
  });
  const record = (overrides = {}) => ({
    _id: 'k-1', keyId, partnerId: 'p-1', appId: appDoc().appId,
    environment: 'sandbox', secretHash: hash, scopes: ['space.messages'],
    expiresAt: new Date(Date.now() + 100000), revokedAt: null, ...overrides,
  });
  const ok = build({ record: record(), app: appDoc(), partner: partnerDoc() });
  const result = await ok.authenticateApiKey(token);
  assert.equal(result.partner.partnerId, 'p-1');
  assert.equal(Object.hasOwn(result.partner, 'passwordHash'), false);

  for (const bad of ['nope', `sk_live_${'ab'.repeat(6)}.${'x'.repeat(43)}`, 42, null]) {
    await assert.rejects(ok.authenticateApiKey(bad), { statusCode: 401 });
  }
  await assert.rejects(
    build({ record: record({ revokedAt: new Date() }), app: appDoc(), partner: partnerDoc() }).authenticateApiKey(token),
    { statusCode: 401 }
  );
  await assert.rejects(
    build({ record: record({ expiresAt: new Date(Date.now() - 1000) }), app: appDoc(), partner: partnerDoc() }).authenticateApiKey(token),
    { statusCode: 401 }
  );
  await assert.rejects(
    build({ record: record(), app: appDoc({ status: 'disabled' }), partner: partnerDoc() }).authenticateApiKey(token),
    { statusCode: 401 }
  );
  await assert.rejects(
    build({ record: record(), app: appDoc(), partner: partnerDoc({ approvalStatus: 'suspended' }) }).authenticateApiKey(token),
    { statusCode: 401 }
  );
  await assert.rejects(
    build({ record: record({ environment: 'live' }), app: appDoc({ environment: 'live' }), partner: partnerDoc({ approvalStatus: 'sandbox' }) }).authenticateApiKey(token),
    { statusCode: 401 }
  );
  const liveOk = build({
    record: record({ environment: 'live' }),
    app: appDoc({ environment: 'live' }),
    partner: partnerDoc({ approvalStatus: 'approved' }),
  });
  assert.equal((await liveOk.authenticateApiKey(token)).partner.approvalStatus, 'approved');
});

test('revokeApiKey is owner-scoped and single-use', async () => {
  const queries = [];
  const record = { keyId: 'sk_test_abcdef123456', partnerId: 'p-1', revokedAt: null, name: 'k', environment: 'sandbox', scopes: [], expiresAt: new Date() };
  const service = loadService({
    PartnerApiKey: {
      findOneAndUpdate: (query, update) => {
        queries.push(query);
        const match = query.keyId === record.keyId && query.partnerId === record.partnerId && record.revokedAt === null;
        if (match) record.revokedAt = update.$set.revokedAt;
        return chain(match ? record : null);
      },
    },
  });
  const first = await service.revokeApiKey('p-1', 'sk_test_abcdef123456');
  assert.ok(first.revokedAt instanceof Date);
  await assert.rejects(service.revokeApiKey('p-1', 'sk_test_abcdef123456'), { statusCode: 404 });
  await assert.rejects(service.revokeApiKey('other', 'sk_test_abcdef123456'), { statusCode: 404 });
  assert.deepEqual(queries[0], { keyId: 'sk_test_abcdef123456', partnerId: 'p-1', revokedAt: null });
});

test('rotateClientSecret is web-only, increments secretVersion, and never stores plaintext', async () => {
  const app = appDoc({ applicationType: 'web' });
  const captured = [];
  const service = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    PartnerApp: {
      findOne: () => chain(app),
      findOneAndUpdate: (query, update) => {
        captured.push({ query, update });
        return chain({ ...app, secretVersion: app.secretVersion + 1 });
      },
    },
  });
  const result = await service.rotateClientSecret('p-1', app.appId);
  assert.match(result.clientSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.app.secretVersion, 1);
  assert.deepEqual(captured[0].update.$inc, { secretVersion: 1 });
  const stored = captured[0].update.$set.clientSecretEncrypted;
  assert.notEqual(stored, result.clientSecret);
  const { decryptSecret } = require('../utils/syncSpaceCrypto');
  assert.equal(decryptSecret(stored, `client:${app.appId}`), result.clientSecret);

  const native = loadService({
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    PartnerApp: { findOne: () => chain(appDoc({ applicationType: 'native' })) },
  });
  await assert.rejects(native.rotateClientSecret('p-1', app.appId), { statusCode: 400 });
});

test('requestProduction uses a verified sandbox/rejected CAS transition to pending', async () => {
  const captured = [];
  const service = loadService({
    PartnerAccount: {
      findOneAndUpdate: (query, update) => {
        captured.push({ query, update });
        return chain(partnerDoc({ approvalStatus: 'pending', reviewVersion: 1 }));
      },
      findOne: () => chain(partnerDoc()),
    },
  });
  const result = await service.requestProduction('p-1', {
    useCase: 'Send order updates to customers',
    privacyPolicyUrl: 'https://acme.example.com/privacy',
  });
  assert.equal(result.approvalStatus, 'pending');
  assert.equal(captured[0].query.partnerId, 'p-1');
  assert.deepEqual(captured[0].query.approvalStatus, { $in: ['sandbox', 'rejected'] });
  assert.deepEqual(captured[0].query.emailVerifiedAt, { $ne: null });
  assert.equal(captured[0].update.$set.approvalStatus, 'pending');
  assert.deepEqual(captured[0].update.$inc, { reviewVersion: 1 });
  assert.equal(captured[0].update.$push.reviewHistory.action, 'requested');
  assert.equal(captured[0].update.$push.reviewHistory.actorKeyId, null);

  for (const body of [
    { useCase: 'x', privacyPolicyUrl: 'https://acme.example.com/p' },
    { useCase: 'valid use case', privacyPolicyUrl: 'http://acme.example.com/p' },
    { useCase: 'valid use case', privacyPolicyUrl: '' },
    { useCase: ['x'], privacyPolicyUrl: 'https://acme.example.com/p' },
  ]) {
    await assert.rejects(service.requestProduction('p-1', body), { statusCode: 400 }, JSON.stringify(body));
  }

  const unverified = loadService({
    PartnerAccount: {
      findOneAndUpdate: () => chain(null),
      findOne: () => chain(partnerDoc({ emailVerifiedAt: null })),
    },
  });
  await assert.rejects(
    unverified.requestProduction('p-1', { useCase: 'valid use case', privacyPolicyUrl: 'https://acme.example.com/p' }),
    { statusCode: 403, code: 'PARTNER_EMAIL_UNVERIFIED' }
  );

  const alreadyPending = loadService({
    PartnerAccount: {
      findOneAndUpdate: () => chain(null),
      findOne: () => chain(partnerDoc({ approvalStatus: 'pending' })),
    },
  });
  await assert.rejects(
    alreadyPending.requestProduction('p-1', { useCase: 'valid use case', privacyPolicyUrl: 'https://acme.example.com/p' }),
    { statusCode: 409, code: 'PARTNER_INVALID_TRANSITION' }
  );
});

test('reviewPartner enforces the state machine, CAS, reason bounds, and server-side actor', async () => {
  const captured = [];
  const service = loadService({
    PartnerAccount: {
      findOneAndUpdate: (query, update) => {
        captured.push({ query, update });
        return chain(partnerDoc({ approvalStatus: update.$set.approvalStatus, reviewVersion: 2 }));
      },
      findOne: () => chain(partnerDoc({ approvalStatus: 'pending', reviewVersion: 1 })),
    },
  });
  const admin = { keyId: 'ak_abcd1234', label: 'Owner' };
  const result = await service.reviewPartner(admin, 'p-1', {
    decision: 'approve',
    reason: 'Looks good, verified business docs',
    expectedVersion: 1,
    actorKeyId: 'injected-attacker',
  });
  assert.equal(result.approvalStatus, 'approved');
  assert.deepEqual(captured[0].query, {
    partnerId: 'p-1',
    approvalStatus: 'pending',
    reviewVersion: 1,
    emailVerifiedAt: { $ne: null },
  });
  assert.equal(captured[0].update.$set.approvalStatus, 'approved');
  assert.equal(captured[0].update.$push.reviewHistory.actorKeyId, 'ak_abcd1234');
  assert.equal(captured[0].update.$push.reviewHistory.actorLabel, 'Owner');
  assert.equal(captured[0].update.$push.reviewHistory.action, 'approve');

  for (const bad of [
    { decision: 'delete', reason: 'valid reason', expectedVersion: 0 },
    { decision: 'approve', reason: 'ok', expectedVersion: 0 },
    { decision: 'approve', reason: 'x'.repeat(1001), expectedVersion: 0 },
    { decision: 'approve', reason: 'valid reason', expectedVersion: '1' },
    { decision: 'approve', reason: 'valid reason', expectedVersion: -1 },
  ]) {
    await assert.rejects(service.reviewPartner(admin, 'p-1', bad), { statusCode: 400 }, JSON.stringify(bad));
  }
  await assert.rejects(
    service.reviewPartner(null, 'p-1', { decision: 'approve', reason: 'valid reason', expectedVersion: 0 }),
    { statusCode: 401 }
  );

  for (const [decision, current, ok] of [
    ['approve', 'sandbox', false],
    ['suspend', 'pending', false],
    ['restore', 'approved', false],
  ]) {
    const svc = loadService({
      PartnerAccount: {
        findOneAndUpdate: () => chain(null),
        findOne: () => chain(partnerDoc({ approvalStatus: current, reviewVersion: 0 })),
      },
    });
    if (ok) continue;
    await assert.rejects(
      svc.reviewPartner(admin, 'p-1', { decision, reason: 'valid reason', expectedVersion: 0 }),
      { statusCode: 409, code: 'PARTNER_REVIEW_CONFLICT' }
    );
  }

  const stale = loadService({
    PartnerAccount: {
      findOneAndUpdate: () => chain(null),
      findOne: () => chain(partnerDoc({ approvalStatus: 'pending', reviewVersion: 5 })),
    },
  });
  await assert.rejects(
    stale.reviewPartner(admin, 'p-1', { decision: 'approve', reason: 'valid reason', expectedVersion: 1 }),
    { statusCode: 409 }
  );
});

test('reviewPartner emails the decision and never fails on mail errors', async () => {
  const decisions = [];
  const mkService = (sendPartnerDecision) => loadService({
    PartnerAccount: {
      findOneAndUpdate: (query, update) =>
        chain(partnerDoc({ approvalStatus: update.$set.approvalStatus, reviewVersion: 2 })),
      findOne: () => chain(partnerDoc({ approvalStatus: 'pending', reviewVersion: 1 })),
    },
    email: {
      sendOTP: async () => ({ success: true }),
      sendPartnerDecision,
    },
  });
  const admin = { keyId: 'ak_abcd1234', label: 'Owner' };

  const ok = mkService(async (email, payload) => { decisions.push({ email, ...payload }); });
  const result = await ok.reviewPartner(admin, 'p-1', {
    decision: 'approve', reason: 'Looks good', expectedVersion: 1,
  });
  assert.equal(result.approvalStatus, 'approved');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'approve');
  assert.equal(decisions[0].businessName, 'Acme Inc');
  assert.equal(decisions[0].email, 'owner@example.com');

  // a throwing mailer must not fail the review
  const failing = mkService(async () => { throw new Error('smtp down'); });
  const stillOk = await failing.reviewPartner(admin, 'p-1', {
    decision: 'reject', reason: 'Missing docs', expectedVersion: 1,
  });
  assert.equal(stillOk.approvalStatus, 'rejected');
});

test('sendPartnerDecision escapes business name and reason in the HTML', async () => {
  const emailService = require('../services/emailService');
  const calls = [];
  const previousTransport = emailService.transporter;
  const previousInitialized = emailService.initialized;
  emailService.transporter = { sendMail: async (opts) => { calls.push(opts); return { messageId: 'x' }; } };
  emailService.initialized = true;
  try {
    await emailService.sendPartnerDecision('t@t.co', {
      businessName: 'Acme <img src=x onerror=alert(1)>',
      decision: 'reject',
      reason: 'Docs <script>alert(2)</script>',
    });
    await emailService.sendPartnerDecision('t@t.co', {
      businessName: 'Acme', decision: 'approve', reason: 'ok',
    });
  } finally {
    emailService.transporter = previousTransport;
    emailService.initialized = previousInitialized;
  }
  assert.equal(calls.length, 2);
  assert.match(calls[0].html, /Acme &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(calls[0].html, /<img src=x onerror/);
  assert.doesNotMatch(calls[0].html, /<script>alert\(2\)/);
  assert.match(calls[0].html, /&lt;script&gt;alert\(2\)/);
  assert.match(calls[1].subject, /approved/);
});

test('admin queue filters valid statuses and returns safe DTOs', async () => {
  const list = [partnerDoc({ approvalStatus: 'pending', useCase: 'orders' })];
  const service = loadService({
    PartnerAccount: {
      find: () => chain(list),
      countDocuments: async () => 1,
    },
  });
  const result = await service.listPartnersAdmin({ status: 'pending', page: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].approvalStatus, 'pending');
  assert.equal(Object.hasOwn(result.items[0], 'passwordHash'), false);
  assert.equal(Object.hasOwn(result.items[0], 'sessionVersion'), false);
  await assert.rejects(service.listPartnersAdmin({ status: 'bogus' }), { statusCode: 400 });
});
