import {
  queryFail, queryOk, type SourceQuery, type RunQuery, type TargetQuery,
} from '@therealkenc/telemetry/query';
import type { HostStatusReader, ManagementLogger } from '../../src/contracts.js';
import type { ManagementTelemetry } from '../../src/telemetry.js';

export const emptyTelemetry = (): ManagementTelemetry => ({
  targets: () => queryOk({ timeZone: 'UTC', targets: [] }),
  sources: ({ request }: TargetQuery<SourceQuery>) =>
    Promise.resolve(
      queryOk({
        window: request.window,
        sources: [],
        truncated: false,
        notes: [],
      })
    ),
  runs: ({ request }: TargetQuery<RunQuery>) =>
    Promise.resolve(
      queryOk({
        window: request.window,
        runs: [],
        truncated: false,
        notes: [],
      })
    ),
  logs: () => Promise.resolve(queryFail('unavailable', 'No test query provider configured')),
  health: () => Promise.resolve(queryFail('unknown-target', 'No test query provider configured')),
  close: (): void => {},
});

export const quietLog: ManagementLogger = { error: () => {}, info: () => {}, warn: () => {} };

export const unavailableStatus: HostStatusReader = {
  read: () => Promise.reject(new Error('Native probe is unavailable')),
};
