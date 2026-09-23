import type { QueryPage, QueryResult, QueryWindow, RunPage } from '@therealkenc/telemetry/query';

import {
  TELEMETRY_API,
  telemetryHealthResultSchema,
  telemetryLogsResultSchema,
  telemetryRunsResultSchema,
  telemetrySourcesResultSchema,
} from '../src/api-contracts.js';
import { request } from './api.js';
import type { Selection, SnapshotResults } from './model.js';
import { logRequest, olderRequest, runRequest, sourceRequest } from './query-requests.js';

const readRuns = (
  selection: Selection,
  window: QueryWindow,
  signal: AbortSignal
): Promise<QueryResult<RunPage>> =>
  selection.source.length === 0
    ? Promise.resolve({ ok: true, value: { window, runs: [], truncated: false, notes: [] } })
    : request(TELEMETRY_API.runs, telemetryRunsResultSchema, runRequest(selection, window), signal);

export const readSnapshot = async (
  selection: Selection,
  window: QueryWindow,
  signal: AbortSignal
): Promise<SnapshotResults> => {
  const [sources, runs, logs] = await Promise.all([
    request(
      TELEMETRY_API.sources,
      telemetrySourcesResultSchema,
      sourceRequest(selection, window),
      signal
    ),
    readRuns(selection, window, signal),
    request(TELEMETRY_API.logs, telemetryLogsResultSchema, logRequest(selection, window), signal),
  ]);
  const health = await request(
    TELEMETRY_API.health,
    telemetryHealthResultSchema,
    { target: selection.target, probe: false },
    signal
  );
  return { sources, runs, logs, health };
};

export const readOlder = (
  target: string,
  cursor: string,
  signal: AbortSignal
): Promise<QueryResult<QueryPage>> =>
  request(TELEMETRY_API.logs, telemetryLogsResultSchema, olderRequest(target, cursor), signal);
