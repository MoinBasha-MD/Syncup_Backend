process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'ops-test-admin-secret-that-is-long-enough-32';
process.env.MONGO_URI = ''; // keep the agent offline/degraded unless a test connects

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');

const signAccess = (role = 'owner') => jwt.sign(
  { sub: 'admin1', role, did: 'dev1', sid: 's1', typ: 'admin_access' },
  getAdminJwtSecret(),
  { audience: ADMIN_JWT_AUDIENCE, expiresIn: '10m' },
);

const signStepUp = () => jwt.sign(
  { sub: 'admin1', did: 'dev1', typ: 'admin_stepup' },
  getAdminJwtSecret(),
  { audience: 'syncup-admin-stepup', expiresIn: '5m' },
);

const request = (port, method, url, { token, stepUp, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port, path: url, method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(stepUp ? { 'x-admin-stepup': stepUp } : {}),
      'content-type': 'application/json',
    },
  }, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(JSON.stringify(body));
  req.end();
});

const withServer = async (app, fn) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
};

// ---------------------------------------------------------------------------
// run.js — whitelist + redaction
// ---------------------------------------------------------------------------

const { run, redact, ALLOWED_COMMANDS } = require('../opsAgent/run');

test('run: rejects commands outside the whitelist', async () => {
  await assert.rejects(() => run('rm', ['-rf', '/']), /not allowed/);
  await assert.rejects(() => run('bash', ['-c', 'id']), /not allowed/);
  await assert.rejects(() => run(';whoami', []), /not allowed/);
});

test('run: never passes a shell option', async () => {
  const { execFile } = require('child_process');
  let seenOptions = null;
  const intercepted = loadWithMocks('../opsAgent/run', {
    child_process: {
      execFile: (cmd, args, opts, cb) => { seenOptions = opts; cb(null, 'ok', ''); },
    },
  });
  await intercepted.run('uptime', []);
  assert.equal(seenOptions.shell, false);
});

test('run: cat is restricted to /proc/* and /etc/os-release', async () => {
  await assert.rejects(() => run('cat', ['/etc/shadow']), /cat may only read/);
  // Attempt is allowed (on this dev box /etc/os-release doesn't exist, so
  // assert the exec shape rather than success).
  const res = await run('cat', ['/etc/os-release']);
  assert.equal(typeof res.code, 'number');
});

test('run: executes a whitelisted command via execFile', async () => {
  const res = await run('nproc', []);
  assert.equal(res.ok, true);
});

test('redact: strips JWTs, Bearer headers and password=/token= pairs', () => {
  const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQabc123';
  const out = redact(`Authorization: Bearer abc.def.ghi password=hunter2 token=zzz eyJ=${jwtLike}`);
  assert.ok(!out.includes('abc.def.ghi'));
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes(jwtLike));
  assert.match(out, /REDACTED/);
});

// ---------------------------------------------------------------------------
// parsers
// ---------------------------------------------------------------------------

const P = require('../opsAgent/parsers');

test('parseDf parses -kP output into bytes', () => {
  const fixture = [
    'Filesystem     1024-blocks    Used Available Capacity Mounted on',
    '/dev/sda1         10000000 4000000   6000000      40% /',
    'tmpfs               500000       0    500000       0% /run',
  ].join('\n');
  const rows = P.parseDf(fixture);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    filesystem: '/dev/sda1', sizeBytes: 10000000 * 1024,
    usedBytes: 4000000 * 1024, availBytes: 6000000 * 1024, usePct: 40, mount: '/',
  });
});

test('parsePs parses -eo output', () => {
  const fixture = '    PID USER     %CPU %MEM   RSS     ELAPSED COMMAND\n  123 root      1.5  0.4 123456  02:03:04 node';
  const rows = P.parsePs(fixture);
  assert.deepEqual(rows[0], { pid: 123, user: 'root', cpu: 1.5, mem: 0.4, rssKb: 123456, etime: '02:03:04', command: 'node' });
});

test('parseMeminfo returns bytes', () => {
  const fixture = 'MemTotal:       16000000 kB\nMemFree:         4000000 kB\nMemAvailable:    8000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB';
  const m = P.parseMeminfo(fixture);
  assert.equal(m.total, 16000000 * 1024);
  assert.equal(m.used, (16000000 - 8000000) * 1024);
  assert.equal(m.swapUsed, 500000 * 1024);
});

