import type {
  QueryHealth,
  QueryPage,
  QueryRecord,
  QueryResult,
  QuerySeverityThreshold,
  QueryWindow,
  RunPage,
  SourcePage,
  TelemetryMetadata,
} from '@therealkenc/telemetry/query';
import { DEFAULT_QUERY_SEVERITY_THRESHOLD } from '@therealkenc/telemetry/query';

import { EMPTY, INITIAL_HEALTH, UI } from './constants.js';

export type SourceMetadata = TelemetryMetadata;
export type MetadataEntry = readonly [string, SourceMetadata[string]];

export interface Selection {
  readonly target: string;
  readonly source: string;
  readonly run: string;
  readonly minutes: number;
  readonly text: string;
  readonly threshold: QuerySeverityThreshold;
  readonly metadata: SourceMetadata;
}

export interface Observed<T> {
  readonly value: T;
  readonly error: string;
  readonly updatedAt: number;
}

export interface ConsoleSnapshot {
  readonly sources: Observed<SourcePage>;
  readonly runs: Observed<RunPage>;
  readonly logs: Observed<QueryPage>;
  readonly health: Observed<QueryHealth>;
}

export interface SnapshotResults {
  readonly sources: QueryResult<SourcePage>;
  readonly runs: QueryResult<RunPage>;
  readonly logs: QueryResult<QueryPage>;
  readonly health: QueryResult<QueryHealth>;
}

export const initialSelection = (): Selection => ({
  target: EMPTY,
  source: EMPTY,
  run: EMPTY,
  minutes: UI.defaultWindowMinutes,
  text: EMPTY,
  threshold: DEFAULT_QUERY_SEVERITY_THRESHOLD,
  metadata: {},
});

export const recentWindow = (minutes: number): QueryWindow => {
  const end = Date.now();
  const start = end - minutes * UI.millisecondsPerMinute;
  return {
    startNs: String(BigInt(start) * UI.nanosecondsPerMillisecond),
    endNs: String(BigInt(end) * UI.nanosecondsPerMillisecond),
  };
};

const unobserved = <T>(value: T): Observed<T> => ({ value, error: EMPTY, updatedAt: 0 });

export const emptySnapshot = (window: QueryWindow): ConsoleSnapshot => ({
  sources: unobserved({ window, sources: [], truncated: false, notes: [] }),
  runs: unobserved({ window, runs: [], truncated: false, notes: [] }),
  logs: unobserved({ window, records: [], nextCursor: undefined, notes: [] }),
  health: unobserved(INITIAL_HEALTH),
});

export const observe = <T>(previous: Observed<T>, result: QueryResult<T>): Observed<T> =>
  result.ok
    ? { value: result.value, error: EMPTY, updatedAt: Date.now() }
    : { ...previous, error: `${result.error.kind}: ${result.error.description}` };

export const observeSnapshot = (
  previous: ConsoleSnapshot,
  result: SnapshotResults
): ConsoleSnapshot => ({
  sources: observe(previous.sources, result.sources),
  runs: observe(previous.runs, result.runs),
  logs: observe(previous.logs, result.logs),
  health: observe(previous.health, result.health),
});

export const mergeOlderRecords = (
  previous: Observed<QueryPage>,
  result: QueryResult<QueryPage>
): Observed<QueryPage> => {
  if (!result.ok) {
    return observe(previous, result);
  }
  const records = [...previous.value.records, ...result.value.records];
  const distinct = [...new Map(records.map((record: QueryRecord) => [record.id, record])).values()];
  return {
    value: {
      ...result.value,
      records: distinct.slice(0, UI.maximumRecords),
      notes: [...new Set([...previous.value.notes, ...result.value.notes])],
    },
    error: EMPTY,
    updatedAt: Date.now(),
  };
};
