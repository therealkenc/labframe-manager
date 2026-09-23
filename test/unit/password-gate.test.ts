import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COOKIE_NAME,
  LOGIN_PATH,
  LOGOUT_PATH,
  POLICY,
  PROTECTED_PATH,
  TEST_ORIGIN,
  TEST_PASSWORD,
  createGateProof,
  sessionCookie,
  signIn,
} from './password-gate-fixtures.js';

test('gate protects pages and every API route including direct loopback requests', async () => {
  const proof = await createGateProof(POLICY);
  const paths = [PROTECTED_PATH, '/console/api/telemetry/logs', '/console/api/service-info'];
  await Promise.all(
    paths.map(async (path: string): Promise<void> => {
      const response = await proof.app.request(`http://127.0.0.1:3004${path}`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { description: 'Sign in to use Labframe Manager.' });
    })
  );
  const html = await proof.app.request('/console/');
  assert.equal(html.status, 303);
  assert.equal(html.headers.get('location'), LOGIN_PATH);
  assert.equal((await proof.app.request('/console/index.html')).status, 303);
  assert.equal((await proof.app.request('/console/auth/login.css')).status, 200);
  assert.equal((await proof.app.request('/console/auth/manager-mark.svg')).status, 200);
  assert.equal((await proof.app.request('/console/health')).status, 200);
  assert.equal((await proof.app.request('/console/health', { method: 'POST' })).status, 303);
  assert.equal((await proof.app.request(LOGIN_PATH)).status, 200);
  proof.gate.close();
});

test('correct password creates an opaque secured cookie and wrong password reveals nothing', async () => {
  const proof = await createGateProof(POLICY);
  const denied = await signIn(proof.app, 'wrong-test-password', '');
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('set-cookie'), null);
  const response = await signIn(proof.app, TEST_PASSWORD, '');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/console/');
  const cookie = sessionCookie(response);
  const header = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^labframe_manager_session=[a-f0-9]{64}$/u);
  ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/console', 'Max-Age=60'].forEach(
    (attribute: string): void => assert.ok(header.includes(attribute))
  );
  assert.equal((await proof.app.request(PROTECTED_PATH, { headers: { cookie } })).status, 200);
  assert.equal(
    (await proof.app.request(LOGIN_PATH, { headers: { cookie } })).headers.get('location'),
    '/console/'
  );
  assert.ok(![...proof.events].join('\n').includes(TEST_PASSWORD));
  assert.ok(![...proof.events].join('\n').includes('wrong-test-password'));
  proof.gate.close();
});

test('expiry, explicit logout and restart invalidate sessions', async () => {
  const proof = await createGateProof(POLICY);
  const cookie = sessionCookie(await signIn(proof.app, TEST_PASSWORD, ''));
  proof.clock.value = POLICY.sessionLifetimeSeconds * 1_000;
  assert.equal((await proof.app.request(PROTECTED_PATH, { headers: { cookie } })).status, 401);
  const replacement = sessionCookie(await signIn(proof.app, TEST_PASSWORD, ''));
  const logout = await proof.app.request(LOGOUT_PATH, {
    method: 'POST',
    headers: {
      origin: TEST_ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
      cookie: replacement,
    },
    body: '',
  });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get('location'), LOGIN_PATH);
  assert.equal(
    (await proof.app.request(PROTECTED_PATH, { headers: { cookie: replacement } })).status,
    401
  );
  const beforeRestart = sessionCookie(await signIn(proof.app, TEST_PASSWORD, ''));
  proof.gate.close();
  const restarted = await createGateProof(POLICY);
  assert.equal(
    (await restarted.app.request(PROTECTED_PATH, { headers: { cookie: beforeRestart } })).status,
    401
  );
  restarted.gate.close();
});

