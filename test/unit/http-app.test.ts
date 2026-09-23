import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';

import type {
  HostManagementSnapshot,
  HostStatusReader,
  ManagementLogger,
} from '../../src/contracts.js';
import {
  createHostManagementApp as createHttpApp,
  hardenedInternalServerErrorResponse,
} from '../../src/http-app.js';
import { emptyTelemetry } from './telemetry-fixtures.js';
import { routeTestGate } from './management-fixtures.js';

const createHostManagementApp = (
  statusReader: HostStatusReader,
  log: ManagementLogger,
  staticRoot: string
): ReturnType<typeof createHttpApp> =>
  createHttpApp({
    statusReader,
    log,
    staticRoot,
    basePath: '',
    gate: routeTestGate,
    telemetry: emptyTelemetry(),
  });

const EXISTING_STATIC_ROOT = resolve(import.meta.dirname, '../..');

interface LoggedError {
  readonly context: Readonly<object>;
  readonly message: string;
}

interface RecordedLogger {
  readonly errors: LoggedError[];
  readonly log: ManagementLogger;
}

const recordedLogger = (): RecordedLogger => {
  const errors: LoggedError[] = [];
  return {
    errors,
    log: {
      error: (message: string, context: Readonly<object>): void => {
        errors.push({ context, message });
      },
      info: (): void => {},
      warn: (): void => {},
    },
  };
};

const snapshot = (): HostManagementSnapshot => ({
  control: { condition: 'healthy', processId: 101, version: '0.0.1' },
  observedAt: '2026-09-03T23:00:00.000Z',
  onlyOffice: {
    endpoint: {
      kind: 'healthy',
      latencyMilliseconds: 12,
      url: 'https://documents.example.test/healthcheck',
    },
    native: {
      kind: 'windows',
      condition: 'healthy',
      installedVersion: '9.4.0.129',
      listeners: [{ address: '127.0.0.1', port: 8085, processId: 202 }],
      notes: [],
      processes: [
        {
          name: 'docservice.exe',
          parentProcessId: 201,
          processId: 202,
          workingSetBytes: 1_024,
        },
      ],
      services: [
        {
          displayName: 'ONLYOFFICE Document Server Proxy',
          name: 'DsProxySvc',
          processId: 201,
          startMode: 'Auto',
          state: 'Running',
        },
      ],
    },
  },
});

const reader = (read: HostStatusReader['read']): HostStatusReader => ({ read });

const assertSecurityHeaders = (response: Response): void => {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/u);
  assert.match(response.headers.get('content-security-policy') ?? '', /form-action 'self'/u);
};

test('health reports only the manager and does not inspect managed units', async () => {
  let reads = 0;
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => {
      reads += 1;
      return Promise.reject(new Error('managed status unavailable'));
    }),
    recorded.log,
    EXISTING_STATIC_ROOT
  );

  const response = await app.request('/health');

  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    JSON.stringify({ service: 'labframe-manager', status: 'ok' })
  );
  assert.equal(reads, 0);
  assert.deepEqual(recorded.errors, []);
  assertSecurityHeaders(response);
});

test('status returns only the explicit public observation contract', async () => {
  const expected = snapshot();
  const contaminatedControl = Object.assign({}, expected.control, {
    secretPath: 'C:\\private\\manager-secret.json',
  });
  assert.ok(expected.onlyOffice.native.kind === 'windows');
  const contaminatedProcess = Object.assign({}, expected.onlyOffice.native.processes[0], {
    arguments: ['--jwt-secret=not-public'],
  });
  const contaminated = Object.assign({}, expected, {
    control: contaminatedControl,
    onlyOffice: Object.assign({}, expected.onlyOffice, {
      native: Object.assign({}, expected.onlyOffice.native, { processes: [contaminatedProcess] }),
    }),
  });
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => Promise.resolve(contaminated)),
    recorded.log,
    EXISTING_STATIC_ROOT
  );

  const response = await app.request('/api/v1/status');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(recorded.errors, []);
  assertSecurityHeaders(response);
});

