import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import {
  createPasswordGate,
  type PasswordGate,
  type PasswordGatePolicy,
  type PasswordGateLoginState,
} from '../../src/password-gate.js';
import type { ManagementLogger } from '../../src/contracts.js';

export const TEST_PASSWORD = 'synthetic-manager-test-password';
export const TEST_ORIGIN = 'https://manager.example.test';
export const LOGIN_PATH = '/console/auth/login';
export const LOGOUT_PATH = '/console/auth/logout';
export const PROTECTED_PATH = '/console/api/status';
export const COOKIE_NAME = 'labframe_manager_session';
export const POLICY: PasswordGatePolicy = {
  sessionLifetimeSeconds: 60,
  maximumSessions: 4,
  attemptWindowMilliseconds: 60_000,
  maximumAttemptsPerWindow: 30,
  maximumConcurrentAuthentications: 2,
};

export interface GateProof {
  readonly app: Hono;
  readonly gate: PasswordGate;
  readonly clock: { value: number };
  readonly events: Set<string>;
}

export const createGateProof = async (policy: PasswordGatePolicy): Promise<GateProof> => {
  const clock = { value: 0 };
  const events = new Set<string>();
  const record = (message: string, context: Readonly<object>): void => {
    events.add(JSON.stringify({ message, context }));
  };
  const log: ManagementLogger = { error: record, info: record, warn: record };
  const created = await createPasswordGate({
    password: TEST_PASSWORD,
    publicOrigin: TEST_ORIGIN,
    basePath: '/console',
    policy,
    log,
    now: (): number => clock.value,
    loginPage: ({ error }: PasswordGateLoginState): string => `<html>Sign in:${error}</html>`,
    loginAssets: new Map([
      ['/auth/login.css', { content: 'body{}', contentType: 'text/css' }],
      ['/auth/manager-mark.svg', { content: '<svg/>', contentType: 'image/svg+xml' }],
    ]),
  });
  assert.ok(created.ok);
  const app = new Hono();
  app.use('*', created.value.middleware);
  app.get('/console/health', (context: Context): Response => context.json({ status: 'ok' }));
  app.all('*', (context: Context): Response => context.json({ protected: true }));
  return { app, gate: created.value, clock, events };
};

export const signIn = (app: Hono, password: string, cookie: string): Promise<Response> =>
  Promise.resolve(
    app.request(LOGIN_PATH, {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({ password }).toString(),
    })
  );

export const sessionCookie = (response: Response): string => {
  const header = response.headers.get('set-cookie');
  assert.ok(header !== null);
  const cookie = header.split(';').at(0);
  assert.ok(cookie !== undefined);
  return cookie;
};
