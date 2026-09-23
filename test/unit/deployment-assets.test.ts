import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import type { ReleaseAssets } from '@therealkenc/release-tools';

import { managerDeploymentAssets } from '../../src/release/deployment-assets.js';

test('Manager artifact owns its upgrade and installer commands with working relative dependencies', async () => {
  const repository = resolve(import.meta.dirname, '../..');
  const parent = join(repository, 'build/deploy');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'manager-artifact-proof-'));
  try {
    const assets = managerDeploymentAssets(repository);
    await Promise.all(
      assets.map(async (asset: ReleaseAssets): Promise<void> => {
        const target = join(directory, asset.directory);
        await mkdir(dirname(target), { recursive: true });
        await cp(asset.source, target, { recursive: true });
      })
    );
    const command = join(directory, 'deploy/ops/manager/upgrade.ps1');
    const source = await readFile(command, 'utf8');
    assert.ok(source.includes("Join-Path $PSScriptRoot '../../..'"));
    assert.equal(resolve(dirname(command), '../../..'), directory);
    await access(resolve(dirname(command), '../windows-service/installation-functions.ps1'));
    await access(resolve(dirname(command), '../windows-service/install-service.ps1'));
    await access(resolve(dirname(command), '../windows-service/service.xml.template'));
    await access(resolve(dirname(command), 'upgrade-functions.ps1'));
    await access(resolve(dirname(command), 'configuration.ps1'));
    assert.ok(!assets.some((asset: ReleaseAssets) => asset.source.endsWith('test-upgrade.ps1')));
  } finally {
    assert.equal(dirname(directory), parent);
    assert.ok(directory.startsWith(join(parent, 'manager-artifact-proof-')));
    await rm(directory, { recursive: true });
  }
});
