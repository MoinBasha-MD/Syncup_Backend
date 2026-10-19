/** Pure parsers for command output — unit-tested against fixtures. */

const parseDf = (text) => String(text)
  .split('\n').slice(1)
  .map(l => l.trim().split(/\s+/))
  .filter(cols => cols.length >= 6)
  .map(cols => ({
    filesystem: cols[0],
    sizeBytes: parseInt(cols[1], 10) * 1024,
    usedBytes: parseInt(cols[2], 10) * 1024,
    availBytes: parseInt(cols[3], 10) * 1024,
    usePct: parseInt(cols[4], 10),
    mount: cols[5],
  }))
  .filter(r => Number.isFinite(r.sizeBytes));

const parsePs = (text) => String(text)
  .split('\n').slice(1)
  .map(l => l.trim().split(/\s+/))
  .filter(cols => cols.length >= 7)
  .map(cols => ({
    pid: parseInt(cols[0], 10),
    user: cols[1],
    cpu: parseFloat(cols[2]),
    mem: parseFloat(cols[3]),
    rssKb: parseInt(cols[4], 10),
    etime: cols[5],
    command: cols.slice(6).join(' '),
  }))
  .filter(p => Number.isFinite(p.pid));

const parseMeminfo = (text) => {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(\w+(?:\([^)]*\))?):\s+(\d+)\s*kB/);
    if (m) out[m[1]] = parseInt(m[2], 10) * 1024;
  }
  return {
    total: out.MemTotal || 0,
    free: out.MemFree || 0,
    available: out.MemAvailable || 0,
    used: (out.MemTotal || 0) - (out.MemAvailable || 0),
    buffers: out.Buffers || 0,
    cached: out.Cached || 0,
    swapTotal: out.SwapTotal || 0,
    swapFree: out.SwapFree || 0,
    swapUsed: (out.SwapTotal || 0) - (out.SwapFree || 0),
  };
};

const parseNetDev = (text) => {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\w[\w.-]*):\s*(.*)$/);
    if (!m) continue;
    const nums = m[2].trim().split(/\s+/).map(Number);
    if (nums.length < 9) continue;
    out[m[1]] = { rxBytes: nums[0], txBytes: nums[8] };
  }
  return out;
};

/** Rates between two /proc/net/dev snapshots, bytes/sec per interface. */
const netRates = (prev, next, intervalMs) => {
  const out = {};
  for (const [iface, n] of Object.entries(next)) {
    const p = prev[iface];
    if (!p || intervalMs <= 0) {
      out[iface] = { rxBytesPerSec: 0, txBytesPerSec: 0 };
      continue;
    }
    out[iface] = {
      rxBytesPerSec: Math.max(0, Math.round((n.rxBytes - p.rxBytes) / (intervalMs / 1000))),
      txBytesPerSec: Math.max(0, Math.round((n.txBytes - p.txBytes) / (intervalMs / 1000))),
    };
  }
  return out;
};

const parseOsRelease = (text) => {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(\w+)="?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
};

const parseSystemctlShow = (text) => {
  const out = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
};

const parsePm2Jlist = (text) => {
  try {
    const apps = JSON.parse(text);
    if (!Array.isArray(apps)) return [];
    return apps.map(a => ({
      name: a.name,
      pmId: a.pm_id,
      pid: a.pid,
      status: a.pm2_env?.status,
      restarts: a.pm2_env?.restart_time,
      uptime: a.pm2_env?.pm_uptime,
      cpu: a.monit?.cpu,
      memoryBytes: a.monit?.memory,
      execMode: a.pm2_env?.exec_mode,
      nodeVersion: a.pm2_env?.node_version,
      script: a.pm2_env?.pm_exec_path,
    }));
  } catch {
    return null;
  }
};

module.exports = {
  parseDf, parsePs, parseMeminfo, parseNetDev, netRates,
  parseOsRelease, parseSystemctlShow, parsePm2Jlist,
};
