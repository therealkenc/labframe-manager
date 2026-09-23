import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

import { appendUrlPath, fail, ok, type Result } from '@therealkenc/app-runtime/core';
import { describeLogFailure } from '@therealkenc/telemetry';

import { createTtlSingleFlight, settleWithin } from './async-control.js';
import { MANAGEMENT_ONLYOFFICE_STATUS_SCRIPT } from './resources.js';
import type {
  EndpointHealth,
  ManagementLogger,
  ManagedServiceObservation,
  OnlyOfficeObservation,
  NativeOnlyOfficeObservation,
  WindowsOnlyOfficeObservation,
  OnlyOfficeStatusReader as OnlyOfficeStatusReaderContract,
} from './contracts.js';
import {
  CORE_SERVICE_NAMES,
  HEALTHCHECK_PATH,
  HEALTHCHECK_TIMEOUT_MILLISECONDS,
  HEALTHCHECK_ADAPTER_TIMEOUT_MILLISECONDS,
  HEALTHCHECK_MAXIMUM_BYTES,
  POWERSHELL_TIMEOUT_MILLISECONDS,
  POWERSHELL_ADAPTER_TIMEOUT_MILLISECONDS,
  POWERSHELL_MAXIMUM_BUFFER_BYTES,
  OBSERVATION_CACHE_TTL_MILLISECONDS,
  PROBE_NOTE_DESCRIPTIONS,
  REQUIRED_SERVICE_DISPLAY_NAMES,
  type CoreServiceName,
} from './onlyoffice-constants.js';
import type { NativeOnlyOfficeProbe } from './onlyoffice-probe-config.js';
import {
  parseOnlyOfficeProbe,
  type OnlyOfficeProbe,
  type ProbeNoteCode,
} from './windows/onlyoffice-probe.js';

export type OnlyOfficeStatusReader = OnlyOfficeStatusReaderContract;

export interface OnlyOfficeStatusOptions {
  readonly documentServerUrl: Result<string>;
  readonly nativeProbe: NativeOnlyOfficeProbe;
  readonly logger: ManagementLogger;
}

type HealthFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface OnlyOfficeStatusDependencies {
  readonly fetch: HealthFetch;
  readonly now: () => number;
  readonly performanceNow: () => number;
  readonly runStatusScript: (installationRoot: string) => Promise<Result<string>>;
}

type ProbeFailure = 'execution-failed' | 'invalid-output';

const readProbe = async (
  installationRoot: string,
  dependencies: OnlyOfficeStatusDependencies
): Promise<Result<OnlyOfficeProbe, ProbeFailure>> => {
  const execute = (): Promise<Result<string, ProbeFailure>> =>
    dependencies
      .runStatusScript(installationRoot)
      .then((result: Result<string>): Result<string, ProbeFailure> =>
        result.ok ? ok(result.value) : fail('execution-failed')
      );
  const executed = await settleWithin(
    execute,
    POWERSHELL_ADAPTER_TIMEOUT_MILLISECONDS,
    fail('execution-failed')
  );
  return executed.ok ? parseOnlyOfficeProbe(executed.value) : fail('execution-failed');
};

const readHealthBody = async (response: Response): Promise<string> => {
  if (response.body === null) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return text + decoder.decode();
    }
    byteCount += chunk.value.byteLength;
    if (byteCount > HEALTHCHECK_MAXIMUM_BYTES) {
      await reader.cancel();
      return '';
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
};

const unhealthy = (url: string, description: string): EndpointHealth => ({
  description,
  url,
  kind: 'unhealthy',
});

