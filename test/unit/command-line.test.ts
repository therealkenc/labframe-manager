import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { parseManagementCommandLine } from '../../src/command-line.js';

const workingDirectory = resolve(import.meta.dirname, '../../tmp/manager-command');

test('installed CLI resolves explicit relative configuration against the caller directory', () => {
  const result = parseManagementCommandLine(['--config', './site/manager.json'], workingDirectory);
  assert.equal(result.ok, true);
  assert.equal(result.value, resolve(workingDirectory, 'site/manager.json'));
});

test('installed CLI preserves an absolute path including spaces', () => {
  const path = resolve(workingDirectory, 'Program Data/manager.json');
  const result = parseManagementCommandLine(['--config', path], resolve(workingDirectory, 'other'));
  assert.equal(result.ok, true);
  assert.equal(result.value, path);
});

test('installed CLI rejects implicit, positional, incomplete, and extra arguments', () => {
  [
    [],
    ['manager.json'],
    ['--config'],
    ['--config', ''],
    ['--config', '--other'],
    ['--config', 'manager.json', 'extra'],
    ['--other', 'manager.json'],
  ].forEach((arguments_: string[]) => {
    assert.equal(parseManagementCommandLine(arguments_, workingDirectory).ok, false);
  });
});
