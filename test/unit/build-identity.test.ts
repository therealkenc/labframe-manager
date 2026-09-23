import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { MANAGEMENT_BUILD_VERSION } from '../../src/build-identity.js';
import { createHostManagementApp } from '../../src/http-app.js';
import { emptyTelemetry, quietLog, unavailableStatus } from './telemetry-fixtures.js';
import { routeTestGate } from './management-fixtures.js';

const DEVELOPMENT_IDENTITY = { kind: 'development', product: 'labframe-manager' } as const;
const ENTRY_PATH = resolve(import.meta.dirname, '../../dist/main.js');
const SCRATCH_ROOT = resolve(import.meta.dirname, '../../tmp/build-identity');
const CLI_TIMEOUT_MILLISECONDS = 5_000;
const IMPORT_ENTRY = "await import((await import('node:url')).pathToFileURL(process.argv[1]).href)";

test('service info identifies only this manager under its configured mount', async () => {
  const app = createHostManagementApp({
    basePath: '/nested/console',
    gate: routeTestGate,
    log: quietLog,
    staticRoot: import.meta.dirname,
    statusReader: unavailableStatus,
    telemetry: emptyTelemetry(),
  });
  const response = await app.request('/nested/console/api/service-info');
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { build: DEVELOPMENT_IDENTITY });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await app.request('/api/service-info')).status, 404);
  assert.equal(
    (await app.request('/nested/console/api/service-info', { method: 'POST' })).status,
    404
  );
  assert.equal(MANAGEMENT_BUILD_VERSION, 'development');
});

const assertCliIdentity = (arguments_: readonly string[], cwd: string): void => {
  const result = spawnSync(process.execPath, arguments_, {
    cwd,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MILLISECONDS,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const identity: unknown = JSON.parse(result.stdout);
  assert.deepEqual(identity, DEVELOPMENT_IDENTITY);
};

test('compiled manager prints build identity without site configuration or services', async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  const cwd = await mkdtemp(resolve(SCRATCH_ROOT, 'manager-'));
  ['--version', '--build-info'].forEach((argument: string): void => {
    assertCliIdentity([ENTRY_PATH, argument], cwd);
    assertCliIdentity(['--input-type=module', '--eval', IMPORT_ENTRY, ENTRY_PATH, argument], cwd);
  });
});
