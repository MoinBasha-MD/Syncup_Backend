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

test('legacy public user admin endpoints return 410 without invoking controllers or models', async () => {
  const accessedControllers = [];
  let controllerCalls = 0;
  const userController = new Proxy({}, {
    get(_target, property) {
      const name = String(property);
      accessedControllers.push(name);
      if (name === 'adminResetPassword' || name === 'getAllUsersForAdmin') {
        throw new Error('legacy admin controller must not be imported');
      }
      return () => { controllerCalls += 1; };
    },
  });
  const authLimiter = () => {};
  const router = loadWithMocks('../routes/userRoutes', {
    '../controllers/userController': userController,
    '../controllers/connectionStatsController': new Proxy({}, { get: () => () => {} }),
    '../controllers/syncProfileImagesController': new Proxy({}, { get: () => () => {} }),
    '../controllers/passwordResetController': { resetPasswordOTP: () => {} },
    '../middleware/authMiddleware': { protect: () => {} },
    '../middleware/securityMiddleware': { authLimiter },
    '../models/userModel': new Proxy({}, {
      get() { throw new Error('user model must not be used'); },
    }),
  });

  const loginRoute = findRoute(router, '/login', 'post');
  assert.equal(loginRoute.stack[0].handle, authLimiter);
  const resetRoute = findRoute(router, '/reset-password-otp', 'post');
  assert.equal(resetRoute.stack[0].handle, authLimiter);

  for (const [path, method] of [
    ['/admin/all', 'get'],
    ['/admin/reset-password', 'post'],
    ['/admin/force-reset-password', 'post'],
  ]) {
    const route = findRoute(router, path, method);
    const response = responseMock();
    await route.stack[0].handle({}, response);
    assert.equal(response.statusCode, 410);
    assert.deepEqual(response.body, {
      success: false,
      message: 'Legacy endpoint disabled',
    });
  }

  assert.equal(controllerCalls, 0);
  assert.equal(accessedControllers.includes('adminResetPassword'), false);
  assert.equal(accessedControllers.includes('getAllUsersForAdmin'), false);
});