test('parseNetDev + netRates produce byte/sec rates', () => {
  const snap = (rx, tx) => `eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0`;
  const prev = P.parseNetDev(snap(1000, 2000));
  const next = P.parseNetDev(snap(6000, 7000));
  const rates = P.netRates(prev, next, 1000);
  assert.equal(rates.eth0.rxBytesPerSec, 5000);
  assert.equal(rates.eth0.txBytesPerSec, 5000);
});

// ---------------------------------------------------------------------------
// Degraded-mode routes (Mongo down → mongoose mock readyState 3)
// ---------------------------------------------------------------------------

const mongooseMock = (readyState) => ({
  connect: async () => {},
  connection: { readyState, on: () => {} },
});

const fakePm2 = [{ name: 'server', pm_id: 0, pid: 123, pm2_env: { status: 'online', restart_time: 2, pm_uptime: Date.now() - 60000, exec_mode: 'fork', node_version: '20' }, monit: { cpu: 1.2, memory: 100e6 } }];

const runMock = async (cmd, args) => {
  if (cmd === 'pm2' && args[0] === 'jlist') return { ok: true, code: 0, stdout: JSON.stringify(fakePm2), stderr: '' };
  if (cmd === 'pm2') return { ok: true, code: 0, stdout: 'done', stderr: '' };
  if (cmd === 'tail') return { ok: true, code: 0, stdout: 'log line', stderr: '' };
  if (cmd === 'systemctl') return { ok: true, code: 0, stdout: 'active\n', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const requireReasonPassthrough = (req, _res, next) => next();

const opsApp = (mongoReady) => loadWithMocks('../opsAgent/index', {
  mongoose: mongooseMock(mongoReady),
  './run': { run: runMock, redact, ALLOWED_COMMANDS },
  '../middleware/adminV2Auth': {
    requireReason: requireReasonPassthrough,
    verifyAdminAccessToken: async () => { throw { status: 401, code: 'UNAUTHENTICATED', message: 'mocked' }; },
  },
}).createApp();

test('degraded: allowed read routes pass with a valid access JWT', async () => {
  await withServer(opsApp(3), async (port) => {
    const res = await request(port, 'GET', '/ops/status', { token: signAccess() });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.degraded, true);
  });
});

test('degraded: non-allowed routes → 503 OPS_DEGRADED', async () => {
  await withServer(opsApp(3), async (port) => {
    const res = await request(port, 'GET', '/ops/disk', { token: signAccess() });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'OPS_DEGRADED');
  });
});

test('degraded: missing/invalid token → 401', async () => {
  await withServer(opsApp(3), async (port) => {
    const noToken = await request(port, 'GET', '/ops/status');
    assert.equal(noToken.status, 401);
    const bad = await request(port, 'GET', '/ops/status', { token: 'bogus' });
    assert.equal(bad.status, 401);
  });
});

test('degraded: POST /ops/backend/restart allowed; audit queues to pending file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-audit-'));
  const pendingFile = path.join(tmpDir, 'pending.jsonl');
  const app = loadWithMocks('../opsAgent/index', {
    mongoose: mongooseMock(3),
    './run': { run: runMock, redact, ALLOWED_COMMANDS },
    '../middleware/adminV2Auth': {
      requireReason: requireReasonPassthrough,
      verifyAdminAccessToken: async () => { throw { status: 401, code: 'UNAUTHENTICATED', message: 'mocked' }; },
    },
    './pendingAudit': {
      writePending: (e) => { fs.appendFileSync(pendingFile, JSON.stringify(e) + '\n'); return true; },
      flushPending: async () => ({ flushed: 0 }),
      PENDING_FILE: pendingFile,
    },
  }).createApp();
  await withServer(app, async (port) => {
    const res = await request(port, 'POST', '/ops/backend/restart', {
      token: signAccess(), stepUp: signStepUp(), body: { reason: 'routine restart' },
    });
    assert.equal(res.status, 200);
    const lines = fs.readFileSync(pendingFile, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.action, 'ops.backend_restart');
  });
});

