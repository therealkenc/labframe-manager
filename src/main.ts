import { isBuildInfoRequest, printBuildIdentity } from '@therealkenc/app-runtime/build-identity';

import { MANAGEMENT_BUILD_IDENTITY } from './build-identity.js';
import { parseManagementCommandLine } from './command-line.js';
import { loadHostManagementConfig } from './config.js';
import { CONFIG_PATH_ARGUMENT_INDEX, MANAGEMENT_VALIDATE_CONFIG_OPTION } from './constants.js';

const arguments_ = process.argv.slice(CONFIG_PATH_ARGUMENT_INDEX);

if (isBuildInfoRequest(arguments_)) {
  printBuildIdentity(MANAGEMENT_BUILD_IDENTITY);
} else if (arguments_.at(0) === MANAGEMENT_VALIDATE_CONFIG_OPTION) {
  const { validateManagementConfiguration } = await import('./configuration-validation.js');
  await validateManagementConfiguration(arguments_, process.cwd());
} else {
  const { runHostManagement } = await import('./server.js');
  runHostManagement(() => {
    const path = parseManagementCommandLine(arguments_, process.cwd());
    return path.ok ? loadHostManagementConfig(path.value) : Promise.resolve(path);
  });
}