test('OTP verify route validates strings, normalizes email, and returns grants only for password resets', async () => {
  const calls = [];
  const otpService = {
    verifyOTP: async (...args) => {
      calls.push(args);
      return { success: true, resetToken: 'a'.repeat(64) };
    },
  };
  const router = loadWithMocks('../routes/otpRoutes', {
    '../services/otpService': otpService,
    '../services/emailService': {},
  });
  const verify = findRoute(router, '/verify', 'post').stack[0].handle;
  const request = body => ({ body });

  const invalidResponse = responseMock();
  await verify(request({
    email: { $ne: '' },
    otp: { value: '123456' },
    type: ['password_reset'],
  }), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(calls.length, 0);

  const resetResponse = responseMock();
  await verify(request({
    email: '  Alice+Tag@example.com ',
    otp: '123456',
    type: 'password_reset',
  }), resetResponse);
  assert.deepEqual(calls[0], ['alice+tag@example.com', '123456', 'password_reset']);
  assert.equal(resetResponse.body.resetToken, 'a'.repeat(64));

  const registrationResponse = responseMock();
  await verify(request({
    email: 'user@example.com',
    otp: '123456',
    type: 'registration',
  }), registrationResponse);
  assert.equal(Object.hasOwn(registrationResponse.body, 'resetToken'), false);
});

test('OTP send and resend normalize email and reject non-string types', async () => {
  const createCalls = [];
  const sentEmails = [];
  const otpService = {
    createOTP: async (...args) => {
      createCalls.push(args);
      return { success: true, otp: '123456' };
    },
  };
  const emailService = {
    sendOTP: async (...args) => {
      sentEmails.push(args);
      return { success: true };
    },
  };
  const router = loadWithMocks('../routes/otpRoutes', {
    '../services/otpService': otpService,
    '../services/emailService': emailService,
  });
  const request = body => ({ body, ip: '127.0.0.1', get: () => 'offline-test' });

  for (const path of ['/send', '/resend']) {
    const handler = findRoute(router, path, 'post').stack[0].handle;
    const response = responseMock();
    await handler(request({
      email: '  Alice+Tag@Example.com ',
      type: 'password_reset',
    }), response);
    assert.equal(response.statusCode, 200);
  }

  assert.equal(createCalls.length, 2);
  assert.equal(createCalls[0][0], 'alice+tag@example.com');
  assert.equal(createCalls[1][0], 'alice+tag@example.com');
  assert.equal(sentEmails[0][0], 'alice+tag@example.com');
  assert.equal(sentEmails[1][0], 'alice+tag@example.com');

  const invalidResponse = responseMock();
  await findRoute(router, '/resend', 'post').stack[0].handle(request({
    email: 'alice@example.com',
    type: { value: 'password_reset' },
  }), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(createCalls.length, 2);
});

test('password reset OTP verification grants one token only across concurrent claims', async () => {
  let claimCount = 0;
  let capturedQuery;
  let capturedUpdate;
  let capturedOptions;
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
      capturedOptions = options;
      claimCount += 1;
      return claimCount === 1 ? { _id: 'otp-id' } : null;
    },
  };
  const service = loadOTPService(OTP);

  const results = await Promise.all([
    service.verifyOTP('alice@example.com', '123456', 'password_reset'),
    service.verifyOTP('alice@example.com', '123456', 'password_reset'),
  ]);

  assert.equal(results.filter(result => result.success).length, 1);
  assert.match(results.find(result => result.success).resetToken, /^[a-f0-9]{64}$/);
  assert.equal(claimCount, 2);
  assert.equal(capturedQuery.verified, false);
  assert.deepEqual(capturedQuery.attempts, { $lt: 3 });
  assert.ok(capturedQuery.expiresAt.$gt instanceof Date);
  assert.equal(capturedUpdate.$set.verified, true);
  assert.match(capturedUpdate.$set.resetTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(capturedUpdate.$set.expiresAt.getTime() >= Date.now() + 5 * 60 * 1000 - 1000);
  assert.deepEqual(capturedOptions, { new: true });
});

test('an incorrect password reset code cannot issue a reset grant', async () => {
  let claims = 0;
  let saves = 0;
  const OTP = {
    findOne: () => ({
      sort: async () => ({
        _id: 'otp-id',
        attempts: 0,
        maxAttempts: 3,
        otpHash: 'stored-hash',
        async save() { saves += 1; },
      }),
    }),
    findOneAndUpdate: async () => { claims += 1; },
  };
  const bcrypt = {
    ...fakeBcrypt,
    compare: async () => false,
  };
  const result = await loadOTPService(OTP, bcrypt).verifyOTP(
    'alice@example.com',
    '000000',
    'password_reset'
  );

  assert.equal(result.success, false);
  assert.equal(saves, 1);
  assert.equal(claims, 0);
  assert.equal(Object.hasOwn(result, 'resetToken'), false);
});

test('non-reset OTP verification keeps its existing verified flow without a grant', async () => {
  let saved = 0;
  let claims = 0;
  const OTP = {
    findOne: () => ({
      sort: async () => ({
        _id: 'otp-id',
        attempts: 0,
        maxAttempts: 3,
        otpHash: 'hash:123456',
        save: async function () { saved += 1; this.verified = true; },
      }),
    }),
    findOneAndUpdate: async () => { claims += 1; },
  };
  const result = await loadOTPService(OTP).verifyOTP(
    'alice@example.com',
    '123456',
    'registration'
  );

  assert.deepEqual(result, { success: true });
  assert.equal(saved, 1);
  assert.equal(claims, 0);
});

test('new OTP issuance invalidates all previous reset grants', async () => {
  let update;
  let query;
  const OTP = {
    countDocuments: async () => 0,
    updateMany: async (filter, updateDocument) => {
      query = filter;
      update = updateDocument;
    },
    create: async document => ({ ...document, _id: 'new-otp' }),
  };
  const result = await loadOTPService(OTP).createOTP(
    'alice@example.com',
    'password_reset'
  );

  assert.equal(result.success, true);
  assert.deepEqual(query, { identifier: 'alice@example.com', type: 'password_reset' });
  assert.deepEqual(update.$set, { verified: true });
  assert.deepEqual(update.$unset, { resetTokenHash: 1 });
});

test('reset token consumption hashes a normalized email-bound token and is single use', async () => {
  const resetToken = 'ab'.repeat(32);
  const expectedHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const deleteQueries = [];
  let deleteCount = 0;
  const OTP = {
    findOneAndDelete: async query => {
      deleteQueries.push(query);
      deleteCount += 1;
      return deleteCount === 1 ? { _id: 'grant' } : null;
    },
  };
  const service = loadOTPService(OTP);

  assert.equal(
    await service.consumePasswordResetToken(' Alice+Tag@Example.com ', resetToken),
    true
  );
  assert.equal(
    await service.consumePasswordResetToken('alice+tag@example.com', resetToken),
    false
  );
  assert.equal(deleteQueries[0].identifier, 'alice+tag@example.com');
  assert.equal(deleteQueries[0].type, 'password_reset');
  assert.equal(deleteQueries[0].verified, true);
  assert.equal(deleteQueries[0].resetTokenHash, expectedHash);
  assert.ok(deleteQueries[0].expiresAt.$gt instanceof Date);

  assert.equal(await service.consumePasswordResetToken('not-an-email', resetToken), false);
  assert.equal(await service.consumePasswordResetToken('alice@example.com', 'bad-token'), false);
  assert.equal(deleteQueries.length, 2);
});

test('password reset rejects missing, wrong-account, expired, and replayed proof without mutation', async () => {
  const user = {
    password: 'old-password-hash',
    encryptedPassword: { encrypted: 'old' },
    resetPasswordToken: 'old-token',
    resetPasswordExpire: new Date(),
    save: async () => { throw new Error('must not save'); },
  };
  let lookups = 0;
  const User = {
    findOne: async () => {
      lookups += 1;
      return user;
    },
  };
  const consumeCalls = [];
  const otpService = {
    consumePasswordResetToken: async (...args) => {
      consumeCalls.push(args);
      return false;
    },
  };
  const controller = loadWithMocks('../controllers/passwordResetController', {
    '../models/userModel': User,
    '../services/otpService': otpService,
  });
  const validRequest = {
    email: 'alice@example.com',
    newPassword: 'StrongPass1',
    resetToken: 'ab'.repeat(32),
  };

  const missingProof = responseMock();
  await controller.resetPasswordOTP({ body: { ...validRequest, resetToken: undefined } }, missingProof);
  assert.equal(missingProof.statusCode, 400);
  assert.equal(lookups, 0);

  for (const proofCase of ['wrong-account', 'expired', 'replayed']) {
    const response = responseMock();
    const email = proofCase === 'wrong-account' ? 'other@example.com' : validRequest.email;
    await controller.resetPasswordOTP({
      body: { ...validRequest, email },
    }, response);
    assert.equal(response.statusCode, 403);
  }

  assert.equal(lookups, 3);
  assert.deepEqual(consumeCalls[0], ['other@example.com', validRequest.resetToken]);
  assert.equal(user.password, 'old-password-hash');
  assert.equal(consumeCalls.length, 3);
});

test('password reset escapes email regex metacharacters and stores the raw password once', async () => {
  const user = {
    password: 'old-password-hash',
    encryptedPassword: { encrypted: 'old' },
    resetPasswordToken: 'old-token',
    resetPasswordExpire: new Date(),
    saveCount: 0,
    async save() { this.saveCount += 1; },
  };
  let query;
  let consumed;
  const User = {
    findOne: async filter => {
      query = filter;
      return user;
    },
  };
  const otpService = {
    consumePasswordResetToken: async (identifier, token) => {
      consumed = [identifier, token];
      return true;
    },
  };
  const controller = loadWithMocks('../controllers/passwordResetController', {
    '../models/userModel': User,
    '../services/otpService': otpService,
  });
  const resetToken = 'cd'.repeat(32);
  const response = responseMock();

  await controller.resetPasswordOTP({
    body: {
      email: '  Alice+Tag.Test@Example.com ',
      newPassword: 'NewStrong9',
      resetToken,
    },
  }, response);

  const emailPattern = query.email.$regex;
  assert.equal(emailPattern.test('alice+tag.test@example.com'), true);
  assert.equal(emailPattern.test('aliceXtagYtest@example.com'), false);
  assert.deepEqual(consumed, ['alice+tag.test@example.com', resetToken]);
  assert.equal(user.password, 'NewStrong9');
  assert.equal(user.encryptedPassword, undefined);
  assert.equal(user.resetPasswordToken, undefined);
  assert.equal(user.resetPasswordExpire, undefined);
  assert.equal(user.saveCount, 1);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
});
