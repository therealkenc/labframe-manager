import type { Context, Next } from 'hono';
import type { ManagementAuthenticationConfig } from '../../src/config.js';
import type { PasswordGate } from '../../src/password-gate.js';

export const authenticationConfig: ManagementAuthenticationConfig = {
  secretsFile: '~/.labframe/secrets.json',
  passwordSecret: 'management.password',
  publicOrigin: 'http://localhost:3005',
  policy: {
    sessionLifetimeSeconds: 28_800,
    maximumSessions: 256,
    attemptWindowMilliseconds: 60_000,
    maximumAttemptsPerWindow: 30,
    maximumConcurrentAuthentications: 2,
  },
};

/** Route-contract tests supply a pass-through gate; authentication has its own integration tests. */
export const routeTestGate: PasswordGate = {
  middleware: async (_context: Context, next: Next): Promise<void> => {
    await next();
  },
  close: (): void => {},
};