test('status reader failure is logged and returns a bounded unavailable response', async () => {
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => {
      throw new Error('Windows inventory failed while opening a private resource');
    }),
    recorded.log,
    EXISTING_STATIC_ROOT
  );

  const unavailable = await app.request('/api/v1/status');
  const health = await app.request('/health');

  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    description: 'Host status is temporarily unavailable',
  });
  assert.equal(recorded.errors.length, 1);
  assert.equal(recorded.errors[0].message, 'Host management status read failed');
  assert.match(
    JSON.stringify(recorded.errors[0].context),
    /Windows inventory failed while opening a private resource/u
  );
  assert.match(JSON.stringify(recorded.errors[0].context), /HOST_MANAGEMENT_STATUS_READ_FAILED/u);
  assert.equal(health.status, 200);
  assertSecurityHeaders(unavailable);
});

test('unexpected request failures log the cause with credential fields redacted and keep HTTP fixed', async () => {
  const sensitiveText = 'not-public-credential-value';
  const brokenSnapshot = snapshot();
  Object.defineProperty(brokenSnapshot, 'control', {
    get: (): never => {
      throw new Error('inventory getter failed', {
        cause: { description: 'nested inventory failure', password: sensitiveText },
      });
    },
  });
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => Promise.resolve(brokenSnapshot)),
    recorded.log,
    EXISTING_STATIC_ROOT
  );

  const response = await app.request('/api/v1/status');
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(body, JSON.stringify({ description: 'Host management request failed' }));
  assert.equal(body.includes(sensitiveText), false);
  assert.equal(JSON.stringify(recorded.errors).includes(sensitiveText), false);
  assert.equal(recorded.errors.length, 1);
  assert.equal(recorded.errors[0].message, 'Host management HTTP request failed unexpectedly');
  const diagnostic = JSON.stringify(recorded.errors[0].context);
  assert.match(diagnostic, /inventory getter failed/u);
  assert.match(diagnostic, /nested inventory failure/u);
  assert.match(diagnostic, /\[redacted\]/u);
  assert.match(diagnostic, /HOST_MANAGEMENT_HTTP_REQUEST_FAILED/u);
  assertSecurityHeaders(response);
});

test('hardened adapter failure response is fixed and independently secured', async () => {
  const response = hardenedInternalServerErrorResponse();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    description: 'Host management request failed',
  });
  assertSecurityHeaders(response);
});

test('unknown API paths and unsupported API methods return bounded JSON', async () => {
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => Promise.resolve(snapshot())),
    recorded.log,
    EXISTING_STATIC_ROOT
  );

  const unknown = await app.request('/api/v1/missing?token=not-public');
  const unsupported = await app.request('/api/v1/status', { method: 'POST' });

  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get('content-type') ?? '', /^application\/json/u);
  assert.deepEqual(await unknown.json(), { description: 'Not found' });
  assert.equal(unsupported.status, 404);
  assert.deepEqual(await unsupported.json(), { description: 'Not found' });
  assertSecurityHeaders(unknown);
});

test('static UI files are served under the same hardened response policy', async (t: TestContext) => {
  const repositoryRoot = resolve(import.meta.dirname, '../..');
  const scratchRoot = resolve(repositoryRoot, 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const staticRoot = await mkdtemp(resolve(scratchRoot, 'host-management-http-'));
  await Promise.all([
    writeFile(resolve(staticRoot, 'index.html'), '<!doctype html><title>Host management</title>'),
    writeFile(resolve(staticRoot, 'app.js'), "document.title = 'Host management ready';\n"),
  ]);
  t.after(() => rm(staticRoot, { force: true, recursive: true }));
  const recorded = recordedLogger();
  const app = createHostManagementApp(
    reader((): Promise<HostManagementSnapshot> => Promise.resolve(snapshot())),
    recorded.log,
    staticRoot
  );

  const page = await app.request('/');
  const script = await app.request('/app.js');

  assert.equal(page.status, 200);
  assert.match(await page.text(), /Host management/u);
  assert.match(script.headers.get('content-type') ?? '', /javascript/u);
  assert.match(await script.text(), /Host management ready/u);
  assertSecurityHeaders(page);
  assertSecurityHeaders(script);
});
