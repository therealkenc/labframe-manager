import type { ChangeEvent, JSX } from 'react';
import type { QueryRecord, QueryRun } from '@therealkenc/telemetry/query';

import { UI } from './constants.js';
import { formatFullTimestamp, formatTimestamp } from './format.js';
import { LogRecord } from './log-record.js';
import type { Selection, SourceMetadata } from './model.js';
import type { TelemetryView } from './use-telemetry.js';

interface LogPanelProps {
  readonly view: TelemetryView;
  readonly selection: Selection;
  readonly onChange: (selection: Selection) => void;
  readonly timeZone: string;
  readonly following: boolean;
}

const RunSelector = ({ view, selection, onChange, timeZone }: LogPanelProps): JSX.Element => (
  <label className="run-selector">
    Emitter run
    <select
      value={selection.run}
      disabled={selection.source.length === 0}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onChange({ ...selection, run: event.target.value })
      }
    >
      <option value="">
        {selection.source.length === 0 ? 'Select a source to discover runs' : 'All runs'}
      </option>
      {view.snapshot.runs.value.runs.map((run: QueryRun) => (
        <option key={run.runId} value={run.runId}>
          {formatTimestamp(run.lastRecord.timestampNs, timeZone)} · {run.runId} · {run.recordCount}{' '}
          records
        </option>
      ))}
      {selection.run.length > 0 &&
        !view.snapshot.runs.value.runs.some((run: QueryRun) => run.runId === selection.run) && (
          <option value={selection.run}>{selection.run} · outside current discovery</option>
        )}
    </select>
  </label>
);

export const LogPanel = (props: LogPanelProps): JSX.Element => {
  const { view, selection, onChange, timeZone, following } = props;
  const { logs, runs } = view.snapshot;
  const capped = logs.value.records.length >= UI.maximumRecords;
  const hasMore = logs.value.nextCursor !== undefined;
  return (
    <section className="logs-panel" aria-label="Telemetry records" aria-busy={view.loading}>
      <div className="logs-heading">
        <div>
          <h2>{selection.source.length === 0 ? 'All telemetry' : selection.source}</h2>
          <p>{logs.value.records.length} records shown · newest first</p>
        </div>
        <RunSelector {...props} />
      </div>
      <div className="query-window">
        <span className={`window-state ${following ? 'following' : ''}`}>
          {following ? 'Following' : 'Snapshot'}
        </span>
        <span>
          {formatFullTimestamp(logs.value.window.startNs, timeZone)} —{' '}
          {formatFullTimestamp(logs.value.window.endNs, timeZone)}
        </span>
      </div>
      {logs.error.length > 0 && (
        <div className="inline-notice warning" role="status">
          <strong>
            {logs.updatedAt > 0 ? 'Showing previous results. ' : 'Logs unavailable. '}
          </strong>
          {logs.error}
        </div>
      )}
      {runs.error.length > 0 && (
        <p className="inline-notice warning">Run discovery: {runs.error}</p>
      )}
      {runs.value.truncated && (
        <p className="inline-notice warning">Run discovery limit reached.</p>
      )}
      {[...new Set([...logs.value.notes, ...runs.value.notes])].map((note: string) => (
        <p className="inline-notice warning" key={note}>
          {note}
        </p>
      ))}
      <div className="log-columns" aria-hidden="true">
        <span>Time</span>
        <span>{selection.source.length === 0 ? 'Message / source' : 'Message'}</span>
        <span />
      </div>
      <div className="log-records">
        {logs.value.records.map((record: QueryRecord) => (
          <LogRecord
            record={record}
            key={record.id}
            timeZone={timeZone}
            showSource={selection.source.length === 0}
            onMetadata={(metadata: SourceMetadata) =>
              onChange({ ...selection, metadata: { ...selection.metadata, ...metadata } })
            }
          />
        ))}
      </div>
      {logs.value.records.length === 0 && (
        <div className="empty-state">
          <span className="empty-glyph" aria-hidden="true">
            ≡
          </span>
          <h3>
            {view.loading
              ? 'Reading telemetry…'
              : logs.error.length > 0
                ? 'This query could not complete'
                : 'No matching records'}
          </h3>
        </div>
      )}
      <div className="pagination">
        {hasMore && !capped ? (
          <button
            type="button"
            className="button"
            disabled={view.loading || view.loadingOlder}
            onClick={view.loadOlder}
          >
            {view.loadingOlder ? 'Reading older records…' : 'Load older records'}
          </button>
        ) : (
          <span>
            {capped
              ? `Display limited to ${UI.maximumRecords} records.`
              : logs.value.records.length > 0
                ? 'End of this query window'
                : 'No records to paginate'}
          </span>
        )}
      </div>
    </section>
  );
};
