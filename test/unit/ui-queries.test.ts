import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUERY_LIMITS, type QueryWindow } from '@therealkenc/telemetry/query';

import {
  telemetryLogsRequestSchema,
  telemetryRunsRequestSchema,
  telemetrySourcesRequestSchema,
} from '../../src/api-contracts.js';
import { initialSelection, type Selection } from '../../ui/model.js';
import { logRequest, olderRequest, runRequest, sourceRequest } from '../../ui/query-requests.js';

const WINDOW: QueryWindow = {
  startNs: '1700000000000000000',
  endNs: '1700003600000000000',
};

const SELECTED: Selection = {
  ...initialSelection(),
  target: 'test',
  source: 'arbitrary-browser-source',
  run: 'emitter-on-another-continent',
  threshold: 'error',
  text: 'unexpected input',
  metadata: { purpose: 'probe', example_count: 3, example_flag: false },
};

test('UI discovery requests conform to the shared API including discovery bounds', (): void => {
  const sources = sourceRequest(SELECTED, WINDOW);
  const runs = runRequest(SELECTED, WINDOW);
  assert.equal(telemetrySourcesRequestSchema.safeParse(sources).success, true);
  assert.equal(telemetryRunsRequestSchema.safeParse(runs).success, true);
  assert.equal(sources.request.limit, QUERY_LIMITS.discoveryResults);
  assert.equal(runs.request.limit, QUERY_LIMITS.discoveryResults);
  assert.deepEqual(sources.request.metadata, SELECTED.metadata);
  assert.deepEqual(runs.request.metadata, SELECTED.metadata);
});

test('UI log requests preserve source identity, scalar metadata types, and the fixed window', (): void => {
  const logs = logRequest(SELECTED, WINDOW);
  assert.equal(telemetryLogsRequestSchema.safeParse(logs).success, true);
  assert.deepEqual(logs.request.window, WINDOW);
  assert.deepEqual(new Set(logs.request.filters.severities), new Set(['error', 'fatal']));
  assert.deepEqual(
    { ...logs.request.filters, severities: [] },
    {
      sources: [SELECTED.source],
      runIds: [SELECTED.run],
      severities: [],
      text: SELECTED.text,
      contextText: '',
      metadata: SELECTED.metadata,
    }
  );
});

test('UI defaults to debug and continuation retains the server query', (): void => {
  const selection = { ...initialSelection(), target: SELECTED.target };
  const initial = logRequest(selection, WINDOW);
  const continuation = olderRequest(SELECTED.target, 'opaque-server-cursor');
  assert.equal(telemetryLogsRequestSchema.safeParse(initial).success, true);
  assert.equal(telemetryLogsRequestSchema.safeParse(continuation).success, true);
  assert.equal(selection.threshold, 'debug');
  assert.deepEqual(
    new Set(initial.request.filters.severities),
    new Set(['debug', 'info', 'warn', 'error', 'fatal'])
  );
  assert.deepEqual(
    { ...initial.request.filters, severities: [] },
    {
      sources: [],
      runIds: [],
      severities: [],
      text: '',
      contextText: '',
      metadata: {},
    }
  );
  assert.deepEqual(continuation.request, {
    kind: 'continue',
    cursor: 'opaque-server-cursor',
    limit: QUERY_LIMITS.pageRecords,
  });
});
