import { resolve } from 'node:path';
import { fail, ok, type Result } from '@therealkenc/app-runtime/core';

import { MANAGEMENT_CONFIG_ARGUMENT_COUNT, MANAGEMENT_CONFIG_OPTION } from './constants.js';

export const parseManagementCommandLine = (
  arguments_: readonly string[],
  workingDirectory: string
): Result<string> => {
  const option = arguments_.at(0);
  const path = arguments_.at(1);
  return arguments_.length !== MANAGEMENT_CONFIG_ARGUMENT_COUNT ||
    option !== MANAGEMENT_CONFIG_OPTION ||
    path === undefined ||
    path.trim().length === 0 ||
    path.startsWith('--')
    ? fail('Usage: node main.js --config <management config path>')
    : ok(resolve(workingDirectory, path));
};
