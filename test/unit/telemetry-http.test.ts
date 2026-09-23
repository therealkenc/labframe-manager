import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  queryFail,
  queryOk,
  type SourceQuery,
  type TargetQuery,
} from '@therealkenc/telemetry/query';

import { createHostManagementApp } from '../../src/http-app.js';
import { TELEMETRY_REQUEST_BYTES } from '../../src/constants.js';
import { loadManagementTelemetry, type ManagementTelemetry } from '../../src/telemetry.js';
import { emptyTelemetry, quietLog, unavailableStatus } from './telemetry-fixtures.js';
import { routeTestGate } from './management-fixtures.js';

const staticRoot = resolve(import.meta.dirname, '../../web');
const createApp = (telemetry: ManagementTelemetry): ReturnType<typeof createHostManagementApp> =>
  createHostManagementApp({
    statusReader: unavailableStatus,
    log: quietLog,
    staticRoot,
    telemetry,
    basePath: '/console',
    gate: routeTestGate,
  });
const sourceRequest: TargetQuery<SourceQuery> = {
  target: 'store',
  request: {
    window: { startNs: '1000000000', endNs: '2000000000' },
    match: '',
    limit: 20,
    metadata: { purpose: 'probe', count: 2, enabled: true },
  },
};
const post = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('discovery forwards the shared metadata request without requiring host inventory', async () => {
  const requests: TargetQuery<SourceQuery>[] = [];
  const app = createApp({
    ...emptyTelemetry(),
    sources: (request: TargetQuery<SourceQuery>) => {
      requests.push(request);
      return Promise.resolve(
        queryOk({
          window: request.request.window,
          sources: [],
          truncated: false,
          notes: ['No observations'],
        })
      );
    },
  });
  const response = await app.request('/console/api/v1/telemetry/sources', post(sourceRequest));
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [sourceRequest]);
  assert.deepEqual(await response.json(), {
    ok: true,
    value: {
      window: sourceRequest.request.window,
      sources: [],
      truncated: false,
      notes: ['No observations'],
    },
  });
});

test('invalid and oversized requests are bounded before reaching the provider', async () => {
  const app = createApp(emptyTelemetry());
  const invalid = await app.request(
    '/console/api/v1/telemetry/sources',
    post({
      ...sourceRequest,
      request: { ...sourceRequest.request, metadata: { nested: { unexpected: true } } },
    })
  );
  assert.equal(invalid.status, 400);
  const oversized = await app.request(
    '/console/api/v1/telemetry/sources',
    post({
      text: 'x'.repeat(TELEMETRY_REQUEST_BYTES),
    })
  );
  assert.equal(oversized.status, 413);
});

test('provider failure is distinct from empty discovery and manager health survives', async () => {
  const app = createApp({
    ...emptyTelemetry(),
    sources: () => Promise.resolve(queryFail('unavailable', 'Query store is offline')),
  });
  const response = await app.request('/console/api/v1/telemetry/sources', post(sourceRequest));
  assert.deepEqual(await response.json(), queryFail('unavailable', 'Query store is offline'));
  assert.equal((await app.request('/console/health')).status, 200);
});

test('missing query configuration remains a query failure without preventing manager startup', async () => {
  const queries = await loadManagementTelemetry(
    resolve(staticRoot, 'absent-targets.json'),
    quietLog
  );
  assert.equal(queries.targets().ok, false);
  assert.equal((await createApp(queries).request('/console/health')).status, 200);
  queries.close();
});

test('mounted UI redirects its root and serves relative assets without escaping the mount', async () => {
  const scratch = resolve(import.meta.dirname, '../../tmp');
  await mkdir(scratch, { recursive: true });
  const assets = await mkdtemp(resolve(scratch, 'management-mount-'));
  await writeFile(resolve(assets, 'index.html'), '<script src="./app.js"></script>');
  await writeFile(resolve(assets, 'app.js'), 'document.title = "Management";');
  const app = createHostManagementApp({
    statusReader: unavailableStatus,
    log: quietLog,
    staticRoot: assets,
    telemetry: emptyTelemetry(),
    basePath: '/console',
    gate: routeTestGate,
  });
  const root = await app.request('/console');
  assert.equal(root.status, 308);
  assert.equal(root.headers.get('location'), '/console/');
  assert.equal((await app.request('/console/')).status, 200);
  assert.equal((await app.request('/console/app.js')).status, 200);
  assert.equal((await app.request('/app.js')).status, 404);
});
