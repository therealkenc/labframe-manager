import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { errorMessage, fail, ok, type Result } from '@therealkenc/app-runtime/core';
import type { ManagementLogger } from './contracts.js';
import {
  PASSWORD_KEY_BYTES,
  PASSWORD_SALT_BYTES,
  PASSWORD_SCRYPT_OPTIONS,
} from './password-gate-constants.js';

export interface PasswordVerifier {
  readonly verify: (password: string) => Promise<Result<boolean>>;
  readonly close: () => void;
}

const deriveKey = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve: (key: Buffer) => void, reject: (error: Error) => void): void => {
    scrypt(
      password,
      salt,
      PASSWORD_KEY_BYTES,
      PASSWORD_SCRYPT_OPTIONS,
      (error: Error | null, key: Buffer): void => (error === null ? resolve(key) : reject(error))
    );
  });

const verifierFailure = (log: ManagementLogger, error: unknown): Result<never> => {
  log.error('Manager password verifier failed', { description: errorMessage(error) });
  return fail('Manager password verifier is unavailable.');
};

const verifier = (salt: Buffer, expected: Buffer, log: ManagementLogger): PasswordVerifier => ({
  verify: (password: string): Promise<Result<boolean>> =>
    deriveKey(password, salt)
      .then((actual: Buffer): Result<boolean> => {
        const matches = timingSafeEqual(actual, expected);
        actual.fill(0);
        return ok(matches);
      })
      .catch((error: unknown): Result<boolean> => verifierFailure(log, error)),
  close: (): void => {
    expected.fill(0);
    salt.fill(0);
  },
});

export const createPasswordVerifier = (
  password: string,
  log: ManagementLogger
): Promise<Result<PasswordVerifier>> => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  return deriveKey(password, salt)
    .then((expected: Buffer): Result<PasswordVerifier> => ok(verifier(salt, expected, log)))
    .catch((error: unknown): Result<PasswordVerifier> => verifierFailure(log, error));
};
