import { resolve } from 'node:path';
import { windowsServiceDeploymentAssets, type ReleaseAssets } from '@therealkenc/release-tools';

const DEPLOYMENT_FILES = {
  manager: [
    'upgrade.ps1',
    'upgrade-functions.ps1',
    'install.ps1',
    'tooling.ps1',
    'policy.psd1',
    'README.md',
  ],
} as const;

type DeploymentGroup = readonly [string, readonly string[]];

export const managerDeploymentAssets = (repositoryDirectory: string): readonly ReleaseAssets[] => [
  ...windowsServiceDeploymentAssets(),
  ...Object.entries(DEPLOYMENT_FILES).flatMap(([directory, files]: DeploymentGroup) =>
    files.map((file: string): ReleaseAssets => ({
      source: resolve(repositoryDirectory, 'ops', directory, file),
      directory: `deploy/ops/${directory}/${file}`,
    }))
  ),
];
