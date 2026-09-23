import type { ProbeNoteCode } from './windows/onlyoffice-probe.js';

export const CORE_SERVICE_NAMES = ['DsConverterSvc', 'DsDocServiceSvc', 'DsProxySvc'] as const;

export type CoreServiceName = (typeof CORE_SERVICE_NAMES)[number];

export const PROBE_NOTE_DESCRIPTIONS: Readonly<Record<ProbeNoteCode, string>> = {
  'installation-root-missing': 'The configured ONLYOFFICE installation root was not found.',
  'installed-version-unavailable': 'The installed ONLYOFFICE version is unavailable.',
  'service-query-failed': 'Windows service status could not be queried.',
  'process-query-failed': 'ONLYOFFICE process status could not be queried.',
  'listener-query-failed': 'ONLYOFFICE listener status could not be queried.',
};

export const REQUIRED_SERVICE_DISPLAY_NAMES: Readonly<Record<CoreServiceName, string>> = {
  DsConverterSvc: 'ONLYOFFICE Document Server Converter',
  DsDocServiceSvc: 'ONLYOFFICE Document Server DocService',
  DsProxySvc: 'ONLYOFFICE Document Server Proxy',
};

export const HEALTHCHECK_TIMEOUT_MILLISECONDS = 5_000;
export const HEALTHCHECK_ADAPTER_TIMEOUT_MILLISECONDS = HEALTHCHECK_TIMEOUT_MILLISECONDS + 500;
export const HEALTHCHECK_MAXIMUM_BYTES = 64;
export const POWERSHELL_TIMEOUT_MILLISECONDS = 15_000;
export const POWERSHELL_ADAPTER_TIMEOUT_MILLISECONDS = POWERSHELL_TIMEOUT_MILLISECONDS + 1_000;
export const POWERSHELL_MAXIMUM_BUFFER_BYTES = 256 * 1_024;
export const OBSERVATION_CACHE_TTL_MILLISECONDS = 2_000;
export const HEALTHCHECK_PATH = 'healthcheck';
