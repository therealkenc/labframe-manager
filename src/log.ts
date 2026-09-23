import { createNodeLogger, defaultNodeOutput } from '@therealkenc/telemetry/node';

import { MANAGEMENT_LOG_TIME_ZONE, MANAGEMENT_LOG_WRAP_WIDTH } from './constants.js';
import type { FlushableManagementLogger } from './contracts.js';

export const createManagementLogger = (): FlushableManagementLogger => ({
  ...createNodeLogger({
    timezone: MANAGEMENT_LOG_TIME_ZONE,
    wrapWidth: MANAGEMENT_LOG_WRAP_WIDTH,
  }),
  flush: defaultNodeOutput.flush,
});
