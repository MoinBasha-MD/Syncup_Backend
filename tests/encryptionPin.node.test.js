const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const res = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const loadController = (user) => {
  const modulePath = require.resolve('../controllers/userController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (request === '../models/userModel') {
      return {
        // Thenable query: works for `await findById()` and `await findById().select()`
        findById: () => {
          const q = Promise.resolve(user);
          q.select = () => Promise.resolve(user);
          return q;
        },
      };
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

test('setupEncryptionPin stores a bcrypt hash and no encryptionKey', async () => {
  const user = { name: 'u', encryptionSettings: null, save: async () => {} };
  const controller = loadController(user);
  const response = res();
  await controller.setupEncryptionPin(
    { body: { pinHash: 'abc123', encryptionKey: 'SHOULD-NOT-BE-STORED' }, user: { id: 'u1' } },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.ok(user.encryptionSettings.pinHash.startsWith('$2'));
  assert.equal(user.encryptionSettings.encryptionKey, undefined);
  assert.equal(await bcrypt.compare('abc123', user.encryptionSettings.pinHash), true);
});

test('verifyEncryptionPin verifies bcrypt-stored hashes', async () => {
  const stored = await bcrypt.hash('pinhash123', 12);
  const user = {
    name: 'u',
    encryptionSettings: { isEnabled: true, pinHash: stored },
    save: async () => {},
  };
  const controller = loadController(user);

  const ok = res();
  await controller.verifyEncryptionPin({ body: { pinHash: 'pinhash123' }, user: { id: 'u1' } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.encryptionKey, undefined);

  const bad = res();
  await controller.verifyEncryptionPin({ body: { pinHash: 'wrongpin' }, user: { id: 'u1' } }, bad);
  assert.equal(bad.statusCode, 401);
});

test('verifyEncryptionPin accepts a legacy sha256 hash and upgrades it to bcrypt', async () => {
  const pinHash = crypto.createHash('sha256').update('123456').digest('hex');
  let saved = false;
  const user = {
    name: 'u',
    encryptionSettings: { isEnabled: true, pinHash, encryptionKey: 'legacy-key' },
    save: async () => { saved = true; },
  };
  const controller = loadController(user);

  const response = res();
  await controller.verifyEncryptionPin({ body: { pinHash }, user: { id: 'u1' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.encryptionKey, undefined); // never returned anymore
  assert.equal(saved, true); // upgraded
  assert.ok(user.encryptionSettings.pinHash.startsWith('$2'));

  // Legacy hash now verifies via the bcrypt branch too
  const again = res();
  await controller.verifyEncryptionPin({ body: { pinHash }, user: { id: 'u1' } }, again);
  assert.equal(again.statusCode, 200);
});

test('verifyEncryptionPin rejects a wrong legacy pin without upgrading', async () => {
  const pinHash = crypto.createHash('sha256').update('123456').digest('hex');
  const wrong = crypto.createHash('sha256').update('000000').digest('hex');
  let saved = false;
  const user = {
    name: 'u',
    encryptionSettings: { isEnabled: true, pinHash },
    save: async () => { saved = true; },
  };
  const controller = loadController(user);
  const response = res();
  await controller.verifyEncryptionPin({ body: { pinHash: wrong }, user: { id: 'u1' } }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(saved, false);
});
