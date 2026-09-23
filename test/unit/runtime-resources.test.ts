import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  MANAGEMENT_ONLYOFFICE_STATUS_SCRIPT,
  MANAGEMENT_WEB_DIRECTORY,
} from '../../src/resources.js';

test('manager resources retain real paths for static serving and the native probe', async () => {
  const [html, script] = await Promise.all([
    readFile(join(MANAGEMENT_WEB_DIRECTORY, 'index.html'), 'utf8'),
    readFile(MANAGEMENT_ONLYOFFICE_STATUS_SCRIPT, 'utf8'),
  ]);
  assert.match(html, /assets\/app\.js/u);
  assert.match(script, /\[string\]\$InstallationRoot/u);
});
