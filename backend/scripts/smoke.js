import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  PORT: '4000',
  DATABASE_URL: 'postgres://netprofit:1234567890@localhost:5433/netprofit',
};

const child = spawn('node', ['src/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env,
  stdio: 'ignore',
  shell: true,
});

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function requestJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url} -> ${res.status}: ${text}`);
  }
  return res.json();
}

try {
  await sleep(1800);
  const base = 'http://localhost:4000';
  const health = await requestJson(`${base}/health`);

  const login = await requestJson(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@local', password: 'admin123' }),
  });
  const headers = { Authorization: `Bearer ${login.token}` };

  const financeCenter = await requestJson(`${base}/dashboard/finance-center`, { headers }).catch(() => null);
  const opsV2 = await requestJson(`${base}/operations/v2?limit=5`, { headers }).catch(() => null);

  console.log('HEALTH', JSON.stringify(health));
  console.log('FINANCE_CENTER', JSON.stringify(financeCenter));
  console.log('OPS_V2', JSON.stringify(opsV2));
} finally {
  child.kill('SIGTERM');
}
