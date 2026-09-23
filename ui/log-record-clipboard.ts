import type { QueryRecord } from '@therealkenc/telemetry/query';
import { fail, ok, type Result } from '@therealkenc/app-runtime/core';

import { formatLogRecordText } from './log-record-text.js';
import { log } from './telemetry.js';

interface CopyFailure {
  readonly description: string;
}

type TextClipboard = Pick<Clipboard, 'writeText'>;

const writeRecord = async (
  record: QueryRecord,
  timeZone: string,
  clipboard: TextClipboard
): Promise<Result<void, CopyFailure>> => {
  await clipboard.writeText(formatLogRecordText(record, timeZone));
  return ok(undefined);
};

const copyFailed = (record: QueryRecord, description: string): Result<void, CopyFailure> => {
  log.warn('Could not copy Manager log record', {
    recordId: record.id,
    source: record.source,
    description,
  });
  return fail({ description });
};

export const copyLogRecord = async (
  record: QueryRecord,
  timeZone: string,
  clipboard: TextClipboard | undefined
): Promise<Result<void, CopyFailure>> => {
  if (clipboard === undefined) {
    return copyFailed(record, 'Clipboard access is unavailable in this browser.');
  }
  return writeRecord(record, timeZone, clipboard).catch((error: unknown) =>
    copyFailed(
      record,
      error instanceof Error ? error.message : 'The browser could not write to the clipboard.'
    )
  );
};
