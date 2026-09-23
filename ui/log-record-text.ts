import type { LogValue } from '@therealkenc/telemetry';
import type { QueryRecord } from '@therealkenc/telemetry/query';

import { formatFullTimestamp } from './format.js';
import type { MetadataEntry } from './model.js';

const CONTEXT_INDENT = '  ';

const isLogArray = (value: LogValue): value is readonly LogValue[] => Array.isArray(value);

const formatField = (label: string, value: LogValue, indent: string): string =>
  typeof value === 'object' && value !== null
    ? `${indent}${label}\n${formatValue(value, indent + CONTEXT_INDENT)}`
    : `${indent}${label} ${String(value).replaceAll('\n', `\n${indent}${CONTEXT_INDENT}`)}`;

const formatValue = (value: LogValue, indent: string): string => {
  if (isLogArray(value)) {
    return value.length === 0
      ? `${indent}(empty list)`
      : value.map((entry: LogValue) => formatField('-', entry, indent)).join('\n');
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? `${indent}(empty object)`
      : entries
          .map(([key, entry]: [string, LogValue]) => formatField(`${key}:`, entry, indent))
          .join('\n');
  }
  return `${indent}${String(value)}`;
};

const formatContext = (record: QueryRecord): string =>
  record.context.state === 'present'
    ? record.context.values.map((value: LogValue) => formatValue(value, '')).join('\n\n')
    : record.context.state === 'invalid'
      ? `Invalid context: ${record.context.description}`
      : 'No context';

const truncationNotice = (record: QueryRecord): string => {
  const parts = [
    record.messageTruncated ? 'message' : '',
    record.contextTruncated ? 'context' : '',
  ].filter((part: string) => part.length > 0);
  return parts.length === 0
    ? ''
    : `\n\nNote: The producer truncated this record's ${parts.join(' and ')}.`;
};

export const formatLogRecordText = (record: QueryRecord, timeZone: string): string => {
  const metadata = Object.entries(record.metadata)
    .map(([key, value]: MetadataEntry) => `${key}: ${String(value)}`)
    .join('\n');
  return (
    [
      `Observed: ${formatFullTimestamp(record.timestampNs, timeZone)} (${timeZone})`,
      `Level: ${record.severity}`,
      `Source: ${record.source}`,
      `Emitter run: ${record.runId ?? 'Not supplied'}`,
      `Sequence: ${record.sequence ?? 'Not supplied'}`,
      `Record: ${record.id}`,
      '',
      'Message',
      record.message,
      '',
      'Sender metadata',
      metadata.length === 0 ? 'No metadata' : metadata,
      '',
      'Context',
      formatContext(record),
    ].join('\n') + truncationNotice(record)
  );
};
