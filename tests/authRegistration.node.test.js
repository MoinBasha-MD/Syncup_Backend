const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

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
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const findRoute = (router, path, method) =>
  router.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[method]
  ).route;

const fakeBcrypt = {
  hash: async value => `hash:${value}`,
  compare: async (value, hash) => hash === `hash:${value}`,
};

const loadOTPService = (OTP, bcrypt = fakeBcrypt) =>
  loadWithMocks('../services/otpService', {
    '../models/otpModel': OTP,
    bcryptjs: bcrypt,
    '../utils/phoneUtils': { normalizePhoneNumber: value => value },
    './smsProvider': {},
  });

const loadAuthController = ({ User, otpService, AIInstance, bcrypt }) =>
  loadWithMocks('../controllers/authController', {
    '../models/userModel': User,
    '../models/aiInstanceModel': AIInstance ?? { create: async () => ({ aiId: 'ai-1' }) },
    '../services/otpService': otpService,
    '../utils/generateToken': { generateToken: () => 'jwt-token' },
    '../utils/phoneUtils': {
      normalizePhoneNumber: value => value.replace(/\D/g, '').slice(-10),
      isValidPhoneNumber: value => /^\d{10}$/.test(value) || /^\+?\d{10,15}$/.test(value),
    },
    bcryptjs: bcrypt ?? fakeBcrypt,
  });

const validBody = () => ({
  name: '  Jane Doe  ',
  phoneNumber: '9876543210',
  email: '  Jane+Tag@Example.TECHNOLOGY ',
  password: 'StrongPass1',
  dateOfBirth: '2000-01-15',
  gender: 'FEMALE',
  registrationToken: 'ab'.repeat(32),
});

