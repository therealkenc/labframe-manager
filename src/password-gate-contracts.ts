import type { MiddlewareHandler } from 'hono';
import type { ManagementLogger } from './contracts.js';

export interface PasswordGatePolicy {
  readonly sessionLifetimeSeconds: number;
  readonly maximumSessions: number;
  readonly attemptWindowMilliseconds: number;
  readonly maximumAttemptsPerWindow: number;
  readonly maximumConcurrentAuthentications: number;
}

export type PasswordGateLoginError = 'none' | 'rejected' | 'throttled' | 'unavailable';

export interface PasswordGateLoginState {
  readonly basePath: string;
  readonly error: PasswordGateLoginError;
}

export interface PasswordGateAsset {
  readonly content: string;
  readonly contentType: string;
}

export interface PasswordGateOptions {
  readonly password: string;
  readonly publicOrigin: string;
  readonly basePath: string;
  readonly policy: PasswordGatePolicy;
  readonly log: ManagementLogger;
  readonly loginPage: (state: PasswordGateLoginState) => string;
  readonly loginAssets: ReadonlyMap<string, PasswordGateAsset>;
  readonly now: () => number;
}

export interface PasswordGate {
  readonly middleware: MiddlewareHandler;
  readonly close: () => void;
}
