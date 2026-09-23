import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { addRelay, removeRelay, type LogEvent } from '@therealkenc/telemetry';
import type { QueryRecord } from '@therealkenc/telemetry/query';

import { copyLogRecord } from '../../ui/log-record-clipboard.js';
import { formatLogRecordText } from '../../ui/log-record-text.js';

const RECORD: QueryRecord = {
  id: 'record-123',
  timestampNs: '1700000000123456789',
  source: 'labframe-browser',
  metadata: { instance: 'delta-prod', pid: 123, headless: false },
  runId: 'browser-run',
  sequence: '42',
  severity: 'error',
  message: 'ONLYOFFICE browser event onError\nThe document security token has expired.',
  context: {
    state: 'present',
    values: [
      {
        errorCode: -21,
        document: { name: 'EPS report', attempts: [1, 2] },
        cause: { stack: 'Error: expired\n  at openEditor' },
      },
    ],
  },
  messageTruncated: false,
  contextTruncated: false,
};

test('copy text includes readable message, context, source and correlation identity', () => {
  const text = formatLogRecordText(RECORD, 'UTC');
  assert.match(text, /Observed: .*2023.*UTC/);
  assert.ok(text.includes('Level: error\nSource: labframe-browser'));
  assert.ok(text.includes('Emitter run: browser-run\nSequence: 42\nRecord: record-123'));
  assert.ok(text.includes(RECORD.message));
  assert.ok(text.includes('instance: delta-prod\npid: 123\nheadless: false'));
  assert.ok(text.includes('errorCode: -21\ndocument:\n  name: EPS report'));
  assert.ok(text.includes('attempts:\n    - 1\n    - 2'));
  assert.ok(text.includes('stack: Error: expired\n      at openEditor'));
  assert.ok(!text.includes('"errorCode"'));
});

test('copy text preserves the entire supplied message and identifies producer truncation', () => {
  const message = 'Full retained message.\n'.repeat(2_000);
  const text = formatLogRecordText(
    {
      ...RECORD,
      message,
      messageTruncated: true,
      contextTruncated: true,
    },
    'UTC'
  );
  assert.ok(text.includes(message));
  assert.ok(text.endsWith("Note: The producer truncated this record's message and context."));
});

test('copy text preserves missing identity and invalid or absent context explicitly', () => {
  const missing = {
    ...RECORD,
    runId: undefined,
    sequence: undefined,
    metadata: {},
  };
  const invalid = formatLogRecordText(
    {
      ...missing,
      context: { state: 'invalid', description: 'Malformed producer value' },
    },
    'UTC'
  );
  assert.ok(invalid.includes('Emitter run: Not supplied\nSequence: Not supplied'));
  assert.ok(invalid.includes('Sender metadata\nNo metadata'));
  assert.ok(invalid.includes('Context\nInvalid context: Malformed producer value'));
  const absent = formatLogRecordText({ ...missing, context: { state: 'missing' } }, 'UTC');
  assert.ok(absent.endsWith('Context\nNo context'));
});

test('copy text retains false, zero, null, arrays and empty objects in context', () => {
  const text = formatLogRecordText(
    {
      ...RECORD,
      context: { state: 'present', values: [false, 0, null, { empty: [], object: {} }] },
    },
    'UTC'
  );
  assert.ok(text.includes('Context\nfalse\n\n0\n\nnull'));
  assert.ok(text.includes('empty:\n  (empty list)\nobject:\n  (empty object)'));
});

test('copy writes plain text to the clipboard and reports success', async () => {
  const written: string[] = [];
  const outcome = await copyLogRecord(RECORD, 'UTC', {
    writeText: (text: string): Promise<void> => {
      written.push(text);
      return Promise.resolve();
    },
  });
  assert.ok(outcome.ok);
  assert.deepEqual(written, [formatLogRecordText(RECORD, 'UTC')]);
});

test('denied clipboard access returns a visible cause and emits boundary telemetry', async (t: TestContext) => {
  const events: LogEvent[] = [];
  const capture = (event: LogEvent): void => {
    events.push(event);
  };
  addRelay(capture);
  t.after(() => removeRelay(capture));
  const outcome = await copyLogRecord(RECORD, 'UTC', {
    writeText: (): Promise<void> => Promise.reject(new Error('Clipboard permission denied')),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.description, 'Clipboard permission denied');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, 'warn');
  assert.ok(events[0]?.text.includes('Could not copy Manager log record'));
  assert.ok(events[0]?.text.includes(RECORD.id));
});

test('unavailable or synchronously failing clipboard does not leave an unhandled rejection', async () => {
  const unavailable = await copyLogRecord(RECORD, 'UTC', undefined);
  assert.equal(unavailable.ok, false);
  const failed = await copyLogRecord(RECORD, 'UTC', {
    writeText: (): Promise<void> => {
      throw new Error('Clipboard unavailable');
    },
  });
  assert.equal(failed.ok, false);
});
