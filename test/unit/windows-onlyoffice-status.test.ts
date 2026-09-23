import assert from 'node:assert/strict';
import test from 'node:test';

import { fail, ok, type Result } from '@therealkenc/app-runtime/core';

import type {
  ManagementLogger,
  OnlyOfficeObservation,
  OnlyOfficeStatusReader,
  WindowsOnlyOfficeObservation,
} from '../../src/contracts.js';
import {
  createOnlyOfficeStatusReaderWithDependencies,
  type OnlyOfficeStatusDependencies,
} from '../../src/onlyoffice-status.js';

const DOCUMENT_SERVER_URL = 'http://127.0.0.1';
const HEALTH_URL = `${DOCUMENT_SERVER_URL}/healthcheck`;
const INSTALLATION_ROOT = 'C:\\Program Files\\ONLYOFFICE\\DocumentServer';
const LONG_AFTER_CACHE_TTL_MILLISECONDS = 60_000;

const RUNNING_SERVICES = [
  {
    displayName: 'ONLYOFFICE Document Server Converter',
    name: 'DsConverterSvc',
    processId: 101,
    startMode: 'Auto',
    state: 'Running',
  },
  {
    displayName: 'ONLYOFFICE Document Server DocService',
    name: 'DsDocServiceSvc',
    processId: 102,
    startMode: 'Auto',
    state: 'Running',
  },
  {
    displayName: 'ONLYOFFICE Document Server Proxy',
    name: 'DsProxySvc',
    processId: 103,
    startMode: 'Auto',
    state: 'Running',
  },
  {
    displayName: 'ONLYOFFICE Document Server Example',
    name: 'DsExampleSvc',
    processId: 0,
    startMode: 'Manual',
    state: 'Stopped',
  },
] as const;

const HEALTHY_PROBE = {
  installedVersion: '9.4.0.129',
  listeners: [{ address: '0.0.0.0', port: 80, processId: 110 }],
  notes: [],
  processes: [
    {
      name: 'WinSW-x64.exe',
      parentProcessId: 4,
      processId: 103,
      workingSetBytes: 8_192,
    },
    {
      name: 'nginx.exe',
      parentProcessId: 103,
      processId: 110,
      workingSetBytes: 16_384,
    },
  ],
  services: RUNNING_SERVICES,
};

interface LogEntry {
  readonly context: Readonly<object>;
  readonly level: 'error' | 'info' | 'warn';
  readonly message: string;
}

const silentLogger: ManagementLogger = {
  error: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
};

const createRecordingLogger = (entries: LogEntry[]): ManagementLogger => ({
  error: (message: string, context: Readonly<object>): void => {
    entries.push({ context, level: 'error', message });
  },
  info: (message: string, context: Readonly<object>): void => {
    entries.push({ context, level: 'info', message });
  },
  warn: (message: string, context: Readonly<object>): void => {
    entries.push({ context, level: 'warn', message });
  },
});

const serialize = (value: object): string => {
  const text = JSON.stringify(value);
  assert.notEqual(text, undefined);
  return text;
};

const createClock = (startedAt: number, finishedAt: number): (() => number) => {
  let invocation = 0;
  return (): number => {
    invocation += 1;
    return invocation === 1 ? startedAt : finishedAt;
  };
};

const createReader = (
  scriptResult: Result<string>,
  fetch: OnlyOfficeStatusDependencies['fetch'],
  performanceNow: () => number,
  logger: ManagementLogger
): OnlyOfficeStatusReader =>
  createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: ok(DOCUMENT_SERVER_URL),
      nativeProbe: { kind: 'windows', installationRoot: INSTALLATION_ROOT },
      logger,
    },
    {
      fetch,
      now: (): number => 0,
      performanceNow,
      runStatusScript: (): Promise<Result<string>> => Promise.resolve(scriptResult),
    }
  );

const nativeObservation = (observation: OnlyOfficeObservation): WindowsOnlyOfficeObservation => {
  assert.ok(observation.native.kind === 'windows');
  return observation.native;
};

test('reports healthy with ONLYOFFICE services and endpoint, independent of database topology', async () => {
  const calls: { readonly init: RequestInit; readonly url: string }[] = [];
  const reader = createReader(
    ok(serialize(HEALTHY_PROBE)),
    (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ init, url });
      return Promise.resolve(new Response('true', { status: 200 }));
    },
    createClock(100, 112.4),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'healthy');
  assert.deepEqual(observation.endpoint, {
    kind: 'healthy',
    url: HEALTH_URL,
    latencyMilliseconds: 12,
  });
  assert.equal(native.installedVersion, '9.4.0.129');
  assert.deepEqual(native.listeners, HEALTHY_PROBE.listeners);
  assert.deepEqual(native.processes, HEALTHY_PROBE.processes);
  assert.deepEqual(native.services, HEALTHY_PROBE.services);
  assert.deepEqual(native.notes, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, HEALTH_URL);
  assert.equal(calls[0]?.init.method, 'GET');
  assert.equal(calls[0]?.init.redirect, 'error');
});

