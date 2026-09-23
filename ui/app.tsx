import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import type { QueryTargetInfo } from '@therealkenc/telemetry/query';

import { EMPTY, WINDOW_OPTIONS, type WindowOption } from './constants.js';
import { Dependencies } from './dependencies.js';
import { FilterBar } from './filter-bar.js';
import { formatTime } from './format.js';
import { LogPanel } from './log-panel.js';
import { initialSelection, type Selection } from './model.js';
import { SourceList } from './source-list.js';
import { useTargets, useTelemetry, type TelemetryView } from './use-telemetry.js';

type Section = 'telemetry' | 'dependencies';

const Connection = ({ view }: { readonly view: TelemetryView }): JSX.Element => {
  const { health, logs } = view.snapshot;
  const failed = health.error.length > 0 || logs.error.length > 0;
  const condition = failed ? 'unavailable' : health.value.stale ? 'degraded' : health.value.status;
  return (
    <span className={`connection ${condition}`} title={health.error || health.value.description}>
      <span className="connection-dot" aria-hidden="true" />
      {failed
        ? 'Query unavailable'
        : health.value.stale
          ? 'Stale observation'
          : health.value.status === 'healthy'
            ? 'Last query succeeded'
            : view.loading
              ? 'Reading telemetry'
              : 'Awaiting telemetry'}
    </span>
  );
};

export const App = (): JSX.Element => {
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [following, setFollowing] = useState(true);
  const [section, setSection] = useState<Section>('telemetry');
  const targetState = useTargets();
  const view = useTelemetry(selection, following && section === 'telemetry', (): void =>
    setFollowing(false)
  );
  useEffect(() => {
    const target = targetState.targets.at(0);
    if (target !== undefined) {
      setSelection((previous: Selection) =>
        previous.target.length === 0 ? { ...previous, target: target.id } : previous
      );
    }
  }, [targetState.targets]);
  const target = targetState.targets.find(
    (entry: QueryTargetInfo) => entry.id === selection.target
  );
  const changeSelection = (next: Selection): void => setSelection(next);

  return (
    <div className="console-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Labframe management home">
          <img className="brand-mark" src="./auth/manager-mark.svg" alt="" width="31" height="31" />
          <span>
            Labframe<span className="brand-divider">/</span>
            <strong>Management</strong>
          </span>
        </a>
        <div className="session-actions">
          <Connection view={view} />
          <form action="./auth/logout" method="post">
            <button className="button subtle" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <span className="eyebrow">Operations console</span>
            <h1>Telemetry &amp; health</h1>
          </div>
          <nav className="section-switch" aria-label="Console sections">
            <button
              type="button"
              aria-pressed={section === 'telemetry'}
              className={section === 'telemetry' ? 'active' : ''}
              onClick={() => setSection('telemetry')}
            >
              Telemetry
            </button>
            <button
              type="button"
              aria-pressed={section === 'dependencies'}
              className={section === 'dependencies' ? 'active' : ''}
              onClick={() => setSection('dependencies')}
            >
              Dependencies
            </button>
          </nav>
        </div>
        {section === 'dependencies' ? (
          <Dependencies />
        ) : (
          <>
            <div className="query-toolbar">
              <label className="target-selector">
                Telemetry target
                <select
                  value={selection.target}
                  disabled={targetState.loading}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    changeSelection({
                      ...selection,
                      target: event.target.value,
                      source: EMPTY,
                      run: EMPTY,
                    })
                  }
                >
                  {targetState.targets.length === 0 && (
                    <option value="">
                      {targetState.loading ? 'Loading targets…' : 'No targets configured'}
                    </option>
                  )}
                  {targetState.targets.map((entry: QueryTargetInfo) => (
                    <option value={entry.id} key={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Time window
                <select
                  value={selection.minutes}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    changeSelection({ ...selection, minutes: Number(event.target.value) })
                  }
                >
                  {WINDOW_OPTIONS.map((option: WindowOption) => (
                    <option value={option.minutes} key={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="retention-hint">
                {target === undefined
                  ? ''
                  : `${target.retentionDays} day retention · ${targetState.timeZone}`}
              </span>
              <div className="refresh-actions">
                <button
                  type="button"
                  className={`button ${following ? 'follow-active' : ''}`}
                  aria-pressed={following}
                  onClick={() => setFollowing((previous: boolean) => !previous)}
                >
                  <span aria-hidden="true">{following ? 'Ⅱ' : '▷'}</span>
                  {following ? 'Pause' : 'Follow'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={view.loading || selection.target.length === 0}
                  onClick={view.refresh}
                >
                  {view.loading ? 'Reading…' : 'Refresh'}
                </button>
              </div>
            </div>
            {targetState.error.length > 0 && (
              <p className="inline-notice warning" role="alert">
                Cannot discover targets: {targetState.error}
              </p>
            )}
            <div className="telemetry-layout">
              <SourceList
                sources={view.snapshot.sources}
                selected={selection.source}
                onSelect={(source: string) => changeSelection({ ...selection, source, run: EMPTY })}
                timeZone={targetState.timeZone}
                loading={view.loading}
              />
              <div className="telemetry-main">
                <FilterBar selection={selection} onChange={changeSelection} />
                <LogPanel
                  view={view}
                  selection={selection}
                  onChange={changeSelection}
                  timeZone={targetState.timeZone}
                  following={following}
                />
              </div>
            </div>
            <footer className="console-footer">
              <span>
                {view.snapshot.logs.updatedAt === 0
                  ? 'No completed log query'
                  : `Last successful query ${formatTime(view.snapshot.logs.updatedAt, targetState.timeZone)}`}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
};
