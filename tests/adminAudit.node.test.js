const assert = require('node:assert/strict');
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

// In-memory stand-in for the AdminAuditLog model
const makeModel = (docs) => ({
  create: async (doc) => { docs.push(doc); return doc; },
  findOne: () => ({
    sort: () => ({
      select: () => ({
        lean: async () => (docs.length ? docs[docs.length - 1] : null),
      }),
    }),
  }),
  find: (query) => ({
    sort: () => ({
      limit: (n) => ({
        lean: async () => docs
          .filter(d => !query || !query.seq || d.seq > query.seq.$gt)
          .slice(0, n),
      }),
    }),
  }),
});

const loadAudit = (docs) =>
  loadWithMocks('../services/adminAudit', {
    '../models/AdminAuditLog': makeModel(docs),
  });

const baseEntry = () => ({
  adminId: 'admin-1',
  adminUsername: 'root',
  adminRole: 'owner',
  ip: '127.0.0.1',
  action: 'user.ban',
  targetType: 'user',
  targetId: 'user-1',
  reason: 'spam',
  result: 'success',
});

test('recordAdminAction redacts secrets in before/after/meta', async () => {
  const docs = [];
  const { recordAdminAction } = loadAudit(docs);
  await recordAdminAction({
    ...baseEntry(),
    before: {
      name: 'x',
      password: 'hunter2',
      nested: { totpSecret: 'abc', fcmToken: 't', otpCode: '123456', ok: 'keep' },
    },
    after: { pass: 'x', recoveryCodes: ['a'] },
    meta: { authToken: 'z', plain: 'y' },
  });

  const doc = docs[0];
  assert.equal(doc.before.password, '[REDACTED]');
  assert.equal(doc.before.nested.totpSecret, '[REDACTED]');
  assert.equal(doc.before.nested.fcmToken, '[REDACTED]');
  assert.equal(doc.before.nested.otpCode, '[REDACTED]');
  assert.equal(doc.before.nested.ok, 'keep');
  assert.equal(doc.after.pass, '[REDACTED]');
  assert.equal(doc.after.recoveryCodes, '[REDACTED]');
  assert.equal(doc.meta.authToken, '[REDACTED]');
  assert.equal(doc.meta.plain, 'y');
  assert.equal(doc.before.name, 'x');
});

test('appends chain via seq and prevHash', async () => {
  const docs = [];
  const { recordAdminAction, verifyAuditChain } = loadAudit(docs);
  await recordAdminAction(baseEntry());
  await recordAdminAction({ ...baseEntry(), action: 'user.unban' });

  assert.equal(docs.length, 2);
  assert.equal(docs[0].seq, 1);
  assert.equal(docs[0].prevHash, '0'.repeat(64));
  assert.equal(docs[1].seq, 2);
  assert.equal(docs[1].prevHash, docs[0].hash);
  assert.match(docs[0].hash, /^[a-f0-9]{64}$/);

  const result = await verifyAuditChain();
  assert.deepEqual(result, { ok: true, checked: 2, brokenAtSeq: null });
});

test('verifyAuditChain detects a tampered `after` field', async () => {
  const docs = [];
  const { recordAdminAction, verifyAuditChain } = loadAudit(docs);
  await recordAdminAction(baseEntry());
  await recordAdminAction({ ...baseEntry(), action: 'user.unban' });

  docs[0].after = { role: 'owner' }; // forged

  const result = await verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSeq, 1);
});

test('verifyAuditChain detects a tampered adminUsername', async () => {
  const docs = [];
  const { recordAdminAction, verifyAuditChain } = loadAudit(docs);
  await recordAdminAction(baseEntry());
  await recordAdminAction({ ...baseEntry(), action: 'user.unban' });

  docs[0].adminUsername = 'mallory'; // forged attribution

  const result = await verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSeq, 1);
});

test('verifyAuditChain detects a broken prevHash link', async () => {
  const docs = [];
  const { recordAdminAction, verifyAuditChain } = loadAudit(docs);
  await recordAdminAction(baseEntry());
  await recordAdminAction({ ...baseEntry(), action: 'user.unban' });

  docs[1].prevHash = 'f'.repeat(64); // link broken

  const result = await verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSeq, 2);
});
