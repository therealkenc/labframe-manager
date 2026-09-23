import type { JSX } from 'react';
import type { QueryRecord } from '@therealkenc/telemetry/query';

import { formatFullTimestamp, formatJson, formatTimestamp } from './format.js';
import { LogRecordCopy } from './log-record-copy.js';
import type { MetadataEntry, SourceMetadata } from './model.js';

interface LogRecordProps {
  readonly record: QueryRecord;
  readonly timeZone: string;
  readonly showSource: boolean;
  readonly onMetadata: (metadata: SourceMetadata) => void;
}

const ContextDetails = ({ record }: { readonly record: QueryRecord }): JSX.Element => (
  <div className="record-context">
    <h4>Context</h4>
    {record.context.state === 'present' ? (
      <pre>{formatJson(record.context.values)}</pre>
    ) : (
      <p className="muted">
        {record.context.state === 'invalid'
          ? `Invalid context: ${record.context.description}`
          : 'No context'}
      </p>
    )}
  </div>
);

export const LogRecord = ({
  record,
  timeZone,
  showSource,
  onMetadata,
}: LogRecordProps): JSX.Element => (
  <details className={`log-record level-${record.severity}`}>
    <summary className="log-summary">
      <time className="log-time" title={formatFullTimestamp(record.timestampNs, timeZone)}>
        {formatTimestamp(record.timestampNs, timeZone)}
      </time>
      <span className="log-content">
        <span className="log-message" title={record.severity}>
          {record.message}
        </span>
        {showSource && <span className="log-source">{record.source}</span>}
      </span>
      <span className="expand-mark" aria-hidden="true">
        +
      </span>
    </summary>
    <div className="record-details">
      <LogRecordCopy record={record} timeZone={timeZone} />
      <dl className="record-identity">
        <div>
          <dt>Observed</dt>
          <dd>{formatFullTimestamp(record.timestampNs, timeZone)}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd className="severity-text">{record.severity}</dd>
        </div>
        {showSource && (
          <div>
            <dt>Source</dt>
            <dd>{record.source}</dd>
          </div>
        )}
        <div>
          <dt>Emitter run</dt>
          <dd>{record.runId ?? 'Not supplied'}</dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>{record.sequence ?? 'Not supplied'}</dd>
        </div>
      </dl>
      {(record.messageTruncated || record.contextTruncated) && (
        <p className="inline-notice warning">
          The producer truncated this record
          {record.messageTruncated ? '’s message' : ''}
          {record.messageTruncated && record.contextTruncated ? ' and context' : ''}
          {!record.messageTruncated && record.contextTruncated ? '’s context' : ''}.
        </p>
      )}
      <h4>Message</h4>
      <pre className="full-message">{record.message}</pre>
      <h4>Sender metadata</h4>
      {Object.keys(record.metadata).length === 0 ? (
        <p className="muted">No metadata</p>
      ) : (
        <div className="metadata-chips">
          {Object.entries(record.metadata).map(([key, value]: MetadataEntry) => (
            <button
              type="button"
              className="metadata-chip"
              key={key}
              title={`Filter records where ${key} equals ${JSON.stringify(value)}`}
              onClick={() => onMetadata({ [key]: value })}
            >
              <span>{key}</span>
              <strong>{JSON.stringify(value)}</strong>
            </button>
          ))}
        </div>
      )}
      <ContextDetails record={record} />
    </div>
  </details>
);
