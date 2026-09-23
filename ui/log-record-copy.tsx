import { useState, type JSX } from 'react';
import type { QueryRecord } from '@therealkenc/telemetry/query';

import { copyLogRecord } from './log-record-clipboard.js';

type CopyState =
  | { readonly kind: 'ready' | 'copying' | 'copied' }
  | { readonly kind: 'failed'; readonly description: string };

export const LogRecordCopy = ({
  record,
  timeZone,
}: {
  readonly record: QueryRecord;
  readonly timeZone: string;
}): JSX.Element => {
  const [state, setState] = useState<CopyState>({ kind: 'ready' });
  const copy = async (): Promise<void> => {
    setState({ kind: 'copying' });
    const result = await copyLogRecord(record, timeZone, navigator.clipboard);
    setState(result.ok ? { kind: 'copied' } : { kind: 'failed', ...result.error });
  };
  return (
    <div className="record-actions">
      <span role="status" className={state.kind === 'failed' ? 'copy-error' : 'muted'}>
        {state.kind === 'failed'
          ? `Could not copy: ${state.description} Select the text below to copy it manually.`
          : state.kind === 'copied'
            ? 'Copied'
            : ''}
      </span>
      <button
        type="button"
        className="record-copy"
        aria-label="Copy log record as text"
        disabled={state.kind === 'copying'}
        onClick={() => void copy()}
      >
        {state.kind === 'copying' ? 'Copying…' : 'Copy'}
      </button>
    </div>
  );
};
