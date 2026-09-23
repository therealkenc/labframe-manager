import { QUERY_LIMITS } from '@therealkenc/telemetry/query';

const REQUEST_TRANSPORT_GRACE_MILLISECONDS = 5_000;

export const UI = {
  pollMilliseconds: 5_000,
  requestTimeoutMilliseconds: QUERY_LIMITS.maxTimeoutMs + REQUEST_TRANSPORT_GRACE_MILLISECONDS,
  discoveryLimit: QUERY_LIMITS.discoveryResults,
  pageLimit: QUERY_LIMITS.pageRecords,
  maximumRecords: 1_000,
  defaultWindowMinutes: 60,
  millisecondsPerMinute: 60_000,
  nanosecondsPerMillisecond: QUERY_LIMITS.nanosecondsPerMillisecond,
  loggerWrapWidth: 120,
  jsonIndent: 2,
} as const;

export interface WindowOption {
  readonly minutes: number;
  readonly label: string;
}

export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { minutes: 15, label: 'Last 15 minutes' },
  { minutes: 60, label: 'Last hour' },
  { minutes: 360, label: 'Last 6 hours' },
  { minutes: 1_440, label: 'Last 24 hours' },
  {
    minutes:
      (QUERY_LIMITS.maxWindowDays * QUERY_LIMITS.millisecondsPerDay) / UI.millisecondsPerMinute,
    label: `Last ${QUERY_LIMITS.maxWindowDays} days`,
  },
] as const;

export const EMPTY = '';
export const INITIAL_HEALTH = {
  status: 'unknown',
  description: 'Waiting for the first telemetry query.',
  stale: false,
  lastAttemptAt: undefined,
  lastSuccessAt: undefined,
  lastFailure: undefined,
} as const;

export const ROOT_ELEMENT_ID = 'root';
