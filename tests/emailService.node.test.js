const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

test('email transporter requires verified STARTTLS', (t) => {
  const servicePath = require.resolve('../services/emailService');
  const originalLoad = Module._load;
  const originalCachedService = require.cache[servicePath];
  const originalEmailUser = process.env.EMAIL_USER;
  const originalEmailPassword = process.env.EMAIL_APP_PASSWORD;
  let transportOptions;

  Module._load = function (request, parent, isMain) {
    if (request === 'nodemailer') {
      return {
        createTransport(options) {
          transportOptions = options;
          return {};
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];

  t.after(() => {
    Module._load = originalLoad;
    if (originalCachedService) {
      require.cache[servicePath] = originalCachedService;
    } else {
      delete require.cache[servicePath];
    }
    if (originalEmailUser === undefined) {
      delete process.env.EMAIL_USER;
    } else {
      process.env.EMAIL_USER = originalEmailUser;
    }
    if (originalEmailPassword === undefined) {
      delete process.env.EMAIL_APP_PASSWORD;
    } else {
      process.env.EMAIL_APP_PASSWORD = originalEmailPassword;
    }
  });

  process.env.EMAIL_USER = 'offline-test@example.test';
  process.env.EMAIL_APP_PASSWORD = 'offline-test-password';
  const emailService = require(servicePath);
  emailService.initialize();

  assert.equal(transportOptions.host, 'smtp.gmail.com');
  assert.equal(transportOptions.port, 587);
  assert.equal(transportOptions.secure, false);
  assert.equal(transportOptions.requireTLS, true);
  assert.equal(transportOptions.tls.rejectUnauthorized, true);
  assert.equal(transportOptions.debug, false);
  assert.equal(transportOptions.logger, false);
});