test('registration OTP verification issues an atomic single-use grant', async () => {
  let claimCount = 0;
  let capturedQuery;
  let capturedUpdate;
  const OTP = {
    findOne: query => ({
      sort: async () => ({
        ...query,
        _id: 'otp-id',
        attempts: 0,
        maxAttempts: 3,
        otpHash: 'hash:123456',
        save: async () => {},
      }),
    }),
    findOneAndUpdate: async (query, update, options) => {
      capturedQuery = query;
      capturedUpdate = update;
      claimCount += 1;
      return claimCount === 1 ? { _id: 'otp-id' } : null;
    },
  };
  const service = loadOTPService(OTP);

  const results = await Promise.all([
    service.verifyOTP('jane@example.com', '123456', 'registration'),
    service.verifyOTP('jane@example.com', '123456', 'registration'),
  ]);

  assert.equal(results.filter(r => r.success).length, 1);
  const winner = results.find(r => r.success);
  assert.match(winner.registrationToken, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(winner, 'resetToken'), false);
  assert.equal(claimCount, 2);
  assert.equal(capturedQuery.verified, false);
  assert.deepEqual(capturedQuery.attempts, { $lt: 3 });
  assert.equal(capturedUpdate.$set.verified, true);
  assert.match(capturedUpdate.$set.registrationTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(capturedUpdate.$set.expiresAt.getTime() >= Date.now() + 5 * 60 * 1000 - 1000);
});

test('new OTP issuance clears previous registration grants too', async () => {
  let update;
  const OTP = {
    countDocuments: async () => 0,
    updateMany: async (_filter, updateDocument) => { update = updateDocument; },
    create: async doc => ({ ...doc, _id: 'new-otp' }),
  };
  await loadOTPService(OTP).createOTP('jane@example.com', 'registration');
  assert.deepEqual(update.$unset, { resetTokenHash: 1, registrationTokenHash: 1 });
});

// In-memory store whose findOneAndDelete honours the real query predicates:
// identifier, type, verified, token hash, and expiry must all match, and a
// document can only be consumed once.
const grantStore = (docs) => {
  const remaining = [...docs];
  return {
    findOneAndDelete: async (query) => {
      const index = remaining.findIndex(doc =>
        doc.identifier === query.identifier &&
        doc.type === query.type &&
        doc.verified === query.verified &&
        doc.registrationTokenHash === query.registrationTokenHash &&
        doc.expiresAt instanceof Date &&
        doc.expiresAt > query.expiresAt.$gt
      );
      return index === -1 ? null : remaining.splice(index, 1)[0];
    },
  };
};

test('consumeRegistrationToken is single-use, email-bound, and fails closed', async () => {
  const token = 'cd'.repeat(32);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const queries = [];
  const store = grantStore([
    {
      identifier: 'jane+tag@example.com',
      type: 'registration',
      verified: true,
      registrationTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  const OTP = {
    findOneAndDelete: async (query) => {
      queries.push(query);
      return store.findOneAndDelete(query);
    },
  };
  const service = loadOTPService(OTP);

  assert.equal(await service.consumeRegistrationToken(' Jane+Tag@Example.com ', token), true);
  // Replay fails — the document was consumed.
  assert.equal(await service.consumeRegistrationToken('jane+tag@example.com', token), false);
  assert.equal(queries[0].identifier, 'jane+tag@example.com');
  assert.equal(queries[0].type, 'registration');
  assert.equal(queries[0].verified, true);
  assert.equal(queries[0].registrationTokenHash, tokenHash);
  assert.ok(queries[0].expiresAt.$gt instanceof Date);

  // Malformed inputs fail without touching the store.
  assert.equal(await service.consumeRegistrationToken('not-an-email', token), false);
  assert.equal(await service.consumeRegistrationToken('jane@example.com', 'short'), false);
  // A raw 6-digit code is not a grant.
  assert.equal(await service.consumeRegistrationToken('jane@example.com', '123456'), false);
  assert.equal(queries.length, 2);
});

test('registration grants are bound to account, type, and expiry', async () => {
  const token = 'ef'.repeat(32);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const service = loadOTPService(grantStore([
    // Correct grant (expires in future)
    { identifier: 'jane@example.com', type: 'registration', verified: true, registrationTokenHash: tokenHash, expiresAt: new Date(Date.now() + 60_000) },
  ]));
  // Wrong account never matches the stored grant.
  assert.equal(await service.consumeRegistrationToken('other@example.com', token), false);
  // Correct account + grant succeeds.
  assert.equal(await service.consumeRegistrationToken('jane@example.com', token), true);

  const expiredStore = loadOTPService(grantStore([
    { identifier: 'jane@example.com', type: 'registration', verified: true, registrationTokenHash: tokenHash, expiresAt: new Date(Date.now() - 1000) },
  ]));
  assert.equal(await expiredStore.consumeRegistrationToken('jane@example.com', token), false);

  const resetTypeStore = loadOTPService(grantStore([
    { identifier: 'jane@example.com', type: 'password_reset', verified: true, registrationTokenHash: tokenHash, expiresAt: new Date(Date.now() + 60_000) },
  ]));
  assert.equal(await resetTypeStore.consumeRegistrationToken('jane@example.com', token), false);
});

test('concurrent registration grant consumption has a single winner', async () => {
  const token = 'ab'.repeat(32);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const service = loadOTPService(grantStore([
    { identifier: 'jane@example.com', type: 'registration', verified: true, registrationTokenHash: tokenHash, expiresAt: new Date(Date.now() + 60_000) },
  ]));
  const results = await Promise.all([
    service.consumeRegistrationToken('jane@example.com', token),
    service.consumeRegistrationToken('jane@example.com', token),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
});

test('OTP verify route returns registrationToken only for registration', async () => {
  const otpService = {
    verifyOTP: async (_email, _otp, type) =>
      type === 'registration'
        ? { success: true, registrationToken: 'ef'.repeat(32) }
        : { success: true, resetToken: 'ab'.repeat(32) },
  };
  const router = loadWithMocks('../routes/otpRoutes', {
    '../services/otpService': otpService,
    '../services/emailService': {},
  });
  const verify = findRoute(router, '/verify', 'post').stack[0].handle;
  const request = body => ({ body });

  const reg = responseMock();
  await verify(request({ email: 'jane@example.com', otp: '123456', type: 'registration' }), reg);
  assert.equal(reg.body.registrationToken, 'ef'.repeat(32));
  assert.equal(Object.hasOwn(reg.body, 'resetToken'), false);

  const reset = responseMock();
  await verify(request({ email: 'jane@example.com', otp: '123456', type: 'password_reset' }), reset);
  assert.equal(reset.body.resetToken, 'ab'.repeat(32));
  assert.equal(Object.hasOwn(reset.body, 'registrationToken'), false);

  // A different type never receives a grant.
  const other = responseMock();
  otpService.verifyOTP = async () => ({ success: true, registrationToken: 'ef'.repeat(32) });
  await verify(request({ email: 'jane@example.com', otp: '123456', type: 'email_change' }), other);
  assert.equal(Object.hasOwn(other.body, 'registrationToken'), false);
});

test('registerUser rejects missing/malformed grants and bad input before any DB work', async () => {
  let lookups = 0;
  let creates = 0;
  let consumes = 0;
  const controller = loadAuthController({
    User: {
      findOne: async () => { lookups += 1; return null; },
      create: async () => { creates += 1; return {}; },
    },
    otpService: {
      consumeRegistrationToken: async () => { consumes += 1; return true; },
    },
  });

  const missing = responseMock();
  const { registrationToken, ...noGrant } = validBody();
  await controller.registerUser({ body: noGrant }, missing);
  assert.equal(missing.statusCode, 403);

  const malformed = responseMock();
  await controller.registerUser({ body: { ...validBody(), registrationToken: 'nope' } }, malformed);
  assert.equal(malformed.statusCode, 403);

  // Malformed body -> 400 (never a thrown 500).
  const badTypes = responseMock();
  await controller.registerUser({ body: { ...validBody(), email: 42 } }, badTypes);
  assert.equal(badTypes.statusCode, 400);

  const weakPassword = responseMock();
  await controller.registerUser({ body: { ...validBody(), password: 'weak' } }, weakPassword);
  assert.equal(weakPassword.statusCode, 400);

  const badDate = responseMock();
  await controller.registerUser({ body: { ...validBody(), dateOfBirth: '2000-02-30' } }, badDate);
  assert.equal(badDate.statusCode, 400);

  const badFormat = responseMock();
  await controller.registerUser({ body: { ...validBody(), dateOfBirth: '15/01/2000' } }, badFormat);
  assert.equal(badFormat.statusCode, 400);

  const underage = responseMock();
  const today = new Date().toISOString().slice(0, 10);
  const under18 = `${Number(today.slice(0, 4)) - 15}${today.slice(4)}`;
  await controller.registerUser({ body: { ...validBody(), dateOfBirth: under18 } }, underage);
  assert.equal(underage.statusCode, 400);

  assert.equal(lookups, 0);
  assert.equal(creates, 0);
  assert.equal(consumes, 0);
});

test('registerUser rejects duplicate accounts and unconsumed grants without creating', async () => {
  let creates = 0;
  let queries;
  const controller = loadAuthController({
    User: {
      findOne: async query => { queries = query; return { _id: 'existing' }; },
      create: async () => { creates += 1; return {}; },
    },
    otpService: { consumeRegistrationToken: async () => true },
  });
  const dup = responseMock();
  await controller.registerUser({ body: validBody() }, dup);
  assert.equal(dup.statusCode, 400);
  assert.equal(creates, 0);
  // Duplicate email lookup uses an escaped anchored case-insensitive match.
  assert.equal(queries.email.$regex.test('jane+tag@example.technology'), true);
  assert.equal(queries.email.$regex.test('janeXtag@example.technology'), false);

  let consumes = 0;
  const failing = loadAuthController({
    User: { findOne: async () => null, create: async () => { creates += 1; return {}; } },
    otpService: {
      consumeRegistrationToken: async () => { consumes += 1; return false; },
    },
  });
  const denied = responseMock();
  await failing.registerUser({ body: validBody() }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(consumes, 1);
  assert.equal(creates, 0);
});

test('registerUser consumes the grant and persists a normalized verified user', async () => {
  let created;
  const consumeCalls = [];
  const controller = loadAuthController({
    User: {
      findOne: async () => null,
      create: async data => {
        created = data;
        return {
          ...data,
          _id: 'uid1',
          userId: 'user-1',
          status: 'available',
        };
      },
    },
    otpService: {
      consumeRegistrationToken: async (...args) => {
        consumeCalls.push(args);
        return true;
      },
    },
  });
  const response = responseMock();
  await controller.registerUser({ body: validBody() }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(consumeCalls[0], ['jane+tag@example.technology', 'ab'.repeat(32)]);
  assert.equal(created.name, 'Jane Doe');
  assert.equal(created.email, 'jane+tag@example.technology');
  assert.equal(created.gender, 'female');
  assert.equal(created.emailVerified, true);
  assert.equal(created.dateOfBirth.toISOString().slice(0, 10), '2000-01-15');
  assert.equal(response.body.success, true);
});

test('legacy /users registerUser delegates to the canonical OTP-gated registration', async () => {
  let canonicalCalls = 0;
  const controller = loadWithMocks('../controllers/userController', {
    './authController': {
      registerUser: async (req, res) => {
        canonicalCalls += 1;
        res.status(201).json({ success: true });
      },
    },
  });
  const response = responseMock();
  await controller.registerUser({ body: {} }, response);
  assert.equal(canonicalCalls, 1);
  assert.equal(response.statusCode, 201);
});

test('loginUser rejects malformed credentials before lookup or bcrypt', async () => {
  let lookups = 0;
  let compares = 0;
  const controller = loadAuthController({
    User: { findOne: () => { lookups += 1; return { select: async () => null }; } },
    otpService: {},
    bcrypt: { compare: async () => { compares += 1; return true; } },
  });

  for (const body of [
    {},
    { phoneNumber: '9876543210' },
    { password: 'secret1' },
    { phoneNumber: 42, password: 'secret1' },
    { phoneNumber: '9876543210', password: 123 },
    { phoneNumber: '   ', password: 'secret1' },
    { phoneNumber: 'not-a-phone', password: 'secret1' },
  ]) {
    const response = responseMock();
    await controller.loginUser({ body, ip: '127.0.0.1' }, response);
    assert.equal(response.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(lookups, 0);
  assert.equal(compares, 0);
});

test('loginUser returns 401 for wrong credentials and succeeds with the right ones', async () => {
  const user = {
    userId: 'user-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phoneNumber: '9876543210',
    password: 'hash:RealPass1',
    status: 'available',
  };
  const controller = loadAuthController({ User: { findOne: () => ({ select: async () => user }) }, otpService: {} });

  const wrong = responseMock();
  await controller.loginUser({ body: { phoneNumber: '9876543210', password: 'WrongPass1' }, ip: 'x' }, wrong);
  assert.equal(wrong.statusCode, 401);

  const ok = responseMock();
  await controller.loginUser({ body: { phoneNumber: '9876543210', password: 'RealPass1' }, ip: 'x' }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.data.token, 'jwt-token');
  // The client receives its own raw phone number back (masked only in logs).
  assert.equal(ok.body.data.phoneNumber, '9876543210');
});

test('user model accepts common modern email forms', () => {
  const User = require('../models/userModel');
  const make = email => {
    const doc = new User({ name: 'Jane', email });
    return doc.validateSync();
  };
  assert.equal(make('jane@example.technology'), undefined);
  assert.equal(make('jane+tag@example.com'), undefined);
  assert.notEqual(make('not-an-email'), undefined);
});
