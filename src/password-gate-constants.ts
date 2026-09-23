export const MANAGEMENT_LOGIN_PATH = '/auth/login';
export const MANAGEMENT_LOGOUT_PATH = '/auth/logout';
export const MANAGEMENT_LOGIN_ASSET_PATHS = ['/auth/login.css', '/auth/manager-mark.svg'] as const;
export const MANAGEMENT_SESSION_COOKIE = 'labframe_manager_session';
export const PASSWORD_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
export const PASSWORD_FORM_FIELD = 'password';
export const PASSWORD_BODY_MAXIMUM_BYTES = 4_096;
export const PASSWORD_MAXIMUM_BYTES = 1_024;
export const PASSWORD_BODY_TIMEOUT_MILLISECONDS = 5_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_KEY_BYTES = 32;
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
export const SESSION_HASH_ALGORITHM = 'sha256';
export const TOKEN_ENCODING = 'hex';
export const MILLISECONDS_PER_SECOND = 1_000;
export const PASSWORD_SCRYPT_OPTIONS = {
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  maxmem: 32 * 1_024 * 1_024,
} as const;
export const AUTH_API_PREFIX = '/api';
export const AUTH_HEALTH_PATH = '/health';
export const AUTH_HTTP_GET = 'GET';
export const AUTH_HTTP_POST = 'POST';
export const AUTH_HTTPS_PROTOCOL = 'https:';
export const AUTH_CACHE_CONTROL = 'no-store';
export const SIGN_IN_REQUIRED = { description: 'Sign in to use Labframe Manager.' } as const;
export const AUTH_REQUEST_REJECTED = {
  description: 'Authentication request was not accepted.',
} as const;
export const AUTH_METHOD_REJECTED = { description: 'Method not allowed.' } as const;
export const AUTH_UNAVAILABLE = { description: 'Manager sign-in is unavailable.' } as const;
export const AUTH_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  methodNotAllowed: 405,
  throttled: 429,
  unavailable: 503,
  redirect: 303,
} as const;