test('keeps local services healthy when the endpoint is unhealthy', async () => {
  const logs: LogEntry[] = [];
  const reader = createReader(
    ok(serialize(HEALTHY_PROBE)),
    (): Promise<Response> => Promise.resolve(new Response('', { status: 503 })),
    createClock(100, 100),
    createRecordingLogger(logs)
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'healthy');
  assert.deepEqual(observation.endpoint, {
    description: 'ONLYOFFICE healthcheck returned HTTP 503.',
    kind: 'unhealthy',
    url: HEALTH_URL,
  });
  assert.deepEqual(native.notes, []);
  assert.equal(logs.at(-1)?.message, 'ONLYOFFICE endpoint observation failed');
});

test('reports a fully stopped service herd as stopped', async () => {
  const stoppedProbe = {
    ...HEALTHY_PROBE,
    listeners: [],
    processes: [],
    services: RUNNING_SERVICES.map((service: (typeof RUNNING_SERVICES)[number]) => ({
      ...service,
      processId: 0,
      state: 'Stopped',
    })),
  };
  const reader = createReader(
    ok(serialize(stoppedProbe)),
    (): Promise<Response> => Promise.reject(new Error('connection refused')),
    createClock(100, 100),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'stopped');
  assert.deepEqual(observation.endpoint, {
    description: 'ONLYOFFICE healthcheck request failed.',
    kind: 'unhealthy',
    url: HEALTH_URL,
  });
});

test('marks a missing core service degraded and names the missing service', async () => {
  const missingProxyProbe = {
    ...HEALTHY_PROBE,
    services: RUNNING_SERVICES.filter(
      (service: (typeof RUNNING_SERVICES)[number]) => service.name !== 'DsProxySvc'
    ),
  };
  const reader = createReader(
    ok(serialize(missingProxyProbe)),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'degraded');
  assert.deepEqual(native.notes, [
    'ONLYOFFICE Document Server Proxy is not installed or could not be queried.',
  ]);
});

test('marks a stopped core service degraded and reports its state', async () => {
  const stoppedProxyProbe = {
    ...HEALTHY_PROBE,
    services: RUNNING_SERVICES.map((service: (typeof RUNNING_SERVICES)[number]) =>
      service.name === 'DsProxySvc' ? { ...service, processId: 0, state: 'Stopped' } : service
    ),
  };
  const reader = createReader(
    ok(serialize(stoppedProxyProbe)),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'degraded');
  assert.deepEqual(native.notes, ['ONLYOFFICE Document Server Proxy is stopped.']);
});

test('maps a partial process query to degraded with a controlled note', async () => {
  const partialProbe = {
    ...HEALTHY_PROBE,
    notes: ['process-query-failed'],
    processes: [],
  };
  const reader = createReader(
    ok(serialize(partialProbe)),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'degraded');
  assert.deepEqual(native.notes, ['ONLYOFFICE process status could not be queried.']);
});

test('degrades when a required production service is not configured for automatic start', async () => {
  const manualConverterProbe = {
    ...HEALTHY_PROBE,
    services: RUNNING_SERVICES.map((service: (typeof RUNNING_SERVICES)[number]) =>
      service.name === 'DsConverterSvc' ? { ...service, startMode: 'Manual' } : service
    ),
  };
  const reader = createReader(
    ok(serialize(manualConverterProbe)),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'degraded');
  assert.deepEqual(native.notes, [
    'ONLYOFFICE Document Server Converter startup mode is Manual; expected Auto.',
  ]);
});

test('checks a proxied HTTPS mount independently of local Windows listeners', async () => {
  const observedUrls: string[] = [];
  const reader = createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: ok('https://documents.example.test/onlyoffice'),
      nativeProbe: { kind: 'windows', installationRoot: INSTALLATION_ROOT },
      logger: silentLogger,
    },
    {
      fetch: (url: string): Promise<Response> => {
        observedUrls.push(url);
        return Promise.resolve(new Response('true', { status: 200 }));
      },
      now: (): number => 0,
      performanceNow: createClock(100, 101),
      runStatusScript: (): Promise<Result<string>> => Promise.resolve(ok(serialize(HEALTHY_PROBE))),
    }
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.deepEqual(observedUrls, ['https://documents.example.test/onlyoffice/healthcheck']);
  assert.equal(observation.endpoint.kind, 'healthy');
  assert.equal(native.condition, 'healthy');
  assert.deepEqual(native.notes, []);
});

