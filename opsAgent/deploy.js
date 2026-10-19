const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { run, redact } = require('./run');

/**
 * Deploy job: fetch → pull --ff-only → npm ci (only if the lockfile changed)
 * → node --check → pm2 reload → health poll. One at a time; last 10 jobs are
 * kept in memory and mirrored to logs/ops-deploy-jobs.json.
 */

const JOBS_FILE = path.join(__dirname, '..', 'logs', 'ops-deploy-jobs.json');
const MAX_OUTPUT_LINES = 200;

const jobs = new Map(); // jobId → job
let running = false;

const tailLines = (text, n = MAX_OUTPUT_LINES) =>
  String(text || '').split('\n').filter(Boolean).slice(-n).join('\n');

const persistJobs = () => {
  try {
    const dir = path.dirname(JOBS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = [...jobs.values()].slice(-10);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[OPS] deploy jobs persist failed:', error.message);
  }
};

const getJob = (id) => jobs.get(id) || null;
const listJobs = () => [...jobs.values()].slice(-10);

const probeOnce = (useHttps, port) => new Promise((resolve) => {
  const mod = useHttps ? https : http;
  const req = mod.request(
    {
      host: '127.0.0.1',
      port,
      path: '/api/health',
      timeout: 3000,
      rejectUnauthorized: false,
    },
    (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    },
  );
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
  req.end();
});

const waitForHealth = async (port, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The backend serves HTTP on PORT unless ssl/key.pem+cert.pem exist — try both.
    if (await probeOnce(false, port)) return true;
    if (await probeOnce(true, port)) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
};

/**
 * Start a deploy job. Returns the job synchronously; the work continues in the
 * background. Throws {code:'DEPLOY_IN_PROGRESS'} if one is running.
 */
const startDeploy = ({ repoDir, backendPort, onDone } = {}) => {
  if (running) {
    const err = new Error('A deploy is already running');
    err.code = 'DEPLOY_IN_PROGRESS';
    throw err;
  }
  running = true;

  const job = {
    jobId: crypto.randomBytes(8).toString('hex'),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    steps: [],
    previousSha: null,
    newSha: null,
    error: null,
  };
  jobs.set(job.jobId, job);
  persistJobs();

  const step = async (name, fn) => {
    const s = { name, startedAt: new Date().toISOString(), durationMs: 0, ok: false, output: '' };
    job.steps.push(s);
    try {
      const result = await fn();
      s.ok = true;
      s.output = tailLines(typeof result === 'string' ? result : JSON.stringify(result));
      return result;
    } catch (error) {
      s.output = tailLines(redact(error.stdout || error.message));
      throw error;
    } finally {
      s.durationMs = Date.now() - new Date(s.startedAt).getTime();
      persistJobs();
    }
  };

  const runCmd = async (name, cmd, args, opts) => {
    const res = await run(cmd, args, opts);
    if (!res.ok) {
      const err = new Error(`${name} failed (exit ${res.code}): ${tailLines(res.stderr || res.stdout, 5)}`);
      err.stdout = res.stdout + '\n' + res.stderr;
      throw err;
    }
    return res.stdout;
  };

  (async () => {
    try {
      job.previousSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      await step('git fetch', () => runCmd('git fetch', 'git', ['fetch', '--quiet'], { cwd: repoDir, timeoutMs: 60000 }));
      await step('git pull --ff-only', () => runCmd('git pull', 'git', ['pull', '--ff-only'], { cwd: repoDir, timeoutMs: 120000 }));
      job.newSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

      const lockDiff = await run('git', ['diff', '--name-only', `${job.previousSha}..${job.newSha}`, '--', 'package-lock.json'], { cwd: repoDir });
      if (lockDiff.stdout.trim()) {
        await step('npm ci --omit=dev', () => runCmd('npm ci', 'npm', ['ci', '--omit=dev'], { cwd: repoDir, timeoutMs: 600000, maxBuffer: 2 * 1024 * 1024 }));
      } else {
        job.steps.push({ name: 'npm ci --omit=dev', skipped: true, output: 'package-lock.json unchanged', ok: true, durationMs: 0 });
      }

      await step('node --check server.js', () => runCmd('node --check', 'node', ['--check', 'server.js'], { cwd: repoDir }));
      await step('pm2 reload server', () => runCmd('pm2 reload', 'pm2', ['reload', 'server'], { cwd: repoDir, timeoutMs: 60000 }));
      await step('health check', async () => {
        const healthy = await waitForHealth(backendPort || 5000);
        if (!healthy) throw new Error('Backend did not become healthy within 60s');
        return 'backend healthy';
      });
      job.status = 'success';
    } catch (error) {
      job.status = 'failed';
      job.error = redact(error.message);
      // Tell the caller what to roll back to when the pull already landed.
      if (job.newSha && job.newSha !== job.previousSha) {
        job.rollbackSha = job.previousSha;
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      running = false;
      persistJobs();
      try { onDone?.(job); } catch { /* optional */ }
    }
  })();

  return job;
};

module.exports = { startDeploy, getJob, listJobs, waitForHealth };
