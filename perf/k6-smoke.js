/**
 * k6 load smoke test for the TechpioAsset API (spec section 26: performance).
 *
 * Run with the real tool once installed:
 *   k6 run -e BASE=http://localhost:3001/api/v1 -e PW='TechpioDemo!2026' perf/k6-smoke.js
 *
 * It logs in once per virtual user, then loops the read paths a dashboard hits
 * on load — the asset list, a spending report, and the profile — and asserts
 * p95 latency and error-rate thresholds. Kept deliberately modest (read-only,
 * demo-scale data) so it is a regression tripwire, not a stress test.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3001/api/v1';
const PASSWORD = __ENV.PW || 'TechpioDemo!2026';

const errorRate = new Rate('business_errors');
const listLatency = new Trend('asset_list_latency', true);

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // 95% of requests under 500ms, and fewer than 1% business errors.
    http_req_duration: ['p(95)<500'],
    business_errors: ['rate<0.01'],
    asset_list_latency: ['p(95)<400'],
  },
};

function login(email) {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json('data.accessToken');
}

export default function () {
  // Split load across two representative roles.
  const email = __VU % 2 === 0 ? 'finance@techpioasset.dev' : 'employee@techpioasset.dev';
  const token = login(email);
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const list = http.get(`${BASE}/assets?pageSize=25`, authHeaders);
  listLatency.add(list.timings.duration);
  errorRate.add(list.status >= 400);
  check(list, { 'asset list ok': (r) => r.status === 200 });

  const me = http.get(`${BASE}/auth/me`, authHeaders);
  errorRate.add(me.status >= 400);

  if (email === 'finance@techpioasset.dev') {
    const report = http.get(`${BASE}/reports?type=SPENDING_BY_VENDOR`, authHeaders);
    errorRate.add(report.status >= 400);
    check(report, { 'report ok': (r) => r.status === 200 });
  }

  sleep(1);
}
