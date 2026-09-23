import type { QueryResult } from '@therealkenc/telemetry/query';
import { type ZodType } from 'zod';

import { UI } from './constants.js';
import { AUTH_STATUS, MANAGEMENT_LOGIN_PATH } from '../src/password-gate-constants.js';
import { log } from './telemetry.js';

const failed = <T>(description: string): QueryResult<T> => ({
  ok: false,
  error: { kind: 'unavailable', description },
});

const parseResponse = async <T>(
  response: Response,
  schema: ZodType<QueryResult<T>>,
  path: string
): Promise<QueryResult<T>> => {
  if (response.status === AUTH_STATUS.unauthorized) {
    log.info('Manager session ended; returning to sign in');
    window.location.replace(new URL(`.${MANAGEMENT_LOGIN_PATH}`, document.baseURI));
    return failed('Sign in to use Labframe Manager.');
  }
  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    log.error('Management response did not match its contract', { path, status: response.status });
    return {
      ok: false,
      error: {
        kind: 'invalid-response',
        description: 'The management API returned an invalid response.',
      },
    };
  }
  return parsed.data;
};

export const request = async <T>(
  path: string,
  schema: ZodType<QueryResult<T>>,
  body: object | undefined,
  signal: AbortSignal
): Promise<QueryResult<T>> =>
  fetch(new URL(path, document.baseURI), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(UI.requestTimeoutMilliseconds)]),
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then((response: Response) => parseResponse(response, schema, path))
    .catch((error: unknown): QueryResult<T> => {
      const description =
        error instanceof Error ? error.message : 'The request could not complete.';
      if (!signal.aborted) {
        log.warn('Management API request failed', { path, description });
      }
      return failed(description);
    });