test('login and logout require the configured origin and form type; GET never logs out', async () => {
  const proof = await createGateProof(POLICY);
  const cookie = sessionCookie(await signIn(proof.app, TEST_PASSWORD, ''));
  await Promise.all(
    [LOGIN_PATH, LOGOUT_PATH].map(async (path: string): Promise<void> => {
      const response = await proof.app.request(path, {
        method: 'POST',
        headers: {
          origin: 'https://other.example.test',
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
        },
        body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
      });
      assert.equal(response.status, 403);
      assert.equal((await proof.app.request(path, { method: 'POST' })).status, 403);
    })
  );
  assert.equal((await proof.app.request(LOGOUT_PATH, { headers: { cookie } })).status, 405);
  assert.equal((await proof.app.request(PROTECTED_PATH, { headers: { cookie } })).status, 200);
  assert.equal(
    (
      await proof.app.request(LOGIN_PATH, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    403
  );
  proof.gate.close();
});

test('malformed, duplicate and oversized forms are bounded and rejected', async () => {
  const proof = await createGateProof({ ...POLICY, maximumConcurrentAuthentications: 4 });
  await Promise.all(
    ['password=a&password=b', 'password=', 'other=a', `password=${'a'.repeat(5_000)}`].map(
      async (body: string): Promise<void> => {
        const response = await proof.app.request(LOGIN_PATH, {
          method: 'POST',
          headers: { origin: TEST_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        assert.equal(response.status, 400);
      }
    )
  );
  proof.gate.close();
});

test('session capacity is bounded; replacement revokes the previous token', async () => {
  const proof = await createGateProof({ ...POLICY, maximumSessions: 1 });
  const first = sessionCookie(await signIn(proof.app, TEST_PASSWORD, ''));
  assert.equal((await signIn(proof.app, TEST_PASSWORD, '')).status, 429);
  const replacement = sessionCookie(await signIn(proof.app, TEST_PASSWORD, first));
  assert.notEqual(replacement, first);
  assert.equal(
    (await proof.app.request(PROTECTED_PATH, { headers: { cookie: first } })).status,
    401
  );
  assert.equal(
    (await proof.app.request(PROTECTED_PATH, { headers: { cookie: replacement } })).status,
    200
  );
  proof.gate.close();
});

test('global login attempt and concurrency limits bound password verification', async () => {
  const proof = await createGateProof({ ...POLICY, maximumAttemptsPerWindow: 2 });
  assert.equal((await signIn(proof.app, 'wrong', '')).status, 401);
  assert.equal((await signIn(proof.app, 'wrong', '')).status, 401);
  assert.equal((await signIn(proof.app, TEST_PASSWORD, '')).status, 429);
  proof.clock.value = POLICY.attemptWindowMilliseconds;
  assert.equal((await signIn(proof.app, TEST_PASSWORD, '')).status, 303);
  proof.gate.close();
  const concurrent = await createGateProof({ ...POLICY, maximumConcurrentAuthentications: 1 });
  const responses = await Promise.all([
    signIn(concurrent.app, TEST_PASSWORD, ''),
    signIn(concurrent.app, TEST_PASSWORD, ''),
  ]);
  assert.deepEqual(
    responses.map((response: Response): number => response.status).sort(),
    [303, 429]
  );
  concurrent.gate.close();
});

test('encoded paths and forged cookies cannot bypass the gate or create open redirects', async () => {
  const proof = await createGateProof(POLICY);
  const cookie = `${COOKIE_NAME}=${'a'.repeat(64)}`;
  await Promise.all(
    [
      '/console/auth/login/../api/status',
      '/console/auth/login.css/../../api/status',
      '/console/%61pi/status',
      '/console/auth/login.css/extra',
      '/console/health/extra',
    ].map(async (path: string): Promise<void> => {
      const response = await proof.app.request(path, { headers: { cookie } });
      assert.ok(response.status === 303 || response.status === 401);
      assert.notEqual(response.status, 200);
    })
  );
  const response = await proof.app.request(`${LOGIN_PATH}?returnUrl=https://evil.example`, {
    method: 'POST',
    headers: { origin: TEST_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: TEST_PASSWORD }).toString(),
  });
  assert.equal(response.headers.get('location'), '/console/');
  proof.gate.close();
});
