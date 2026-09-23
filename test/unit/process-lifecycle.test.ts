import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ManagementLogger } from '../../src/contracts.js';
import {
  createHostManagementProcessLifecycle,
  type HostManagementProcessLifecycle,
} from '../../src/server.js';

const TIMEOUT_MILLISECONDS = 5;

interface LifecycleHarness {
  readonly events: string[];
  readonly lifecycle: HostManagementProcessLifecycle;
  readonly loggedContext: object[];
}

interface LifecycleHarnessOverrides {
  readonly closeServer?: () => Promise<void>;
  readonly flushLogs?: () => Promise<void>;
}

const harness = (overrides: LifecycleHarnessOverrides): LifecycleHarness => {
  const events: string[] = [];
  const loggedContext: object[] = [];
  const recordLog =
    (level: string) =>
    (_message: string, context: Readonly<object>): void => {
      events.push(level);
      loggedContext.push(context);
    };
  const log: ManagementLogger = {
    error: recordLog('error'),
    info: recordLog('info'),
    warn: recordLog('warn'),
  };
  return {
    events,
    lifecycle: createHostManagementProcessLifecycle({
      closeServer:
        overrides.closeServer ??
        ((): Promise<void> => {
          events.push('close');
          return Promise.resolve();
        }),
      exit: (code: number): void => {
        events.push(`exit:${String(code)}`);
      },
      flushLogs:
        overrides.flushLogs ??
        ((): Promise<void> => {
          events.push('flush');
          return Promise.resolve();
        }),
      forceCloseServer: (): void => {
        events.push('force-close');
      },
      log,
      logFlushTimeoutMilliseconds: TIMEOUT_MILLISECONDS,
      serverShutdownTimeoutMilliseconds: TIMEOUT_MILLISECONDS,
    }),
    loggedContext,
  };
};

test('listener failure closes, flushes, and exits with a fixed failure code', async () => {
  const proof = harness({});

  await proof.lifecycle.fatal({ kind: 'http-listener-error', description: 'address in use' });

  assert.deepEqual(proof.events, ['error', 'close', 'flush', 'exit:1']);
  assert.deepEqual(proof.loggedContext, [
    { failure: 'http-listener-error', description: 'address in use' },
  ]);
});

test('a fatal event during graceful shutdown records its cause and makes the single exit fail', async () => {
  const close = Promise.withResolvers<void>();
  const closeStarted = Promise.withResolvers<void>();
  const proof = harness({
    closeServer: () => {
      closeStarted.resolve();
      return close.promise;
    },
  });

  const signal = proof.lifecycle.signal('SIGTERM');
  await closeStarted.promise;
  const fatal = proof.lifecycle.fatal({
    kind: 'unhandled-rejection',
    description: 'late task failed',
  });
  assert.equal(signal, fatal);
  close.resolve();
  await Promise.all([signal, fatal]);

  assert.deepEqual(proof.events, ['info', 'error', 'flush', 'exit:1']);
  assert.deepEqual(proof.loggedContext, [
    { signal: 'SIGTERM' },
    { failure: 'unhandled-rejection', description: 'late task failed' },
  ]);
});

test('a stuck server close is bounded and force-closed before logs flush', async () => {
  const proof = harness({ closeServer: () => new Promise(() => undefined) });

  await proof.lifecycle.signal('SIGINT');

  assert.deepEqual(proof.events, ['info', 'force-close', 'warn', 'flush', 'exit:0']);
});

test('cleanup and fatal failure causes remain in telemetry', async () => {
  const proof = harness({
    closeServer: () => Promise.reject(new Error('HTTP close callback failed')),
  });

  await proof.lifecycle.fatal({
    kind: 'uncaught-exception',
    origin: 'uncaughtException',
    description: 'request dispatcher failed',
  });

  assert.deepEqual(proof.events, ['error', 'force-close', 'warn', 'flush', 'exit:1']);
  assert.match(JSON.stringify(proof.loggedContext), /HTTP close callback failed/u);
  assert.match(JSON.stringify(proof.loggedContext), /request dispatcher failed/u);
  assert.match(JSON.stringify(proof.loggedContext), /uncaughtException/u);
});

test('a stuck log flush is bounded before fatal exit', async () => {
  const proof = harness({
    flushLogs: () => new Promise(() => undefined),
  });

  await proof.lifecycle.fatal({ kind: 'startup-rejection', description: 'configuration failed' });

  assert.deepEqual(proof.events, ['error', 'close', 'warn', 'exit:1']);
});