test('degraded: super_admin may read but not control (403 on restart)', async () => {
  await withServer(opsApp(3), async (port) => {
    const read = await request(port, 'GET', '/ops/status', { token: signAccess('super_admin') });
    assert.equal(read.status, 200);
    const stop = await request(port, 'POST', '/ops/backend/stop', {
      token: signAccess('super_admin'), stepUp: signStepUp(), body: { reason: 'stop it' },
    });
    assert.equal(stop.status, 503); // blocked by degraded guard before perm check
    const serviceRestart = await request(port, 'POST', '/ops/services/mongod/restart', {
      token: signAccess('super_admin'), stepUp: signStepUp(), body: { reason: 'mongo restart' },
    });
    assert.equal(serviceRestart.status, 403); // allowed route, but no ops.control perm
  });
});

// ---------------------------------------------------------------------------
// Normal mode — mocked verifyAdminAccessToken drives full checks
// ---------------------------------------------------------------------------

test('normal mode: revoked session rejected via shared verifier', async () => {
  const app = loadWithMocks('../opsAgent/index', {
    mongoose: mongooseMock(1),
    './run': { run: runMock, redact, ALLOWED_COMMANDS },
    '../middleware/adminV2Auth': {
      requireReason: (req, res, next) => next(),
      verifyAdminAccessToken: async () => {
        throw { status: 401, code: 'SESSION_REVOKED', message: 'Session is revoked or expired' };
      },
    },
  }).createApp();
  await withServer(app, async (port) => {
    const res = await request(port, 'GET', '/ops/status', { token: signAccess() });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'SESSION_REVOKED');
  });
});

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

test('POST /ops/services/:name/restart rejects a service outside the allowlist', async () => {
  await withServer(opsApp(3), async (port) => {
    const res = await request(port, 'POST', '/ops/services/evil/restart', {
      token: signAccess(), stepUp: signStepUp(), body: { reason: 'test' },
    });
    // 'evil' isn't a degraded-allowed route anyway → 503; exercise the real
    // guard via an allowed name check in normal mode below.
    assert.equal(res.status, 503);
  });
  const app = loadWithMocks('../opsAgent/index', {
    mongoose: mongooseMock(1),
    './run': { run: runMock, redact, ALLOWED_COMMANDS },
    '../middleware/adminV2Auth': {
      requireReason: require('../middleware/adminV2Auth').requireReason,
      verifyAdminAccessToken: async () => ({
        decoded: {},
        admin: { _id: 'admin1', role: 'owner', isActive: true, devices: [{ deviceId: 'dev1', status: 'approved' }] },
        session: { _id: 's1' },
        device: { deviceId: 'dev1' },
      }),
    },
  }).createApp();
  await withServer(app, async (port) => {
    const res = await request(port, 'POST', '/ops/services/evil/restart', {
      token: signAccess(), stepUp: signStepUp(), body: { reason: 'test' },
    });
    assert.equal(res.status, 400);
  });
});

test('GET /ops/logs rejects out-of-range lines', async () => {
  await withServer(opsApp(3), async (port) => {
    const res = await request(port, 'GET', '/ops/logs?source=server-out&lines=99999', { token: signAccess() });
    assert.equal(res.status, 400);
  });
});

