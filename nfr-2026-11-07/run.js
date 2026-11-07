#!/usr/bin/env node
// Read-only non-functional smoke test. Usage: node run.js [baseUrl] [samples]
const fs = require('fs');
const BASE = process.argv[2] || 'https://api.crackman.in';
const N = Number(process.argv[3] || 15);
const req = (p) => fetch(BASE + p, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const ms = (t) => Number(t.toFixed(1));

async function sample(path) {
  const lat = [], codes = [], errs = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    try {
      const r = await req(path);
      codes.push(r.status);
      await r.arrayBuffer();
    } catch (e) { errs.push(e.name); codes.push(0); }
    lat.push(performance.now() - t0);
  }
  return { path, n: N, p50_ms: ms(pct(lat, 50)), p95_ms: ms(pct(lat, 95)),
    max_ms: ms(Math.max(...lat)), errors: errs.length, codes: [...new Set(codes)].join(',') };
}

(async () => {
  const out = { target: BASE, at: new Date().toISOString(), endpoints: [], checks: {} };

  for (const p of ['/health/live', '/health/ready', '/health', '/api/health'])
    out.endpoints.push(await sample(p));

  // One small concurrent burst on the DB-free liveness route.
  const t0 = performance.now();
  const burst = await Promise.allSettled(Array.from({ length: 10 }, () => req('/health/live')));
  out.checks.burst10_liveness = {
    ok: burst.filter(b => b.status === 'fulfilled' && b.value.status === 200).length,
    total_ms: ms(performance.now() - t0),
  };

  // Headers / exposure checks.
  const h = await req('/health');
  const hd = Object.fromEntries([...h.headers].filter(([k]) => /strict-transport|content-security|x-frame|x-content-type|x-powered-by|access-control|server/i.test(k)));
  out.checks.headers = hd;
  const m = await req('/metrics');
  const body = m.ok ? await m.text() : '';
  out.checks.metrics_public = { status: m.status, leaks_memory: /heapUsed/.test(body), leaks_version: /version/.test(body) };
  const nf = await req('/api/does-not-exist-nfr');
  const nfb = await nf.text();
  out.checks.unknown_route = { status: nf.status, json: (() => { try { JSON.parse(nfb); return true; } catch { return false; } })() };

  // Self-check: percentiles must be ordered.
  for (const e of out.endpoints) if (!(e.p50_ms <= e.p95_ms && e.p95_ms <= e.max_ms)) throw new Error('percentile order broken');

  fs.writeFileSync(__dirname + '/result.json', JSON.stringify(out, null, 2));
  console.table(out.endpoints);
  console.log(JSON.stringify(out.checks, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