test('shares one in-flight refresh across concurrent readers', async () => {
  const script = Promise.withResolvers<Result<string>>();
  let fetches = 0;
  let scriptRuns = 0;
  const reader = createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: ok(DOCUMENT_SERVER_URL),
      nativeProbe: { kind: 'windows', installationRoot: INSTALLATION_ROOT },
      logger: silentLogger,
    },
    {
      fetch: (): Promise<Response> => {
        fetches += 1;
        return Promise.resolve(new Response('true', { status: 200 }));
      },
      now: (): number => 0,
      performanceNow: (): number => 0,
      runStatusScript: (): Promise<Result<string>> => {
        scriptRuns += 1;
        return script.promise;
      },
    }
  );

  const first = reader.read();
  const second = reader.read();
  await Promise.resolve();

  assert.strictEqual(first, second);
  assert.equal(scriptRuns, 1);
  assert.equal(fetches, 1);
  script.resolve(ok(serialize(HEALTHY_PROBE)));
  const [firstValue, secondValue] = await Promise.all([first, second]);
  assert.strictEqual(firstValue, secondValue);
});

test('serves a short-lived cached observation and refreshes after expiry', async () => {
  let currentTime = 100;
  let fetches = 0;
  let scriptRuns = 0;
  const reader = createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: ok(DOCUMENT_SERVER_URL),
      nativeProbe: { kind: 'windows', installationRoot: INSTALLATION_ROOT },
      logger: silentLogger,
    },
    {
      fetch: (): Promise<Response> => {
        fetches += 1;
        return Promise.resolve(new Response('true', { status: 200 }));
      },
      now: (): number => currentTime,
      performanceNow: (): number => 0,
      runStatusScript: (): Promise<Result<string>> => {
        scriptRuns += 1;
        return Promise.resolve(ok(serialize(HEALTHY_PROBE)));
      },
    }
  );

  const first = await reader.read();
  currentTime += 1;
  const cached = await reader.read();
  currentTime = LONG_AFTER_CACHE_TTL_MILLISECONDS;
  const refreshed = await reader.read();

  assert.strictEqual(cached, first);
  assert.notStrictEqual(refreshed, first);
  assert.equal(scriptRuns, 2);
  assert.equal(fetches, 2);
});

test('maps script execution failure to unavailable without exposing its error', async () => {
  const secret = 'JWT-SECRET-that-must-never-escape';
  const logs: LogEntry[] = [];
  const reader = createReader(
    fail(secret),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    createRecordingLogger(logs)
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);
  const visibleOutput = serialize({ logs, observation });

  assert.equal(native.condition, 'unavailable');
  assert.deepEqual(native.notes, ['The Windows ONLYOFFICE status probe is unavailable.']);
  assert.doesNotMatch(visibleOutput, /JWT-SECRET/u);
});

test('strictly rejects unexpected probe fields without reflecting their values', async () => {
  const secret = 'secret-from-an-unexpected-field';
  const invalidProbe = { ...HEALTHY_PROBE, jwtSecret: secret };
  const reader = createReader(
    ok(serialize(invalidProbe)),
    (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
    createClock(100, 101),
    silentLogger
  );

  const observation = await reader.read();
  const native = nativeObservation(observation);

  assert.equal(native.condition, 'unavailable');
  assert.doesNotMatch(serialize(observation), /secret-from/u);
});

test('missing endpoint configuration still permits local Windows observation', async () => {
  const logs: LogEntry[] = [];
  const reader = createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: fail('Site configuration is unavailable.'),
      nativeProbe: { kind: 'windows', installationRoot: INSTALLATION_ROOT },
      logger: createRecordingLogger(logs),
    },
    {
      fetch: (): Promise<Response> => assert.fail('No URL is configured'),
      now: (): number => 0,
      performanceNow: (): number => 0,
      runStatusScript: (): Promise<Result<string>> => Promise.resolve(ok(serialize(HEALTHY_PROBE))),
    }
  );
  const observation = await reader.read();
  assert.deepEqual(observation.endpoint, {
    kind: 'unavailable',
    description: 'Site configuration is unavailable.',
  });
  assert.equal(nativeObservation(observation).condition, 'healthy');
  assert.equal(logs.length, 1);
});

test('remote endpoint observation does not require local Windows inspection', async () => {
  const reader = createOnlyOfficeStatusReaderWithDependencies(
    {
      documentServerUrl: ok('https://documents.example.test'),
      nativeProbe: { kind: 'disabled' },
      logger: silentLogger,
    },
    {
      fetch: (): Promise<Response> => Promise.resolve(new Response('true', { status: 200 })),
      now: (): number => 0,
      performanceNow: (): number => 0,
      runStatusScript: (): Promise<Result<string>> => assert.fail('Local inspection is disabled'),
    }
  );
  const observation = await reader.read();
  assert.equal(observation.endpoint.kind, 'healthy');
  assert.deepEqual(observation.native, { kind: 'disabled' });
});
