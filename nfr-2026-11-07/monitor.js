#!/usr/bin/env node
// Health monitor: appends one JSON line every 5s until duration elapses.
const fs = require('fs');
const BASE = process.argv[2] || 'https://api.crackman.in';
const SECONDS = Number(process.argv[3] || 21600);
const OUT = process.argv[4] || '/tmp/nfr-monitor.jsonl';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const t0 = performance.now();
    let status = 0, body = null;
    try {
      const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(10000) });
      status = r.status;
      body = await r.json();
    } catch (e) { /* status stays 0 */ }
    fs.appendFileSync(OUT, JSON.stringify({
      t: new Date().toISOString(), status,
      ms: Number((performance.now() - t0).toFixed(1)),
      heapPct: body?.checks?.memory?.heapUsedPercentage,
      db: body?.checks?.database?.status,
      uptime: Math.round(body?.uptime || 0),
    }) + '\n');
    await sleep(5000);
  }
})();