const readEndpoint = async (
  healthUrl: string,
  dependencies: OnlyOfficeStatusDependencies
): Promise<EndpointHealth> => {
  const startedAt = dependencies.performanceNow();
  const response = await dependencies.fetch(healthUrl, {
    cache: 'no-store',
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    return unhealthy(healthUrl, `ONLYOFFICE healthcheck returned HTTP ${response.status}.`);
  }

  const body = await readHealthBody(response);
  return body.trim() === 'true'
    ? {
        kind: 'healthy',
        url: healthUrl,
        latencyMilliseconds: Math.max(0, Math.round(dependencies.performanceNow() - startedAt)),
      }
    : unhealthy(healthUrl, 'ONLYOFFICE healthcheck did not report ready.');
};

const readEndpointSafely = (
  healthUrl: string,
  dependencies: OnlyOfficeStatusDependencies,
  logger: ManagementLogger
): Promise<EndpointHealth> =>
  settleWithin(
    (): Promise<EndpointHealth> =>
      readEndpoint(healthUrl, dependencies).catch((error: unknown): EndpointHealth => {
        logger.warn('ONLYOFFICE endpoint request failed', {
          url: healthUrl,
          description: describeLogFailure(error),
        });
        return unhealthy(healthUrl, 'ONLYOFFICE healthcheck request failed.');
      }),
    HEALTHCHECK_ADAPTER_TIMEOUT_MILLISECONDS,
    unhealthy(healthUrl, 'ONLYOFFICE healthcheck request timed out.')
  );

const serviceByName = (
  services: readonly ManagedServiceObservation[],
  name: CoreServiceName
): ManagedServiceObservation | undefined =>
  services.find((service: ManagedServiceObservation): boolean => service.name === name);

const requiredServiceNotes = (
  name: CoreServiceName,
  service: ManagedServiceObservation
): readonly string[] => {
  const displayName = REQUIRED_SERVICE_DISPLAY_NAMES[name];
  return [
    ...(service.state === 'Running' ? [] : [`${displayName} is ${service.state.toLowerCase()}.`]),
    ...(service.startMode === 'Auto'
      ? []
      : [`${displayName} startup mode is ${service.startMode}; expected Auto.`]),
  ];
};

const serviceNotes = (services: readonly ManagedServiceObservation[]): readonly string[] =>
  CORE_SERVICE_NAMES.flatMap((name: CoreServiceName): readonly string[] => {
    const service = serviceByName(services, name);
    return service === undefined
      ? [`${REQUIRED_SERVICE_DISPLAY_NAMES[name]} is not installed or could not be queried.`]
      : requiredServiceNotes(name, service);
  });

const conditionFrom = (
  probe: OnlyOfficeProbe,
  notes: readonly string[]
): WindowsOnlyOfficeObservation['condition'] => {
  const coreServices = CORE_SERVICE_NAMES.flatMap(
    (name: CoreServiceName): readonly ManagedServiceObservation[] => {
      const service = serviceByName(probe.services, name);
      return service === undefined ? [] : [service];
    }
  );
  if (probe.notes.includes('service-query-failed') || coreServices.length === 0) {
    return 'unavailable';
  }

  const hasEveryCoreService = coreServices.length === CORE_SERVICE_NAMES.length;
  const allStopped = coreServices.every(
    (service: ManagedServiceObservation): boolean => service.state === 'Stopped'
  );
  if (hasEveryCoreService && allStopped) {
    return 'stopped';
  }

  const allCoreRunning = coreServices.every(
    (service: ManagedServiceObservation): boolean => service.state === 'Running'
  );
  return hasEveryCoreService && allCoreRunning && notes.length === 0 ? 'healthy' : 'degraded';
};

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

const observationFromProbe = (probe: OnlyOfficeProbe): WindowsOnlyOfficeObservation => {
  const versionNotes =
    probe.installedVersion === 'unknown' && !probe.notes.includes('installed-version-unavailable')
      ? [PROBE_NOTE_DESCRIPTIONS['installed-version-unavailable']]
      : [];
  const notes = unique([
    ...probe.notes.map((code: ProbeNoteCode): string => PROBE_NOTE_DESCRIPTIONS[code]),
    ...serviceNotes(probe.services),
    ...versionNotes,
  ]);

  return {
    kind: 'windows',
    condition: conditionFrom(probe, notes),
    installedVersion: probe.installedVersion,
    listeners: probe.listeners,
    notes,
    processes: probe.processes,
    services: probe.services,
  };
};

const unavailableObservation = (): WindowsOnlyOfficeObservation => ({
  kind: 'windows',
  condition: 'unavailable',
  installedVersion: 'unknown',
  listeners: [],
  notes: ['The Windows ONLYOFFICE status probe is unavailable.'],
  processes: [],
  services: [],
});

const logIncompleteProbe = (
  logger: ManagementLogger,
  result: Result<OnlyOfficeProbe, ProbeFailure>
): void => {
  if (!result.ok) {
    logger.warn('Windows ONLYOFFICE status probe failed', { failure: result.error });
    return;
  }
  if (result.value.notes.length > 0) {
    logger.warn('Windows ONLYOFFICE status probe returned partial results', {
      noteCodes: result.value.notes,
    });
  }
};

const logUnhealthyEndpoint = (logger: ManagementLogger, endpoint: EndpointHealth): void => {
  if (endpoint.kind !== 'healthy') {
    logger.warn('ONLYOFFICE endpoint observation failed', { ...endpoint });
  }
};

const readNativeObservation = async (
  options: OnlyOfficeStatusOptions,
  dependencies: OnlyOfficeStatusDependencies
): Promise<NativeOnlyOfficeObservation> => {
  if (options.nativeProbe.kind === 'disabled') {
    return { kind: 'disabled' };
  }
  const probe = await readProbe(options.nativeProbe.installationRoot, dependencies);
  logIncompleteProbe(options.logger, probe);
  return probe.ok ? observationFromProbe(probe.value) : unavailableObservation();
};

const readConfiguredEndpoint = async (
  configured: Result<string>,
  dependencies: OnlyOfficeStatusDependencies,
  logger: ManagementLogger
): Promise<EndpointHealth> =>
  configured.ok
    ? readEndpointSafely(appendUrlPath(configured.value, HEALTHCHECK_PATH), dependencies, logger)
    : { kind: 'unavailable', description: configured.error };

const readFreshObservation = async (
  options: OnlyOfficeStatusOptions,
  dependencies: OnlyOfficeStatusDependencies
): Promise<OnlyOfficeObservation> => {
  const [native, endpoint] = await Promise.all([
    readNativeObservation(options, dependencies),
    readConfiguredEndpoint(options.documentServerUrl, dependencies, options.logger),
  ]);
  logUnhealthyEndpoint(options.logger, endpoint);
  return { native, endpoint };
};

const createReader = (
  options: OnlyOfficeStatusOptions,
  dependencies: OnlyOfficeStatusDependencies
): OnlyOfficeStatusReader => {
  const read = createTtlSingleFlight({
    load: (): Promise<OnlyOfficeObservation> => readFreshObservation(options, dependencies),
    now: dependencies.now,
    ttlMilliseconds: OBSERVATION_CACHE_TTL_MILLISECONDS,
  });
  return { read };
};

const powerShellEnvironment = (systemRoot: string): NodeJS.ProcessEnv => ({
  ProgramData: process.env.ProgramData,
  ProgramFiles: process.env.ProgramFiles,
  'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
  ProgramW6432: process.env.ProgramW6432,
  PSModulePath: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  SystemRoot: systemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  WINDIR: systemRoot,
});

const runStatusScript = (
  installationRoot: string,
  logger: ManagementLogger
): Promise<Result<string>> => {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined) {
    return Promise.resolve(fail('Windows system root is unavailable'));
  }

  const executable = win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const arguments_ = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    MANAGEMENT_ONLYOFFICE_STATUS_SCRIPT,
    '-InstallationRoot',
    installationRoot,
  ];

  return new Promise((settle: (result: Result<string>) => void): void => {
    execFile(
      executable,
      arguments_,
      {
        encoding: 'utf8',
        env: powerShellEnvironment(systemRoot),
        maxBuffer: POWERSHELL_MAXIMUM_BUFFER_BYTES,
        shell: false,
        timeout: POWERSHELL_TIMEOUT_MILLISECONDS,
        windowsHide: true,
      },
      (error: Error | null, stdout: string): void => {
        if (error !== null) {
          logger.warn('Windows ONLYOFFICE status command failed', {
            description: describeLogFailure(error),
          });
        }
        settle(error === null ? ok(stdout) : fail('Windows ONLYOFFICE status probe failed'));
      }
    );
  });
};

const systemDependencies = (logger: ManagementLogger): OnlyOfficeStatusDependencies => ({
  fetch: (input: string, init: RequestInit): Promise<Response> => globalThis.fetch(input, init),
  now: (): number => performance.now(),
  performanceNow: (): number => performance.now(),
  runStatusScript: (installationRoot: string): Promise<Result<string>> =>
    runStatusScript(installationRoot, logger),
});

export const createOnlyOfficeStatusReaderWithDependencies = (
  options: OnlyOfficeStatusOptions,
  dependencies: OnlyOfficeStatusDependencies
): OnlyOfficeStatusReader => createReader(options, dependencies);

export const createOnlyOfficeStatusReader = (
  options: OnlyOfficeStatusOptions
): OnlyOfficeStatusReader => createReader(options, systemDependencies(options.logger));
