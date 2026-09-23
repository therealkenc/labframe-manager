import { queryFail, type QueryResult } from '@therealkenc/telemetry/query';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parseJsonMaybe } from '@therealkenc/app-runtime/core';
import type { z } from 'zod';

import {
  TELEMETRY_API,
  telemetryHealthRequestSchema,
  telemetryLogsRequestSchema,
  telemetryRunsRequestSchema,
  telemetrySourcesRequestSchema,
  type TelemetryHealthRequest,
} from './api-contracts.js';
import { TELEMETRY_REQUEST_BYTES } from './constants.js';
import type { ManagementLogger } from './contracts.js';
import type { ManagementTelemetry } from './telemetry.js';

interface QueryHandlerOptions<T, U> {
  readonly context: Context;
  readonly schema: z.ZodType<T>;
  readonly handle: (request: T) => Promise<QueryResult<U>>;
  readonly log: ManagementLogger;
}

const queryRequest = async <T, U>(options: QueryHandlerOptions<T, U>): Promise<Response> => {
  const text = await options.context.req.text();
  const json = parseJsonMaybe<unknown>(text);
  const parsed = json.ok ? options.schema.safeParse(json.value) : undefined;
  if (parsed?.success !== true) {
    const description = parsed === undefined ? 'Expected JSON request.' : parsed.error.message;
    options.log.warn('Management query request rejected', { description });
    return options.context.json(queryFail('invalid-request', description), 400);
  }
  return options.context.json(await options.handle(parsed.data));
};

export const registerTelemetryRoutes = (
  app: Hono,
  telemetry: ManagementTelemetry,
  log: ManagementLogger
): void => {
  app.use(
    '/api/v1/telemetry/*',
    bodyLimit({
      maxSize: TELEMETRY_REQUEST_BYTES,
      onError: (context: Context) => {
        log.warn('Management query request exceeds body limit', { limit: TELEMETRY_REQUEST_BYTES });
        return context.json(
          queryFail('limit-exceeded', 'Query request exceeds its size limit.'),
          413
        );
      },
    })
  );
  app.get(`/${TELEMETRY_API.targets}`, (context: Context) => context.json(telemetry.targets()));
  app.post(`/${TELEMETRY_API.sources}`, (context: Context) =>
    queryRequest({
      context,
      schema: telemetrySourcesRequestSchema,
      handle: telemetry.sources,
      log,
    })
  );
  app.post(`/${TELEMETRY_API.runs}`, (context: Context) =>
    queryRequest({
      context,
      schema: telemetryRunsRequestSchema,
      handle: telemetry.runs,
      log,
    })
  );
  app.post(`/${TELEMETRY_API.logs}`, (context: Context) =>
    queryRequest({
      context,
      schema: telemetryLogsRequestSchema,
      handle: telemetry.logs,
      log,
    })
  );
  app.post(`/${TELEMETRY_API.health}`, (context: Context) =>
    queryRequest({
      context,
      schema: telemetryHealthRequestSchema,
      handle: (request: TelemetryHealthRequest) => telemetry.health(request.target, request.probe),
      log,
    })
  );
};
