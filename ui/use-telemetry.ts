import { useEffect, useRef, useState } from 'react';
import type { QueryPage, QueryResult, QueryTargetInfo } from '@therealkenc/telemetry/query';

import {
  TELEMETRY_API,
  telemetryTargetsResultSchema,
  type TelemetryTargets,
} from '../src/api-contracts.js';
import { request } from './api.js';
import { EMPTY, UI } from './constants.js';
import {
  emptySnapshot,
  mergeOlderRecords,
  observeSnapshot,
  recentWindow,
  type ConsoleSnapshot,
  type Selection,
  type SnapshotResults,
} from './model.js';
import { readOlder, readSnapshot } from './queries.js';

interface TargetState {
  readonly targets: readonly QueryTargetInfo[];
  readonly timeZone: string;
  readonly error: string;
  readonly loading: boolean;
}

export interface TelemetryView {
  readonly snapshot: ConsoleSnapshot;
  readonly loading: boolean;
  readonly loadingOlder: boolean;
  readonly refresh: () => void;
  readonly loadOlder: () => void;
}

export const useTargets = (): TargetState => {
  const [state, setState] = useState<TargetState>({
    targets: [],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    error: EMPTY,
    loading: true,
  });
  useEffect(() => {
    const controller = new AbortController();
    void request(
      TELEMETRY_API.targets,
      telemetryTargetsResultSchema,
      undefined,
      controller.signal
    ).then((result: QueryResult<TelemetryTargets>) => {
      if (controller.signal.aborted) {
        return;
      }
      setState((previous: TargetState) =>
        result.ok
          ? {
              targets: result.value.targets,
              timeZone: result.value.timeZone,
              error: EMPTY,
              loading: false,
            }
          : { ...previous, error: result.error.description, loading: false }
      );
    });
    return (): void => controller.abort();
  }, []);
  return state;
};

/** Owns query generations and cancellation so polling and pagination cannot mix snapshots. */
export const useTelemetry = (
  selection: Selection,
  following: boolean,
  pause: () => void
): TelemetryView => {
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot>(() =>
    emptySnapshot(recentWindow(selection.minutes))
  );
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestState = useRef({ busy: false, selectionKey: EMPTY, generation: 0 });
  const olderController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (selection.target.length === 0) {
      return;
    }
    const controller = new AbortController();
    const window = recentWindow(selection.minutes);
    const key = JSON.stringify(selection);
    olderController.current?.abort();
    setLoadingOlder(false);
    if (requestState.current.selectionKey !== key) {
      setSnapshot(emptySnapshot(window));
    }
    requestState.current = {
      busy: true,
      selectionKey: key,
      generation: requestState.current.generation + 1,
    };
    setLoading(true);
    void readSnapshot(selection, window, controller.signal).then((result: SnapshotResults) => {
      if (!controller.signal.aborted) {
        setSnapshot((previous: ConsoleSnapshot) => observeSnapshot(previous, result));
        requestState.current.busy = false;
        setLoading(false);
      }
    });
    return (): void => controller.abort();
  }, [selection, revision]);

  useEffect(() => {
    if (!following) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!requestState.current.busy && !document.hidden) {
        setRevision((previous: number) => previous + 1);
      }
    }, UI.pollMilliseconds);
    return (): void => window.clearInterval(timer);
  }, [following]);

  useEffect(() => (): void => olderController.current?.abort(), []);

  const loadOlder = (): void => {
    const cursor = snapshot.logs.value.nextCursor;
    if (cursor === undefined || loading || loadingOlder) {
      return;
    }
    pause();
    const generation = requestState.current.generation;
    const controller = new AbortController();
    olderController.current = controller;
    setLoadingOlder(true);
    void readOlder(selection.target, cursor, controller.signal).then(
      (result: QueryResult<QueryPage>) => {
        if (!controller.signal.aborted && generation === requestState.current.generation) {
          setSnapshot((previous: ConsoleSnapshot) => ({
            ...previous,
            logs: mergeOlderRecords(previous.logs, result),
          }));
          setLoadingOlder(false);
        }
      }
    );
  };

  return {
    snapshot,
    loading,
    loadingOlder,
    loadOlder,
    refresh: (): void => setRevision((previous: number) => previous + 1),
  };
};
