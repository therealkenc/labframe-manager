import {
  createProcessTerminator, type ProcessTerminationFailure,
} from '@therealkenc/app-runtime/process-lifecycle';
import { parseManagementCommandLine } from './command-line.js';
import { loadHostManagementConfig } from './config.js';
import {
  MANAGEMENT_CONFIG_OPTION,
  MANAGEMENT_EXIT_FAILURE,
  MANAGEMENT_LOG_FLUSH_STEP,
  MANAGEMENT_LOG_FLUSH_TIMEOUT_MILLISECONDS,
} from './constants.js';
import { createManagementLogger } from './log.js';

export const validateManagementConfiguration = async (
  arguments_: readonly string[],
  workingDirectory: string
): Promise<void> => {
  const path = parseManagementCommandLine(
    [MANAGEMENT_CONFIG_OPTION, ...arguments_.slice(1)], workingDirectory
  );
  const result = path.ok ? await loadHostManagementConfig(path.value) : path;
  if (result.ok) {
    process.stdout.write('Manager configuration is valid.\n');
    return;
  }
  const log = createManagementLogger();
  log.error('Manager configuration validation failed', { description: result.error });
  await createProcessTerminator({
    exit: (code: number): never => process.exit(code),
    observeFailure: (failure: ProcessTerminationFailure): void => {
      log.error('Manager validation log flush failed', failure);
    },
    steps: [{
      name: MANAGEMENT_LOG_FLUSH_STEP,
      run: log.flush,
      timeoutMilliseconds: MANAGEMENT_LOG_FLUSH_TIMEOUT_MILLISECONDS,
    }],
  }).terminate({ announce: (): void => {}, exitCode: MANAGEMENT_EXIT_FAILURE });
};
