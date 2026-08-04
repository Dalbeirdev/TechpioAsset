/**
 * v2.10 S1 — the measurement half of the rig.
 *
 * `perf/probe.mjs` measures the demo tenant, and says so honestly in its own
 * docstring: "a modest, honest read-path measurement on demo-scale data". This
 * one measures the LOAD tenant — 100k assets, 1M stock movements, 2M audit rows
 * — which is the only volume at which any of these numbers mean anything.
 *
 * It writes a JSON baseline so a later run can be compared against it rather
 * than against a memory of what the numbers looked like.
 *
 *   node perf/load-probe.mjs --label baseline
 *   node perf/load-probe.mjs --label after-s2 --compare baseline
 *
 * Endpoints marked UNBOUNDED are the ones this release exists to fix: they
 * return every matching row rather than a page. They are measured first at the
 * volume that makes that visible.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baselines');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'http://localhost:3001/api/v1');
const N = Number(arg('n', 60));
const CONCURRENCY = Number(arg('concurrency', 6));
const LABEL = arg('label', 'run');
const COMPARE = arg('compare', null);
const EMAIL = arg('email', 'load1@load.invalid');
const PASSWORD = process.env.PW || 'TechpioDemo!2026';

/** p95 targets from the v2.10 acceptance criteria, in milliseconds. */
const TARGETS = { list: 300, dashboard: 800 };

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `login as ${EMAIL} failed (${res.status}). Generate the tenant first: ` +
        'pnpm --filter @techpioasset/api perf:generate',
    );
  }
  return (await res.json()).data.accessToken;
}

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

/**
 * Statuses that mean THE MEASUREMENT IS INVALID rather than the endpoint is
 * unhealthy.
 *
 * The first version of this probe counted a 429 as an endpoint error and
 * printed "60 ERRORS" next to `/assets?q=`, which reads exactly like a broken
 * endpoint. It was the rate limiter: 14 endpoints x 60 requests is 840, and the
 * API allows 120 a minute. A rig that reports the limiter as a defect in the
 * thing it is measuring is worse than no rig.
 */
const INVALIDATING = new Map([
  [429, 'rate limited — raise RATE_LIMIT_MAX for the measurement run (see perf/README.md)'],
  [401, 'unauthenticated — the token expired mid-run or the rig user lost its role'],
  [403, 'forbidden — the rig user is missing permissions; regenerate the tenant'],
]);

