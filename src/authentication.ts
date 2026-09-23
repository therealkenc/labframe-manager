import { createSecretProvider, resolveSecret } from 'secrets-api';
import type { Result } from '@therealkenc/app-runtime/core';
import type { HostManagementConfig } from './config.js';
import type { ManagementLogger } from './contracts.js';
import { loadAuthenticationResources } from './authentication-resources.js';
import { createPasswordGate, type PasswordGate } from './password-gate.js';

export const loadManagementPasswordGate = async (
  config: HostManagementConfig,
  log: ManagementLogger
): Promise<Result<PasswordGate>> => {
  const { authentication } = config;
  const provider = createSecretProvider({
    provider: 'json-file',
    location: authentication.secretsFile,
    adminLocation: authentication.secretsFile,
  });
  const secrets = await provider.load();
  if (!secrets.ok) {
    return secrets;
  }
  const password = resolveSecret(secrets.value, authentication.passwordSecret);
  if (!password.ok) {
    return password;
  }
  const resources = await loadAuthenticationResources();
  return createPasswordGate({
    ...resources,
    password: password.value,
    publicOrigin: authentication.publicOrigin,
    basePath: config.basePath,
    policy: authentication.policy,
    log,
    now: Date.now,
  });
};
