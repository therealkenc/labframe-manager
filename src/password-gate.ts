import { createHash, randomBytes } from 'node:crypto';
import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { fail, ok, type Result } from '@therealkenc/app-runtime/core';
import { MANAGEMENT_MOUNT_PATTERN } from './constants.js';
import { readPasswordForm } from './password-gate-body.js';
import {
  AUTH_API_PREFIX,
  AUTH_CACHE_CONTROL,
  AUTH_HEALTH_PATH,
  AUTH_HTTP_GET,
  AUTH_HTTP_POST,
  AUTH_HTTPS_PROTOCOL,
  AUTH_METHOD_REJECTED,
  AUTH_REQUEST_REJECTED,
  AUTH_STATUS,
  AUTH_UNAVAILABLE,
  MANAGEMENT_LOGIN_ASSET_PATHS,
  MANAGEMENT_LOGIN_PATH,
  MANAGEMENT_LOGOUT_PATH,
  MANAGEMENT_SESSION_COOKIE,
  MILLISECONDS_PER_SECOND,
  PASSWORD_FORM_CONTENT_TYPE,
  PASSWORD_MAXIMUM_BYTES,
  SESSION_HASH_ALGORITHM,
  SESSION_TOKEN_BYTES,
  SESSION_TOKEN_PATTERN,
  SIGN_IN_REQUIRED,
  TOKEN_ENCODING,
} from './password-gate-constants.js';
import { createPasswordVerifier, type PasswordVerifier } from './password-gate-crypto.js';
import type {
  PasswordGate,
  PasswordGateAsset,
  PasswordGateLoginError,
  PasswordGateOptions,
} from './password-gate-contracts.js';

export type {
  PasswordGate,
  PasswordGateAsset,
  PasswordGateLoginError,
  PasswordGateLoginState,
  PasswordGateOptions,
  PasswordGatePolicy,
} from './password-gate-contracts.js';

type GateRuntimeOptions = Omit<PasswordGateOptions, 'password'>;
type LoginFailureStatus = 400 | 401 | 429 | 503;

const sessionKey = (token: string): string =>
  createHash(SESSION_HASH_ALGORITHM).update(token).digest(TOKEN_ENCODING);

const currentToken = (context: Context): string | undefined => {
  const token = getCookie(context, MANAGEMENT_SESSION_COOKIE);
  return token !== undefined && SESSION_TOKEN_PATTERN.test(token) ? token : undefined;
};

const trustedForm = (context: Context, publicOrigin: string): boolean =>
  context.req.header('origin') === publicOrigin &&
  context.req.header('content-type')?.split(';')[0]?.trim() === PASSWORD_FORM_CONTENT_TYPE;

const cookieOptions = (options: GateRuntimeOptions): CookieOptions => ({
  httpOnly: true,
  secure: new URL(options.publicOrigin).protocol === AUTH_HTTPS_PROTOCOL,
  sameSite: 'Strict',
  path: options.basePath.length === 0 ? '/' : options.basePath,
  maxAge: options.policy.sessionLifetimeSeconds,
});

class ManagerPasswordGate implements PasswordGate {
  readonly #options: GateRuntimeOptions;
  readonly #verifier: PasswordVerifier;
  readonly #sessions = new Map<string, number>();
  readonly #assets: ReadonlyMap<string, PasswordGateAsset>;
  #closed = false;
  #attempts = 0;
  #windowUntil = 0;
  #inFlight = 0;