async function measure(request) {
  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  let bytes = 0;
  let next = 0;

  async function worker() {
    while (next < N) {
      next += 1;
      const start = performance.now();
      try {
        const res = await request();
        const body = await res.text();
        const ms = performance.now() - start;
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (res.status >= 400) errors += 1;
        else {
          latencies.push(ms);
          bytes = Math.max(bytes, body.length);
        }
      } catch {
        errors += 1;
        statuses.set(0, (statuses.get(0) ?? 0) + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Loud, immediate, and fatal: a contaminated run must not be written to a
  // baseline file where it will be compared against later.
  for (const [status, why] of INVALIDATING) {
    if (statuses.get(status)) {
      throw new Error(`${statuses.get(status)} of ${N} requests returned ${status} — ${why}`);
    }
  }

  latencies.sort((a, b) => a - b);
  return {
    ok: latencies.length,
    errors,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.at(-1) ?? 0,
    // The largest response seen. For an unbounded endpoint this is the number
    // that grows with the tenant, and the one a page cap is meant to flatten.
    maxBytes: bytes,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const ms = (n) => `${n.toFixed(0)}ms`.padStart(8);
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${(n / 1024).toFixed(0)}KB`).padStart(8);

async function main() {
  // A fresh token per endpoint: 14 logins is nothing next to 840 requests, and
  // it removes "the token expired halfway through" as a source of mystery.
  let token = await login();
  const get = (path) => () => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  const cases = [
    // The unbounded reads this release exists to fix.
    ['GET /stock/levels', 'UNBOUNDED', get('/stock/levels'), 'list'],
    ['GET /stock/items', 'UNBOUNDED', get('/stock/items'), 'list'],
    ['GET /stock/batches', 'UNBOUNDED', get('/stock/batches'), 'list'],
    ['GET /stock/locations', 'UNBOUNDED', get('/stock/locations'), 'list'],
    // Paginated reads, at volume.
    ['GET /assets p1', 'paged', get('/assets?pageSize=25'), 'list'],
    ['GET /assets p1000', 'paged', get('/assets?pageSize=25&page=1000'), 'list'],
    ['GET /assets ?q=', 'paged', get('/assets?pageSize=25&q=Load%20asset%209'), 'list'],
    ['GET /assets ?status=', 'paged', get('/assets?pageSize=25&status=AVAILABLE'), 'list'],
    ['GET /stock/movements', 'paged', get('/stock/movements?pageSize=25'), 'list'],
    ['GET /audit', 'paged', get('/audit?pageSize=25'), 'list'],
    // Aggregates.
    ['GET /dashboard', 'aggregate', get('/dashboard'), 'dashboard'],
    ['GET /analytics/overview', 'aggregate', get('/analytics/overview'), 'dashboard'],
    ['GET /analytics/spend', 'aggregate', get('/analytics/spend'), 'dashboard'],
    // Control: nothing about this should change with tenant size.
    ['GET /auth/me', 'control', get('/auth/me'), 'list'],
  ];

  console.log(`\nLoad probe — ${BASE}`);
  console.log(`  ${N} requests/endpoint, concurrency ${CONCURRENCY}, as ${EMAIL}`);
  console.log(`  label: ${LABEL}${COMPARE ? `, comparing against: ${COMPARE}` : ''}\n`);

  let previous = null;
  if (COMPARE) {
    const file = join(BASELINE_DIR, `${COMPARE}.json`);
    if (!existsSync(file)) throw new Error(`No baseline named "${COMPARE}" at ${file}`);
    previous = JSON.parse(readFileSync(file, 'utf8'));
  }

  console.log(
    `  ${pad('endpoint', 26)}${pad('kind', 11)}${'p50'.padStart(8)}${'p95'.padStart(8)}` +
      `${'p99'.padStart(8)}${'maxResp'.padStart(9)}  verdict`,
  );
  console.log(`  ${'-'.repeat(86)}`);

  const results = {};
  for (const [name, kind, request, budget] of cases) {
    token = await login();
    const r = await measure(request);
    results[name] = { ...r, kind, budget };
    const target = TARGETS[budget];
    const over = r.p95 > target;
    let verdict = r.errors ? `${r.errors} ERRORS` : over ? `OVER (${target}ms)` : 'ok';
    if (previous?.results?.[name]) {
      const before = previous.results[name].p95;
      const delta = ((r.p95 - before) / (before || 1)) * 100;
      verdict += `  ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs ${COMPARE}`;
    }
    console.log(
      `  ${pad(name, 26)}${pad(kind, 11)}${ms(r.p50)}${ms(r.p95)}${ms(r.p99)}${kb(r.maxBytes)}  ${verdict}`,
    );
  }

  const payload = {
    label: LABEL,
    takenAt: new Date().toISOString(),
    base: BASE,
    requestsPerEndpoint: N,
    concurrency: CONCURRENCY,
    targets: TARGETS,
    results,
  };
  mkdirSync(BASELINE_DIR, { recursive: true });
  const out = join(BASELINE_DIR, `${LABEL}.json`);
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);

  const breaches = Object.entries(results).filter(([, r]) => r.p95 > TARGETS[r.budget] || r.errors);
  console.log(`\n  ${breaches.length} of ${cases.length} endpoints miss their target or error.`);
  console.log(`  written: perf/baselines/${LABEL}.json\n`);
}

main().catch((error) => {
  console.error(`\nProbe failed: ${error.message}\n`);
  process.exitCode = 1;
});