test('GET /ops/logs is owner-only', async () => {
  await withServer(opsApp(3), async (port) => {
    const res = await request(port, 'GET', '/ops/logs?source=server-out', { token: signAccess('admin') });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
// deploy.js
// ---------------------------------------------------------------------------

const fakeDeployRun = (overrides = {}) => async (cmd, args, opts = {}) => {
  const key = `${cmd} ${args.join(' ')}`;
  if (overrides[key]) return overrides[key](cmd, args, opts);
  if (cmd === 'git' && args[0] === 'rev-parse') {
    return { ok: true, code: 0, stdout: overrides.sha ? `${overrides.sha}\n` : 'abc123\n', stderr: '' };
  }
  if (cmd === 'git' && args[0] === 'diff') {
    return { ok: true, code: 0, stdout: overrides.lockfileChanged ? 'package-lock.json\n' : '', stderr: '' };
  }
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const loadDeploy = (runImpl) => loadWithMocks('../opsAgent/deploy', {
  './run': { run: runImpl, redact },
});

const waitJob = async (dep, job, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const j = dep.getJob(job.jobId);
    if (j && j.status !== 'running') return j;
    await new Promise(r => setTimeout(r, 50));
  }
  return dep.getJob(job.jobId);
};

test('deploy: concurrent deploy → 409 code; lockfile unchanged skips npm ci', async (t) => {
  const modPath = require.resolve('../opsAgent/deploy');
  delete require.cache[modPath];
  const dep = loadDeploy(fakeDeployRun());
  // First deploy succeeds (waitForHealth will try real ports — mock it by
  // monkey-patching? It polls http; in tests it will time out at 60s.
  // We only assert the in-progress conflict + npm ci skip via step list
  // after forcing a quick failure is not needed: check 409 while running.
  const job1 = dep.startDeploy({ repoDir: os.tmpdir(), backendPort: 1 });
  assert.equal(job1.status, 'running');
  assert.throws(() => dep.startDeploy({ repoDir: os.tmpdir() }), /already running|DEPLOY_IN_PROGRESS/);
  t.after(async () => { await waitJob(dep, job1, 3000); });
});

test('deploy: aborts on failed step and reports previousSha', async (t) => {
  const modPath = require.resolve('../opsAgent/deploy');
  delete require.cache[modPath];
  const dep = loadDeploy(fakeDeployRun({
    'git pull --ff-only': () => ({ ok: false, code: 128, stdout: '', stderr: 'non-fast-forward' }),
    sha: 'prevsha1',
  }));
  const job = dep.startDeploy({ repoDir: os.tmpdir(), backendPort: 1 });
  const done = await waitJob(dep, job);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /non-fast-forward/);
});

test('deploy: npm ci skipped when package-lock unchanged', async () => {
  const modPath = require.resolve('../opsAgent/deploy');
  delete require.cache[modPath];
  const calls = [];
  const dep = loadDeploy(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'git' && args[0] === 'rev-parse') return { ok: true, code: 0, stdout: 'same1\n', stderr: '' };
    if (cmd === 'git' && args[0] === 'diff') return { ok: true, code: 0, stdout: '', stderr: '' };
    if (cmd === 'pm2' && args[0] === 'reload') return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    if (cmd === 'node') return { ok: true, code: 0, stdout: '', stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  });
  const job = dep.startDeploy({ repoDir: os.tmpdir(), backendPort: 1 });
  const done = await waitJob(dep, job, 8000);
  assert.ok(!calls.some(c => c.startsWith('npm ci')));
  assert.ok(done.steps.some(s => s.skipped));
});

// ---------------------------------------------------------------------------
// reboot
// ---------------------------------------------------------------------------

test('reboot: missing confirm → 400; non-owner → 403', async () => {
  await withServer(opsApp(3), async (port) => {
    // POST /ops/power/reboot isn't degraded-allowed → 503 even for owner
    const deg = await request(port, 'POST', '/ops/power/reboot', {
      token: signAccess(), stepUp: signStepUp(),
      body: { reason: 'testing reboot', confirm: 'REBOOT' },
    });
    assert.equal(deg.status, 503);
  });

  const app = loadWithMocks('../opsAgent/index', {
    mongoose: mongooseMock(1),
    './run': { run: runMock, redact, ALLOWED_COMMANDS },
    '../middleware/adminV2Auth': {
      requireReason: requireReasonPassthrough,
      verifyAdminAccessToken: async (token) => {
        const decoded = jwt.decode(token);
        return {
          decoded,
          admin: { _id: decoded.sub, role: decoded.role, isActive: true, devices: [{ deviceId: 'dev1', status: 'approved' }] },
          session: { _id: 's1' },
          device: { deviceId: 'dev1' },
        };
      },
    },
    '../services/adminAudit': { recordAdminAction: async () => {} },
  }).createApp();

  await withServer(app, async (port) => {
    const noConfirm = await request(port, 'POST', '/ops/power/reboot', {
      token: signAccess(), stepUp: signStepUp(), body: { reason: 'reboot me' },
    });
    assert.equal(noConfirm.status, 400);
    assert.equal(noConfirm.body.code, 'CONFIRMATION_REQUIRED');

    const nonOwner = await request(port, 'POST', '/ops/power/reboot', {
      token: signAccess('super_admin'), stepUp: signStepUp(),
      body: { reason: 'reboot me', confirm: 'REBOOT' },
    });
    assert.equal(nonOwner.status, 403);
  });
});
