const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

test('the registered password save hook hashes changed passwords once and skips unchanged values', async () => {
  const modulePath = require.resolve('../models/userModel');
  const originalLoad = Module._load;
  const cachedModel = require.cache[modulePath];
  let hashCalls = 0;
  const bcrypt = {
    genSalt: async rounds => `salt-${rounds}`,
    hash: async (value, salt) => {
      hashCalls += 1;
      return `bcrypt:${salt}:${value}`;
    },
    compare: async (value, hash) => hash === `bcrypt:salt-10:${value}`,
  };

  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (request === 'bcryptjs') return bcrypt;
    return originalLoad.call(this, request, parent, isMain);
  };

  let User;
  try {
    User = require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModel) require.cache[modulePath] = cachedModel;
    else delete require.cache[modulePath];
  }

  const hooks = User.schema.s.hooks._pres.get('save');
  const passwordHook = hooks.find(hook => hook.fn.name === 'hashPasswordBeforeSave');
  assert.ok(passwordHook);

  const document = {
    password: 'RawPass9',
    passwordChanged: true,
    isModified(field) {
      return field === 'password' && this.passwordChanged;
    },
  };
  const runHook = async () => new Promise((resolve, reject) => {
    Promise.resolve(passwordHook.fn.call(document, error => {
      if (error) reject(error);
      else resolve();
    })).catch(reject);
  });

  await runHook();
  const hashedPassword = document.password;
  assert.notEqual(hashedPassword, 'RawPass9');
  assert.equal(await bcrypt.compare('RawPass9', hashedPassword), true);
  assert.equal(hashCalls, 1);

  document.passwordChanged = false;
  await runHook();
  assert.equal(document.password, hashedPassword);
  assert.equal(hashCalls, 1);
});
