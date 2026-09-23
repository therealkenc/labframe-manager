import { resolve } from 'node:path';
import {
  createNodeRelease,
  parseReleaseArguments,
  readPackageMetadata,
  RELEASE_WINDOWS_NODE_TARGET,
  RELEASE_WORKSPACE_OUTPUTS,
  type ReleaseArguments,
} from '@therealkenc/release-tools';

import {
  CONFIG_PATH_ARGUMENT_INDEX,
  MANAGEMENT_EXIT_FAILURE,
  MANAGEMENT_SERVICE_NAME,
} from '../constants.js';
import { MANAGEMENT_RESOURCES, MANAGEMENT_WEB_RESOURCE } from '../resources.js';
import { managerDeploymentAssets } from './deployment-assets.js';

const packageDirectory = resolve(import.meta.dirname, '../..');
const repositoryDirectory = packageDirectory;

const releaseManager = async (arguments_: ReleaseArguments): Promise<void> => {
  const metadata = await readPackageMetadata(packageDirectory);
  const manifest = await createNodeRelease({
    arguments: arguments_,
    assets: managerDeploymentAssets(repositoryDirectory),
    name: MANAGEMENT_SERVICE_NAME,
    entryRelativePath: 'dist/main.js',
    externalModules: [],
    resources: [MANAGEMENT_WEB_RESOURCE, MANAGEMENT_RESOURCES],
    repositoryDirectory,
    sourceDirectory: packageDirectory,
    target: RELEASE_WINDOWS_NODE_TARGET,
    workspaceOutputs: new Map<string, readonly string[]>([
      [packageDirectory, ['package.json', ...(metadata.files ?? [])]],
      [resolve(packageDirectory, '../app-runtime'), RELEASE_WORKSPACE_OUTPUTS],
    ]),
  });
  process.stdout.write(
    `Created ${arguments_.output} (${manifest.files.length} files, ${manifest.build.gitRevision})\n`
  );
};

if (import.meta.main) {
  const selected = parseReleaseArguments(
    process.argv.slice(CONFIG_PATH_ARGUMENT_INDEX),
    process.cwd()
  );
  const run = async (): Promise<void> => {
    if (!selected.ok) {
      throw new Error(selected.error);
    }
    await releaseManager(selected.value);
  };
  void run().catch((error: unknown): void => {
    console.error('Manager release failed:', error);
    process.exitCode = MANAGEMENT_EXIT_FAILURE;
  });
}
