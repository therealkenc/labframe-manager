import type {
  ContinuedLogQuery,
  InitialLogQuery,
  QueryWindow,
  RunQuery,
  SourceQuery,
  TargetQuery,
} from '@therealkenc/telemetry/query';
import { querySeveritiesAtLeast } from '@therealkenc/telemetry/query';

import { EMPTY, UI } from './constants.js';
import type { Selection } from './model.js';

export const sourceRequest = (
  selection: Selection,
  window: QueryWindow
): TargetQuery<SourceQuery> => ({
  target: selection.target,
  request: { window, match: EMPTY, metadata: selection.metadata, limit: UI.discoveryLimit },
});

export const runRequest = (selection: Selection, window: QueryWindow): TargetQuery<RunQuery> => ({
  target: selection.target,
  request: {
    window,
    source: selection.source,
    metadata: selection.metadata,
    limit: UI.discoveryLimit,
  },
});

export const logRequest = (
  selection: Selection,
  window: QueryWindow
): TargetQuery<InitialLogQuery> => ({
  target: selection.target,
  request: {
    kind: 'initial',
    window,
    limit: UI.pageLimit,
    filters: {
      sources: selection.source.length === 0 ? [] : [selection.source],
      runIds: selection.run.length === 0 ? [] : [selection.run],
      severities: querySeveritiesAtLeast(selection.threshold),
      text: selection.text,
      contextText: EMPTY,
      metadata: selection.metadata,
    },
  },
});

export const olderRequest = (target: string, cursor: string): TargetQuery<ContinuedLogQuery> => ({
  target,
  request: { kind: 'continue', cursor, limit: UI.pageLimit },
});
