import type { JSX } from 'react';
import type { QuerySource, SourcePage } from '@therealkenc/telemetry/query';

import { formatTimestamp } from './format.js';
import type { Observed } from './model.js';

interface SourceListProps {
  readonly sources: Observed<SourcePage>;
  readonly selected: string;
  readonly onSelect: (name: string) => void;
  readonly timeZone: string;
  readonly loading: boolean;
}

export const SourceList = ({
  sources,
  selected,
  onSelect,
  timeZone,
  loading,
}: SourceListProps): JSX.Element => (
  <aside className="sources-panel" aria-label="Telemetry sources">
    <div className="section-heading">
      <h2>Sources</h2>
      <span className="count">{sources.value.sources.length}</span>
    </div>
    <button
      type="button"
      className={`source-button ${selected.length === 0 ? 'selected' : ''}`}
      onClick={() => onSelect('')}
      aria-pressed={selected.length === 0}
    >
      <span className="source-title">All sources</span>
    </button>
    {sources.value.sources.map((source: QuerySource) => (
      <button
        type="button"
        key={source.name}
        className={`source-button ${selected === source.name ? 'selected' : ''}`}
        onClick={() => onSelect(source.name)}
        aria-pressed={selected === source.name}
      >
        <span className="source-title">{source.name}</span>
        <span className="source-observation">
          <span className={`severity-text ${source.lastRecord.severity}`}>
            {source.lastRecord.severity}
          </span>
          <time>{formatTimestamp(source.lastRecord.timestampNs, timeZone)}</time>
        </span>
        <span className="source-preview" title={source.lastRecord.message}>
          {source.lastRecord.message}
        </span>
      </button>
    ))}
    {sources.error.length > 0 && (
      <p className="inline-notice warning">
        {sources.error}
        {sources.updatedAt > 0 ? ' Previously observed sources remain visible.' : ''}
      </p>
    )}
    {sources.value.sources.length === 0 && sources.error.length === 0 && !loading && (
      <p className="empty-sources">No sources</p>
    )}
    {sources.value.truncated && (
      <p className="inline-notice warning">Source discovery limit reached.</p>
    )}
    {sources.value.notes.map((note: string) => (
      <p className="inline-notice warning" key={note}>
        {note}
      </p>
    ))}
  </aside>
);
