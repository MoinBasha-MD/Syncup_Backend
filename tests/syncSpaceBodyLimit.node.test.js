const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const syncSpaceBodyLimit = require('../middleware/syncSpaceBodyLimit');

const run = (req) =>
  new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    const mw = syncSpaceBodyLimit(64);
    mw(req, res, () => resolve({ passed: true }));
  });

test('over-limit Content-Length is rejected with 413', async () => {
  const result = await run({ method: 'POST', headers: { 'content-length': '100' } });
  assert.equal(result.status, 413);
  assert.deepEqual(result.body, { success: false, code: 'PAYLOAD_TOO_LARGE' });
});

test('at-limit Content-Length passes through', async () => {
  const result = await run({ method: 'POST', headers: { 'content-length': '64' } });
  assert.equal(result.passed, true);
});

test('chunked body without Content-Length gets 411', async () => {
  const result = await run({ method: 'POST', headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(result.status, 411);
  assert.deepEqual(result.body, { success: false, code: 'LENGTH_REQUIRED' });
});

test('GET/HEAD/OPTIONS and bodyless POSTs pass through', async () => {
  for (const req of [
    { method: 'GET', headers: { 'content-length': '99999999' } },
    { method: 'HEAD', headers: { 'content-length': '99999999' } },
    { method: 'OPTIONS', headers: {} },
    { method: 'POST', headers: {} },
  ]) {
    assert.equal((await run(req)).passed, true, req.method);
  }
});

test('malformed Content-Length is a 400', async () => {
  const result = await run({ method: 'POST', headers: { 'content-length': 'abc' } });
  assert.equal(result.status, 400);
});

test('server.js mounts the limiter before the global parsers', () => {
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const limiterAt = src.indexOf('syncSpaceBodyLimit');
  const jsonAt = src.indexOf('express.json');
  const urlencodedAt = src.indexOf('express.urlencoded');
  const rawAt = src.indexOf('express.raw');
  assert.ok(limiterAt !== -1, 'limiter not mounted in server.js');
  assert.ok(limiterAt < jsonAt && limiterAt < urlencodedAt && limiterAt < rawAt,
    'limiter must be mounted before the global body parsers');
});
