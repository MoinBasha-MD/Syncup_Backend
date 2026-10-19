const { execFile } = require('child_process');

/**
 * Whitelisted command runner for the ops agent. NEVER uses a shell and never
 * concatenates user input into a command line — args are passed as an array
 * to execFile verbatim after route-level validation.
 */

const ALLOWED_COMMANDS = new Set([
  'pm2', 'df', 'du', 'ps', 'systemctl', 'journalctl', 'git', 'npm',
  'uptime', 'free', 'nproc', 'cat', 'tail', 'openssl', 'shutdown', 'nginx',
]);

const SECRET_PATTERNS = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]'], // JWTs
  [/Bearer\s+\S+/gi, 'Bearer [REDACTED]'],
  [/\b(password|passwd|secret|token|api[_-]?key|private[_-]?key)=([^\s"']+)/gi, '$1=[REDACTED]'],
];

const redact = (text) => SECRET_PATTERNS.reduce(
  (t, [re, rep]) => String(t).replace(re, rep),
  String(text ?? ''),
);

const run = (cmd, args = [], { timeoutMs = 15000, maxBuffer = 512 * 1024, cwd } = {}) => {
  if (!ALLOWED_COMMANDS.has(cmd)) {
    const err = new Error(`Command not allowed: ${cmd}`);
    err.code = 'CMD_NOT_ALLOWED';
    return Promise.reject(err);
  }
  if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) {
    const err = new Error('args must be an array of strings');
    err.code = 'BAD_ARGS';
    return Promise.reject(err);
  }
  if (cmd === 'cat' && !args.every(a => a.startsWith('/proc/') || a === '/etc/os-release')) {
    const err = new Error('cat may only read /proc/* and /etc/os-release');
    err.code = 'CMD_NOT_ALLOWED';
    return Promise.reject(err);
  }

  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      cmd, args,
      { timeout: timeoutMs, maxBuffer, shell: false, cwd },
      (error, stdout, stderr) => {
        const timedOut = !!(error && (error.killed || error.code === 'ETIMEDOUT'));
        resolve({
          ok: !error,
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          timedOut,
          stdout: redact(stdout).slice(-maxBuffer),
          stderr: redact(stderr).slice(-65536),
          durationMs: Date.now() - started,
        });
      },
    );
  });
};

module.exports = { run, redact, ALLOWED_COMMANDS };
