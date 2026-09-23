import { hostname } from 'node:os';
import { setupNodeOtel } from '@therealkenc/telemetry/otel-node';
import { ok } from '@therealkenc/app-runtime/core';

import type { HostManagementConfig } from './config.js';
import type { HostStatusReader, ManagementLogger } from './contracts.js';
import { MANAGEMENT_COMPONENT, MANAGEMENT_SERVICE_NAME } from './constants.js';
import { MANAGEMENT_BUILD_VERSION } from './build-identity.js';
import { createOnlyOfficeStatusReader } from './onlyoffice-status.js';
import { createHostStatusReader } from './status.js';

const initializeTelemetry = (config: HostManagementConfig): void => {
  setupNodeOtel({
    endpoint: config.telemetry.collectorOrigin,
    serviceName: MANAGEMENT_SERVICE_NAME,
    metadata: { component: MANAGEMENT_COMPONENT, host: hostname(), pid: process.pid },
  });
};

export const createConfiguredStatusReader = (
  config: HostManagementConfig,
  log: ManagementLogger
): HostStatusReader => {
  initializeTelemetry(config);
  const onlyOffice = createOnlyOfficeStatusReader({
    documentServerUrl: ok(config.onlyOffice.documentServerUrl),
    nativeProbe: config.onlyOfficeNativeProbe,
    logger: log,
  });
  return createHostStatusReader({
    now: () => new Date(),
    onlyOffice,
    processId: process.pid,
    version: MANAGEMENT_BUILD_VERSION,
  });
};
