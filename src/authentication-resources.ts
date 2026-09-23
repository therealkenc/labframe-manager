import { readFile } from 'node:fs/promises';
import { packageResourceUrl } from '@therealkenc/app-runtime/runtime-resources';
import type {
  PasswordGateAsset,
  PasswordGateLoginError,
  PasswordGateLoginState,
} from './password-gate.js';
import { MANAGEMENT_LOGIN_ASSET_PATHS } from './password-gate-constants.js';
import { MANAGEMENT_RESOURCES } from './resources.js';

const LOGIN_TEMPLATE = 'login.html';
const BASE_PATH_TOKEN = '{{basePath}}';
const ERROR_TOKEN = '{{errorMessage}}';
const LOGIN_ERRORS: Record<PasswordGateLoginError, string> = {
  none: '',
  rejected: 'That password was not accepted. Please try again.',
  throttled: 'Too many sign-in attempts. Please wait before trying again.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again.',
};
const HTML_ENTITIES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);
const ASSET_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

export interface AuthenticationResources {
  readonly loginPage: (state: PasswordGateLoginState) => string;
  readonly loginAssets: ReadonlyMap<string, PasswordGateAsset>;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character: string) => HTML_ENTITIES.get(character) ?? character);

export const loadAuthenticationResources = async (): Promise<AuthenticationResources> => {
  const root = packageResourceUrl(MANAGEMENT_RESOURCES);
  const template = await readFile(new URL(LOGIN_TEMPLATE, root), 'utf8');
  const assets = await Promise.all(
    MANAGEMENT_LOGIN_ASSET_PATHS.map(async (path: string): Promise<[string, PasswordGateAsset]> => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const extension = name.slice(name.lastIndexOf('.'));
      const contentType = ASSET_TYPES.get(extension);
      if (contentType === undefined) {
        throw new Error(`Unsupported Manager login asset: ${name}`);
      }
      return [path, { content: await readFile(new URL(name, root), 'utf8'), contentType }];
    })
  );
  return {
    loginPage: (state: PasswordGateLoginState): string =>
      template
        .replaceAll(BASE_PATH_TOKEN, escapeHtml(state.basePath))
        .replaceAll(ERROR_TOKEN, escapeHtml(LOGIN_ERRORS[state.error])),
    loginAssets: new Map(assets),
  };
};