  constructor(options: GateRuntimeOptions, verifier: PasswordVerifier) {
    this.#options = options;
    this.#verifier = verifier;
    this.#assets = new Map(
      [...options.loginAssets].map(
        ([path, asset]: [string, PasswordGateAsset]): [string, PasswordGateAsset] => [
          `${options.basePath}${path}`,
          asset,
        ]
      )
    );
  }

  readonly middleware = async (context: Context, next: Next): Promise<Response | void> => {
    context.header('Cache-Control', AUTH_CACHE_CONTROL);
    const { basePath } = this.#options;
    const { path, method } = context.req;
    if (path === `${basePath}${AUTH_HEALTH_PATH}` && method === AUTH_HTTP_GET) {
      await next();
      return;
    }
    if (this.#closed) {
      return context.json(AUTH_UNAVAILABLE, AUTH_STATUS.unavailable);
    }
    if (path === `${basePath}${MANAGEMENT_LOGIN_PATH}`) {
      return this.loginRoute(context);
    }
    if (path === `${basePath}${MANAGEMENT_LOGOUT_PATH}`) {
      return this.logoutRoute(context);
    }
    const asset = method === AUTH_HTTP_GET ? this.#assets.get(path) : undefined;
    if (asset !== undefined) {
      context.header('Content-Type', asset.contentType);
      return context.body(asset.content);
    }
    if (!this.authenticated(context)) {
      return this.unauthorized(context);
    }
    await next();
  };

  readonly close = (): void => {
    this.#closed = true;
    this.#sessions.clear();
    this.#verifier.close();
  };

  private authenticated(context: Context): boolean {
    this.prune();
    const token = currentToken(context);
    return token !== undefined && this.#sessions.has(sessionKey(token));
  }

  private unauthorized(context: Context): Response {
    deleteCookie(context, MANAGEMENT_SESSION_COOKIE, cookieOptions(this.#options));
    const prefix = `${this.#options.basePath}${AUTH_API_PREFIX}`;
    return context.req.path === prefix || context.req.path.startsWith(`${prefix}/`)
      ? context.json(SIGN_IN_REQUIRED, AUTH_STATUS.unauthorized)
      : context.redirect(this.loginPath(), AUTH_STATUS.redirect);
  }

  private loginPath(): string {
    return `${this.#options.basePath}${MANAGEMENT_LOGIN_PATH}`;
  }

  private loginPage(
    context: Context,
    error: PasswordGateLoginError,
    status: LoginFailureStatus
  ): Response {
    return context.html(
      this.#options.loginPage({ basePath: this.#options.basePath, error }),
      status
    );
  }

  private loginRoute(context: Context): Promise<Response> | Response {
    if (context.req.method === AUTH_HTTP_GET) {
      return this.authenticated(context)
        ? context.redirect(`${this.#options.basePath}/`, AUTH_STATUS.redirect)
        : context.html(
            this.#options.loginPage({ basePath: this.#options.basePath, error: 'none' })
          );
    }
    if (context.req.method !== AUTH_HTTP_POST) {
      return context.json(AUTH_METHOD_REJECTED, AUTH_STATUS.methodNotAllowed);
    }
    if (!trustedForm(context, this.#options.publicOrigin)) {
      this.#options.log.warn('Manager sign-in request origin or form type rejected', {});
      return context.json(AUTH_REQUEST_REJECTED, AUTH_STATUS.forbidden);
    }
    if (!this.admit()) {
      this.#options.log.warn('Manager sign-in attempt limit reached', {});
      return this.loginPage(context, 'throttled', AUTH_STATUS.throttled);
    }
    return this.signIn(context).finally((): void => {
      this.#inFlight -= 1;
    });
  }

  private async signIn(context: Context): Promise<Response> {
    const password = await readPasswordForm(context.req.raw, this.#options.log);
    if (!password.ok) {
      this.#options.log.warn('Manager sign-in form rejected', { description: password.error });
      return this.loginPage(context, 'rejected', AUTH_STATUS.badRequest);
    }
    const verified = await this.#verifier.verify(password.value);
    if (this.#closed || !verified.ok) {
      return this.loginPage(context, 'unavailable', AUTH_STATUS.unavailable);
    }
    if (!verified.value) {
      this.#options.log.warn('Manager sign-in password rejected', {});
      return this.loginPage(context, 'rejected', AUTH_STATUS.unauthorized);
    }
    return this.openSession(context);
  }

  private openSession(context: Context): Response {
    this.prune();
    const previous = currentToken(context);
    const previousKey = previous === undefined ? undefined : sessionKey(previous);
    const replacing = previousKey !== undefined && this.#sessions.has(previousKey);
    if (!replacing && this.#sessions.size >= this.#options.policy.maximumSessions) {
      this.#options.log.warn('Manager session capacity reached', {});
      return this.loginPage(context, 'throttled', AUTH_STATUS.throttled);
    }
    const token = randomBytes(SESSION_TOKEN_BYTES).toString(TOKEN_ENCODING);
    const expiresAt =
      this.#options.now() + this.#options.policy.sessionLifetimeSeconds * MILLISECONDS_PER_SECOND;
    if (previousKey !== undefined) {
      this.#sessions.delete(previousKey);
    }
    this.#sessions.set(sessionKey(token), expiresAt);
    setCookie(context, MANAGEMENT_SESSION_COOKIE, token, cookieOptions(this.#options));
    this.#options.log.info('Manager sign-in session opened', {});
    return context.redirect(`${this.#options.basePath}/`, AUTH_STATUS.redirect);
  }

  private logoutRoute(context: Context): Response {
    if (context.req.method !== AUTH_HTTP_POST) {
      return context.json(AUTH_METHOD_REJECTED, AUTH_STATUS.methodNotAllowed);
    }
    if (!trustedForm(context, this.#options.publicOrigin)) {
      this.#options.log.warn('Manager sign-out request origin or form type rejected', {});
      return context.json(AUTH_REQUEST_REJECTED, AUTH_STATUS.forbidden);
    }
    const token = currentToken(context);
    if (token !== undefined) {
      this.#sessions.delete(sessionKey(token));
    }
    deleteCookie(context, MANAGEMENT_SESSION_COOKIE, cookieOptions(this.#options));
    this.#options.log.info('Manager sign-in session closed', {});
    return context.redirect(this.loginPath(), AUTH_STATUS.redirect);
  }

  private admit(): boolean {
    const now = this.#options.now();
    const policy = this.#options.policy;
    if (now >= this.#windowUntil) {
      this.#windowUntil = now + policy.attemptWindowMilliseconds;
      this.#attempts = 0;
    }
    if (
      this.#attempts >= policy.maximumAttemptsPerWindow ||
      this.#inFlight >= policy.maximumConcurrentAuthentications
    ) {
      return false;
    }
    this.#attempts += 1;
    this.#inFlight += 1;
    return true;
  }

  private prune(): void {
    const now = this.#options.now();
    [...this.#sessions].forEach(([key, expiresAt]: [string, number]): void => {
      if (expiresAt <= now) {
        this.#sessions.delete(key);
      }
    });
  }
}

const validOptions = (options: PasswordGateOptions): boolean => {
  const url = URL.parse(options.publicOrigin);
  return (
    options.password.length > 0 &&
    Buffer.byteLength(options.password) <= PASSWORD_MAXIMUM_BYTES &&
    url !== null &&
    url.origin === options.publicOrigin &&
    (url.protocol === AUTH_HTTPS_PROTOCOL || url.protocol === 'http:') &&
    MANAGEMENT_MOUNT_PATTERN.test(options.basePath) &&
    Object.values(options.policy).every(
      (value: number): boolean => Number.isSafeInteger(value) && value > 0
    ) &&
    [...options.loginAssets.keys()].every((path: string): boolean =>
      MANAGEMENT_LOGIN_ASSET_PATHS.some((allowed: string): boolean => allowed === path)
    )
  );
};

export const createPasswordGate = async (
  options: PasswordGateOptions
): Promise<Result<PasswordGate>> => {
  if (!validOptions(options)) {
    options.log.error('Manager password gate configuration is invalid', {});
    return fail('Manager password gate configuration is invalid.');
  }
  const { password, ...runtime } = options;
  const verifier = await createPasswordVerifier(password, options.log);
  return verifier.ok ? ok(new ManagerPasswordGate(runtime, verifier.value)) : verifier;
};
