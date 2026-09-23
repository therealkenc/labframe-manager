import { errorMessage, fail, ok, type Result } from '@therealkenc/app-runtime/core';
import type { ManagementLogger } from './contracts.js';
import {
  PASSWORD_BODY_MAXIMUM_BYTES,
  PASSWORD_BODY_TIMEOUT_MILLISECONDS,
  PASSWORD_FORM_FIELD,
  PASSWORD_MAXIMUM_BYTES,
} from './password-gate-constants.js';

interface BodyRead {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly buffer: Buffer;
  readonly bytes: number;
}

const readChunks = async (state: BodyRead): Promise<Result<string>> => {
  const chunk = await state.reader.read();
  if (chunk.done) {
    return ok(state.buffer.subarray(0, state.bytes).toString('utf8'));
  }
  const bytes = state.bytes + chunk.value.byteLength;
  if (bytes > PASSWORD_BODY_MAXIMUM_BYTES) {
    return fail('Password request exceeded its body limit.');
  }
  state.buffer.set(chunk.value, state.bytes);
  return readChunks({ ...state, bytes });
};

const boundedBody = async (request: Request, log: ManagementLogger): Promise<Result<string>> => {
  if (request.body === null) {
    return fail('Password request omitted its body.');
  }
  const reader = request.body.getReader();
  const timeout = Promise.withResolvers<Result<string>>();
  const timer = setTimeout((): void => {
    timeout.resolve(fail('Password request body timed out.'));
  }, PASSWORD_BODY_TIMEOUT_MILLISECONDS);
  return Promise.race([
    readChunks({ reader, buffer: Buffer.alloc(PASSWORD_BODY_MAXIMUM_BYTES), bytes: 0 }).catch(
      (error: unknown): Result<string> => fail(errorMessage(error, 'Password request read failed.'))
    ),
    timeout.promise,
  ]).finally((): void => {
    clearTimeout(timer);
    void reader.cancel().catch((error: unknown): void => {
      log.warn('Manager password request cleanup failed', { description: errorMessage(error) });
    });
  });
};

export const readPasswordForm = async (
  request: Request,
  log: ManagementLogger
): Promise<Result<string>> => {
  const body = await boundedBody(request, log);
  if (!body.ok) {
    return body;
  }
  const form = new URLSearchParams(body.value);
  const password = form.get(PASSWORD_FORM_FIELD);
  return form.size !== 1 ||
    password === null ||
    password.length === 0 ||
    Buffer.byteLength(password) > PASSWORD_MAXIMUM_BYTES
    ? fail('Password request form is invalid.')
    : ok(password);
};
