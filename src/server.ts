import { getRequestListener } from '@hono/node-server';
import { createServer, type Server } from 'node:http';
import { fail, httpListenerAddress, ok, type Result } from '@therealkenc/app-runtime/core';
import {
  createProcessTerminator,
  type ProcessTerminator,
  type ProcessTerminationFailure,
} from '@therealkenc/app-runtime/process-lifecycle';
import { describeLogFailure } from '@therealkenc/telemetry';
import { shutdownNodeOtel } from '@therealkenc/telemetry/otel-node';

import { type HostManagementConfig, type ManagementConfigLoader } from './config.js';
import {
  MANAGEMENT_EXIT_FAILURE,
  MANAGEMENT_EXIT_SUCCESS,
  MANAGEMENT_HTTP_SHUTDOWN_STEP,
  MANAGEMENT_LOG_FLUSH_STEP,
  MANAGEMENT_LOG_FLUSH_TIMEOUT_MILLISECONDS,
  MANAGEMENT_SHUTDOWN_SIGNALS,
  SERVER_SHUTDOWN_TIMEOUT_MILLISECONDS,
} from './constants.js';
import type { FlushableManagementLogger, ManagementLogger } from './contracts.js';
import { createHostManagementApp, hardenedInternalServerErrorResponse } from './http-app.js';
import { createManagementLogger } from './log.js';
import { createConfiguredStatusReader } from './configured-status.js';
import { loadManagementTelemetry } from './telemetry.js';
import { MANAGEMENT_BUILD_VERSION } from './build-identity.js';
import { MANAGEMENT_WEB_DIRECTORY } from './resources.js';
import { loadManagementPasswordGate } from './authentication.js';

export type HostManagementFatalEvent =
  | {
      readonly description: string;
      readonly kind: 'uncaught-exception';
      readonly origin: NodeJS.UncaughtExceptionOrigin;
    }
  | {
      readonly description: string;
      readonly kind:
        'http-listener-error' | 'startup-failure' | 'startup-rejection' | 'unhandled-rejection';
    };

export interface HostManagementProcessLifecycle {
  readonly fatal: (event: HostManagementFatalEvent) => Promise<void>;
  readonly signal: (signal: NodeJS.Signals) => Promise<void>;
}

export interface HostManagementProcessLifecycleOptions {
  readonly closeServer: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly flushLogs: () => Promise<void>;
  readonly forceCloseServer: () => void;
  readonly log: ManagementLogger;
  readonly logFlushTimeoutMilliseconds: number;
  readonly serverShutdownTimeoutMilliseconds: number;
}

const listen = (server: Server, url: string): Promise<Result<void>> =>
  new Promise((resolve: (result: Result<void>) => void): void => {
    const failed = (error: Error): void => {
      server.off('listening', listening);
      resolve(fail(`Host management HTTP listener failed: ${describeLogFailure(error)}`));
    };
    const listening = (): void => {
      server.off('error', failed);
      resolve(ok(undefined));
    };
    server.once('error', failed);
    server.once('listening', listening);
    const address = httpListenerAddress(url);
    server.listen(address.port, address.host);
  });

const closeServer = (server: Server): Promise<void> =>
  server.listening
    ? new Promise((resolve: () => void, reject: (error: Error) => void): void => {
        server.close((error?: Error): void => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      })
    : Promise.resolve();

const fatalDetails = (event: HostManagementFatalEvent): object => ({
  description: event.description,
  failure: event.kind,
  ...(event.kind === 'uncaught-exception' ? { origin: event.origin } : {}),
});

const observeTerminationFailure = (
  options: HostManagementProcessLifecycleOptions,
  failure: ProcessTerminationFailure
): void => {
  if (failure.step === MANAGEMENT_HTTP_SHUTDOWN_STEP) {
    options.forceCloseServer();
  }
  options.log.warn(`Unable to complete ${failure.step}`, {
    description: failure.description,
    failure: failure.kind,
    step: failure.step,
  });
};

const createTerminator = (
  options: HostManagementProcessLifecycleOptions,
  exit: (code: number) => void
): ProcessTerminator =>
  createProcessTerminator({
    exit,
    observeFailure: (failure: ProcessTerminationFailure): void => {
      observeTerminationFailure(options, failure);
    },
    steps: [
      {
        name: MANAGEMENT_HTTP_SHUTDOWN_STEP,
        run: options.closeServer,
        timeoutMilliseconds: options.serverShutdownTimeoutMilliseconds,
      },
      {
        name: MANAGEMENT_LOG_FLUSH_STEP,
        run: options.flushLogs,
        timeoutMilliseconds: options.logFlushTimeoutMilliseconds,
      },
    ],
  });

class ManagementProcessLifecycle implements HostManagementProcessLifecycle {
  readonly #options: HostManagementProcessLifecycleOptions;
  readonly #terminator: ProcessTerminator;
  #failed = false;

  constructor(options: HostManagementProcessLifecycleOptions) {
    this.#options = options;
    this.#terminator = createTerminator(options, (code: number): void =>
      options.exit(this.#failed ? MANAGEMENT_EXIT_FAILURE : code)
    );
  }

  fatal(event: HostManagementFatalEvent): Promise<void> {
    this.#failed = true;
    this.#options.log.error(
      'Host management encountered a fatal process event',
      fatalDetails(event)
    );
    return this.#terminator.terminate({
      announce: (): void => {},
      exitCode: MANAGEMENT_EXIT_FAILURE,
    });
  }

  signal(signal: NodeJS.Signals): Promise<void> {
    return this.#terminator.terminate({
      announce: (): void => {
        this.#options.log.info('Host management shutdown requested', { signal });
      },
      exitCode: MANAGEMENT_EXIT_SUCCESS,
    });
  }
}

