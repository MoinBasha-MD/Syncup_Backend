const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { sanitizeRequestPayload } = require('../middleware/securityMiddleware');

const startServer = (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(sanitizeRequestPayload);
  app.post('/echo', (req, res) => res.json(req.body));
  return app;
};

test('sanitizeRequestPayload strips $-prefixed operator keys from req.body', async (t) => {
  const server = await startServer(buildApp());
  t.after(() => server.close());
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverId: { $ne: null }, name: 'ok' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { receiverId: {}, name: 'ok' });
});

test('sanitizeRequestPayload keeps dotted keys and nested values', async (t) => {
  const server = await startServer(buildApp());
  t.after(() => server.close());
  const port = server.address().port;

  const payload = {
    'profile.name': 'Asha',
    nested: { 'a.b': [1, { 'x.y': 'z' }] },
    list: ['v1', { deep: { $where: 'evil' } }],
  };
  const res = await fetch(`http://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    'profile.name': 'Asha',
    nested: { 'a.b': [1, { 'x.y': 'z' }] },
    list: ['v1', { deep: {} }],
  });
});
