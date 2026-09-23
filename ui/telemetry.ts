import { createBrowserLogger } from '@therealkenc/telemetry/browser';

import { UI } from './constants.js';

export const log = createBrowserLogger({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  wrapWidth: UI.loggerWrapWidth,
});
