import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { Hono, type Context, type Next } from 'hono';
import { describeLogFailure } from '@therealkenc/telemetry';

import type { HostManagementSnapshot, HostStatusReader, ManagementLogger } from './contracts.js';
import { MANAGEMENT_SERVICE_INFO_PATH, MANAGEMENT_SERVICE_NAME } from './constants.js';
import { MANAGEMENT_BUILD_IDENTITY } from './build-identity.js';
import { hostManagementSnapshotSchema } from './observation-contracts.js';
import { registerTelemetryRoutes } from './telemetry-routes.js';
import type { ManagementTelemetry } from './telemetry.js';
import type { PasswordGate } from './password-gate.js';

const API_PREFIX = '/api';
const HEALTH_PATH = '/health';
const STATUS_PATH = '/api/v1/status';
const INTERNAL_SERVER_ERROR = { description: 'Host management request failed' } as const;
const STATUS_UNAVAILABLE = { description: 'Host status is temporarily unavailable' } as const;
const NOT_FOUND = { description: 'Not found' } as const;
const HTTP_REQUEST_FAILURE_CODE = 'HOST_MANAGEMENT_HTTP_REQUEST_FAILED';
const STATUS_READ_FAILURE_CODE = 'HOST_MANAGEMENT_STATUS_READ_FAILED';
const INTERNAL_SERVER_ERROR_STATUS = 500;

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ');

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
} as const;

const INTERNAL_SERVER_ERROR_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Type': 'application/json; charset=UTF-8',
} as const;

const INTERNAL_SERVER_ERROR_BODY = JSON.stringify(INTERNAL_SERVER_ERROR);

export const hardenedInternalServerErrorResponse = (): Response =>
  new Response(INTERNAL_SERVER_ERROR_BODY, {
    headers: INTERNAL_SERVER_ERROR_HEADERS,
    status: INTERNAL_SERVER_ERROR_STATUS,
  });

const applySecurityHeaders = (context: Context): void => {
  Object.entries(SECURITY_HEADERS).forEach(([name, value]: readonly [string, string]): void => {
    context.header(name, value);
  });
};

const secureResponse = async (context: Context, next: Next): Promise<void> => {
  applySecurityHeaders(context);
  await next();
  applySecurityHeaders(context);
};

const readStatus = (
  context: Context,
  statusReader: HostStatusReader,
  log: ManagementLogger
): Promise<Response> =>
  Promise.resolve()
    .then((): Promise<HostManagementSnapshot> => statusReader.read())
    .then(
      (snapshot: HostManagementSnapshot): Response =>
        context.json(hostManagementSnapshotSchema.parse(snapshot)),
      (error: unknown): Response => {
        log.error('Host management status read failed', {
          description: describeLogFailure(error),
          failureCode: STATUS_READ_FAILURE_CODE,
        });
        return context.json(STATUS_UNAVAILABLE, 503);
      }
    );

const apiPath = (path: string): boolean => path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);

export interface HostManagementAppOptions {
  readonly statusReader: HostStatusReader;
  readonly log: ManagementLogger;
  readonly staticRoot: string;
  readonly basePath: string;
  readonly telemetry: ManagementTelemetry;
  readonly gate: PasswordGate;
}

export const createHostManagementApp = (options: HostManagementAppOptions): Hono => {
  const { statusReader, log, staticRoot, basePath, telemetry } = options;
  const app = new Hono();
  const routes = new Hono();
  routes.get(MANAGEMENT_SERVICE_INFO_PATH, (context: Context) =>
    context.json({ build: MANAGEMENT_BUILD_IDENTITY })
  );
  app.use('*', secureResponse);
  app.use('*', options.gate.middleware);
  app.onError((error: Error, context: Context): Response => {
    log.error('Host management HTTP request failed unexpectedly', {
      boundary: apiPath(context.req.path.slice(basePath.length)) ? 'api' : 'static',
      description: describeLogFailure(error),
      failureCode: HTTP_REQUEST_FAILURE_CODE,
    });
    return hardenedInternalServerErrorResponse();
  });
  routes.get(HEALTH_PATH, (context: Context) =>
    context.json({ service: MANAGEMENT_SERVICE_NAME, status: 'ok' })
  );
  routes.get(STATUS_PATH, (context: Context) => readStatus(context, statusReader, log));
  registerTelemetryRoutes(routes, telemetry, log);
  routes.all(API_PREFIX, (context: Context) => context.json(NOT_FOUND, 404));
  routes.all(`${API_PREFIX}/*`, (context: Context) => context.json(NOT_FOUND, 404));
  routes.get(
    '*',
    serveStatic({
      index: 'index.html',
      root: resolve(staticRoot),
      rewriteRequestPath: (path: string) => path.slice(basePath.length),
    })
  );
  if (basePath.length > 0) {
    app.get(basePath, (context: Context) => context.redirect(`${basePath}/`, 308));
  }
  app.route(basePath, routes);
  return app;
};
