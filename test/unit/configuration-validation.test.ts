import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const ENTRY = resolve(ROOT, 'dist/main.js');
const TIMEOUT_MILLISECONDS = 5_000;

test('configuration validation succeeds without opening secrets or a listener', () => {
  const result = spawnSync(process.execPath, [
    ENTRY, '--validate-config', resolve(ROOT, 'config/example.json'),
  ], { encoding: 'utf8', timeout: TIMEOUT_MILLISECONDS });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Manager configuration is valid/);
});

test('configuration validation reports a missing file and exits nonzero', () => {
  const result = spawnSync(process.execPath, [
    ENTRY, '--validate-config', resolve(ROOT, 'tmp/absent-manager-config.json'),
  ], { encoding: 'utf8', timeout: TIMEOUT_MILLISECONDS });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Unable to read management configuration/);
});
