import {
  queryOk,
  type LogQueryRequest,
  type QueryHealth,
  type QueryDiagnostic,
  type QueryPage,
  type QueryResult,
  type QueryService,
  type RunPage,
  type RunQuery,
  type SourcePage,
  type SourceQuery,
  type TargetQuery,
} from '@therealkenc/telemetry/query';
import { createConfiguredQueryService, loadQueryConfig } from '@therealkenc/telemetry/query-node';

import type { TelemetryTargets } from './api-contracts.js';
import type { ManagementLogger } from './contracts.js';

export interface ManagementTelemetry {
  readonly targets: () => QueryResult<TelemetryTargets>;
  readonly sources: (request: TargetQuery<SourceQuery>) => Promise<QueryResult<SourcePage>>;
  readonly runs: (request: TargetQuery<RunQuery>) => Promise<QueryResult<RunPage>>;
  readonly logs: (request: TargetQuery<LogQueryRequest>) => Promise<QueryResult<QueryPage>>;
  readonly health: (target: string, probe: boolean) => Promise<QueryResult<QueryHealth>>;
  readonly close: () => void;
}

const unavailableTelemetry = (
  failure: Extract<QueryResult<never>, { ok: false }>
): ManagementTelemetry => ({
  targets: () => failure,
  sources: () => Promise.resolve(failure),
  runs: () => Promise.resolve(failure),
  logs: () => Promise.resolve(failure),
  health: () => Promise.resolve(failure),
  close: (): void => {},
});

export const createManagementTelemetry = (
  queries: QueryService,
  timeZone: string
): ManagementTelemetry => ({
  targets: () => queryOk({ targets: queries.listTargets(), timeZone }),
  sources: queries.listSources,
  runs: queries.listRuns,
  logs: queries.queryLogs,
  health: (target: string, probe: boolean) =>
    probe ? queries.probe(target) : Promise.resolve(queries.health(target)),
  close: queries.close,
});

export const loadManagementTelemetry = async (
  configuredPath: string,
  log: ManagementLogger
): Promise<ManagementTelemetry> => {
  const config = await loadQueryConfig(configuredPath);
  if (!config.ok) {
    log.error('Management telemetry configuration is unavailable', config.error);
    return unavailableTelemetry(config);
  }
  const queries = createConfiguredQueryService({
    config: config.value,
    fetch: globalThis.fetch.bind(globalThis),
    now: Date.now,
    observeFailure: (diagnostic: QueryDiagnostic) =>
      log.warn('Management telemetry query failed', diagnostic),
  });
  return createManagementTelemetry(queries, config.value.timeZone);
};
