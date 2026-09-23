import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { loadAuthenticationResources } from '../../src/authentication-resources.js';
import { createHostManagementApp } from '../../src/http-app.js';
import { createPasswordGate } from '../../src/password-gate.js';
import { emptyTelemetry, quietLog, unavailableStatus } from './telemetry-fixtures.js';

test('real Manager gate protects all data and static routes when dependencies are down', async (t: TestContext) => {
  const resources = await loadAuthenticationResources();
  const result = await createPasswordGate({
    ...resources,
    password: 'test-only-manager-password',
    publicOrigin: 'https://portal.example.test',
    basePath: '/console',
    policy: {
      sessionLifetimeSeconds: 60,
      maximumSessions: 2,
      attemptWindowMilliseconds: 1000,
      maximumAttemptsPerWindow: 10,
      maximumConcurrentAuthentications: 2,
    },
    log: quietLog,
    now: Date.now,
  });
  assert.equal(result.ok, true);
  t.after(result.value.close);
  const app = createHostManagementApp({
    gate: result.value,
    basePath: '/console',
    log: quietLog,
    staticRoot: resolve(import.meta.dirname, '../../resources'),
    statusReader: unavailableStatus,
    telemetry: emptyTelemetry(),
  });
  for (const path of [
    '/console/api/service-info',
    '/console/api/v1/status',
    '/console/api/v1/telemetry/targets',
  ]) {
    assert.equal((await app.request(path)).status, 401);
  }
  assert.equal((await app.request('/console/login.html')).status, 303);
  const health = await app.request('/console/health');
  assert.deepEqual(await health.json(), { service: 'labframe-manager', status: 'ok' });
  const form = await app.request('/console/auth/login');
  assert.equal(form.status, 200);
  assert.equal(form.headers.get('referrer-policy'), 'same-origin');
  assert.match(form.headers.get('content-security-policy') ?? '', /form-action 'self'/u);
  assert.match(await form.text(), /action="\/console\/auth\/login"/u);
  assert.equal((await app.request('/console/auth/login.css')).status, 200);
  assert.equal((await app.request('/console/auth/manager-mark.svg')).status, 200);

  const login = await app.request('/console/auth/login', {
    method: 'POST',
    headers: {
      Origin: 'https://portal.example.test',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'test-only-manager-password' }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie !== undefined && cookie.length > 0);
  const headers = { Cookie: cookie };
  assert.equal((await app.request('/console/api/service-info', { headers })).status, 200);
  assert.equal((await app.request('/console/login.html', { headers })).status, 200);
  assert.equal((await app.request('/console/api/v1/status', { headers })).status, 503);
});
