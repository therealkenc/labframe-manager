import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OnlyOfficeObservation } from '../../src/contracts.js';
import { createHostStatusReader } from '../../src/status.js';

const ONLY_OFFICE: OnlyOfficeObservation = {
  endpoint: {
    description: 'Connection refused',
    kind: 'unhealthy',
    url: 'https://documents.example.test/healthcheck',
  },
  native: {
    kind: 'windows',
    condition: 'stopped',
    installedVersion: '9.4.0.129',
    listeners: [],
    notes: ['Document Server is intentionally stopped'],
    processes: [],
    services: [],
  },
};

test('management remains healthy when ONLYOFFICE is stopped', async () => {
  const reader = createHostStatusReader({
    now: () => new Date('2026-09-03T23:00:00.000Z'),
    onlyOffice: { read: () => Promise.resolve(ONLY_OFFICE) },
    processId: 42,
    version: '0.0.1',
  });

  const status = await reader.read();

  assert.equal(status.control.condition, 'healthy');
  assert.ok(status.onlyOffice.native.kind === 'windows');
  assert.equal(status.onlyOffice.native.condition, 'stopped');
  assert.equal(status.observedAt, '2026-09-03T23:00:00.000Z');
});
