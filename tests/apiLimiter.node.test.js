const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'api-limiter-test-secret';

const { apiLimiter } = require('../middleware/securityMiddleware');

const startServer = (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });

// Mimics server.js: several bare '/api' mounts each wrapping a router that
// passes through, then the real sub-router — so one request crosses the
// limiter 4 times.
const buildApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', apiLimiter, (req, res, next) => next());
  app.use('/api', apiLimiter, (req, res, next) => next());
  app.use('/api', apiLimiter, (req, res, next) => next());
  app.use('/api/open-network', apiLimiter, (req, res) => res.json({ ok: true }));
  return app;
};

const remainingOf = (res) => {
  const header = res.headers.get('ratelimit-remaining');
  if (header !== null) return Number(header);
  // draft-7+ combined header form: "limit=1500, remaining=1499, reset=900"
  const combined = res.headers.get('ratelimit');
  const m = combined && combined.match(/remaining=(\d+)/);
  return m ? Number(m[1]) : null;
};

test('apiLimiter counts a request once even across multiple mounts', async (t) => {
  const server = await startServer(buildApp());
  t.after(() => server.close());
  const port = server.address().port;

  const token = jwt.sign({ userId: 'rl-user-1' }, process.env.JWT_SECRET);
  const res = await fetch(`http://127.0.0.1:${port}/api/open-network/ping`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const remaining = remainingOf(res);
  assert.equal(remaining, 1499, `expected exactly one decrement, got remaining=${remaining}`);
});

test('apiLimiter buckets separately per Bearer userId', async (t) => {
  const server = await startServer(buildApp());
  t.after(() => server.close());
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/api/open-network/ping`;

  const tokenA = jwt.sign({ userId: 'rl-user-A' }, process.env.JWT_SECRET);
  // Desk-style token: `id` claim instead of `userId`.
  const tokenB = jwt.sign({ id: 'rl-objectid-B' }, process.env.JWT_SECRET);

  const resA = await fetch(url, { headers: { Authorization: `Bearer ${tokenA}` } });
  const resB = await fetch(url, { headers: { Authorization: `Bearer ${tokenB}` } });
  // Each user's own bucket starts at 1500 → one request → 1499 each.
  assert.equal(remainingOf(resA), 1499);
  assert.equal(remainingOf(resB), 1499);

  const resA2 = await fetch(url, { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(remainingOf(resA2), 1498);
});
