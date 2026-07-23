/**
 * Dependency-free latency probe for the TechpioAsset API.
 *
 * A stand-in for k6 where the k6 binary is not installed: it drives real HTTP
 * against a running API and reports p50/p95/p99 per endpoint. Not a stress test
 * — a modest, honest read-path measurement on demo-scale data.
 *
 *   node perf/probe.mjs [baseUrl] [requestsPerEndpoint] [concurrency]
 */

const BASE = process.argv[2] || 'http://localhost:3001/api/v1';
const N = Number(process.argv[3] || 200);
const CONCURRENCY = Number(process.argv[4] || 10);
const PASSWORD = process.env.PW || 'TechpioDemo!2026';

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status}`);
  return (await res.json()).data.accessToken;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function measure(name, makeRequest) {
  const latencies = [];
  let errors = 0;
  let next = 0;

  async function worker() {
    while (next < N) {
      const i = next++;
      const start = performance.now();
      try {
        const res = await makeRequest(i);
        const ms = performance.now() - start;
        if (res.status >= 400) errors++;
        else latencies.push(ms);
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    name,
    ok: latencies.length,
    errors,
    mean: sum / (latencies.length || 1),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1] || 0,
  };
}

function fmt(n) {
  return `${n.toFixed(1)}ms`.padStart(9);
}

async function main() {
  const finance = await login('finance@techpioasset.dev');
  const employee = await login('employee@techpioasset.dev');
  const fh = { headers: { Authorization: `Bearer ${finance}` } };
  const eh = { headers: { Authorization: `Bearer ${employee}` } };

  const cases = [
    ['POST /auth/login', () =>
      fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'finance@techpioasset.dev', password: PASSWORD }),
      })],
    ['GET  /assets (admin scope)', () => fetch(`${BASE}/assets?pageSize=25`, fh)],
    ['GET  /assets (employee scope)', () => fetch(`${BASE}/assets?pageSize=25`, eh)],
    ['GET  /reports SPENDING_BY_VENDOR', () => fetch(`${BASE}/reports?type=SPENDING_BY_VENDOR`, fh)],
    ['GET  /auth/me', () => fetch(`${BASE}/auth/me`, fh)],
  ];

  console.log(`\nProbe: ${BASE}  (${N} requests/endpoint, concurrency ${CONCURRENCY})\n`);
  console.log(
    `${'endpoint'.padEnd(34)} ${'ok'.padStart(5)} ${'err'.padStart(4)} ${'mean'.padStart(9)} ${'p50'.padStart(9)} ${'p95'.padStart(9)} ${'p99'.padStart(9)} ${'max'.padStart(9)}`,
  );
  console.log('-'.repeat(104));
  for (const [name, fn] of cases) {
    const r = await measure(name, fn);
    console.log(
      `${r.name.padEnd(34)} ${String(r.ok).padStart(5)} ${String(r.errors).padStart(4)} ${fmt(r.mean)} ${fmt(r.p50)} ${fmt(r.p95)} ${fmt(r.p99)} ${fmt(r.max)}`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