export const createHostManagementProcessLifecycle = (
  options: HostManagementProcessLifecycleOptions
): HostManagementProcessLifecycle => new ManagementProcessLifecycle(options);

const ownTermination = (termination: Promise<void>, log: ManagementLogger): void => {
  void termination.catch((error: unknown): never => {
    log.error('Host management termination failed unexpectedly', {
      failure: 'termination-failure',
      description: describeLogFailure(error),
    });
    process.exit(MANAGEMENT_EXIT_FAILURE);
  });
};

const registerLifecycle = (
  server: Server,
  lifecycle: HostManagementProcessLifecycle,
  log: ManagementLogger
): void => {
  MANAGEMENT_SHUTDOWN_SIGNALS.forEach((signal: NodeJS.Signals): void => {
    process.once(signal, (): void => ownTermination(lifecycle.signal(signal), log));
  });
  process.on('uncaughtException', (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
    ownTermination(
      lifecycle.fatal({
        kind: 'uncaught-exception',
        origin,
        description: describeLogFailure(error),
      }),
      log
    );
  });
  process.on('unhandledRejection', (reason: unknown): void => {
    ownTermination(
      lifecycle.fatal({
        kind: 'unhandled-rejection',
        description: describeLogFailure(reason),
      }),
      log
    );
  });
  server.on('error', (error: Error): void => {
    ownTermination(
      lifecycle.fatal({
        kind: 'http-listener-error',
        description: describeLogFailure(error),
      }),
      log
    );
  });
};

const start = async (
  server: Server,
  log: ManagementLogger,
  loadConfiguration: ManagementConfigLoader
): Promise<Result<string>> => {
  const config = await loadConfiguration();
  return config.ok ? startConfigured(server, config.value, log) : config;
};

const startConfigured = async (
  server: Server,
  config: HostManagementConfig,
  log: ManagementLogger
): Promise<Result<string>> => {
  const gate = await loadManagementPasswordGate(config, log);
  if (!gate.ok) {
    return gate;
  }
  server.once('close', gate.value.close);
  const telemetry = await loadManagementTelemetry(config.queryConfigFile, log);
  server.once('close', telemetry.close);
  const status = createConfiguredStatusReader(config, log);
  const app = createHostManagementApp({
    statusReader: status,
    log,
    staticRoot: MANAGEMENT_WEB_DIRECTORY,
    basePath: config.basePath,
    telemetry,
    gate: gate.value,
  });
  const requestListener = getRequestListener(app.fetch, {
    hostname: httpListenerAddress(config.listen).host,
    errorHandler: (error: unknown): Response => {
      log.error('Host management HTTP adapter failed', {
        failure: 'http-adapter-failure',
        description: describeLogFailure(error),
      });
      return hardenedInternalServerErrorResponse();
    },
  });
  server.on('request', requestListener);
  const result = await listen(server, config.listen);
  if (!result.ok) {
    gate.value.close();
    telemetry.close();
    return result;
  }
  return ok(`${config.listen}${config.basePath}/`);
};

const started = (url: string, log: ManagementLogger): void => {
  log.info('Host management service started', {
    url,
    processId: process.pid,
    version: MANAGEMENT_BUILD_VERSION,
  });
};

const finishStartup = (
  result: Result<string>,
  lifecycle: HostManagementProcessLifecycle,
  log: ManagementLogger
): void => {
  if (result.ok) {
    started(result.value, log);
  } else {
    ownTermination(lifecycle.fatal({ kind: 'startup-failure', description: result.error }), log);
  }
};

export const runHostManagement = (loadConfiguration: ManagementConfigLoader): void => {
  const log: FlushableManagementLogger = createManagementLogger();
  const server = createServer();
  const lifecycle = createHostManagementProcessLifecycle({
    closeServer: () => closeServer(server),
    exit: (code: number): void => process.exit(code),
    flushLogs: async (): Promise<void> => {
      await shutdownNodeOtel();
      await log.flush();
    },
    forceCloseServer: (): void => server.closeAllConnections(),
    log,
    logFlushTimeoutMilliseconds: MANAGEMENT_LOG_FLUSH_TIMEOUT_MILLISECONDS,
    serverShutdownTimeoutMilliseconds: SERVER_SHUTDOWN_TIMEOUT_MILLISECONDS,
  });
  registerLifecycle(server, lifecycle, log);
  void start(server, log, loadConfiguration).then(
    (result: Result<string>): void => finishStartup(result, lifecycle, log),
    (error: unknown): void => {
      ownTermination(
        lifecycle.fatal({
          kind: 'startup-rejection',
          description: describeLogFailure(error),
        }),
        log
      );
    }
  );
};
