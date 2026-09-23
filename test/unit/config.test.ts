import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHostManagementConfigText } from '../../src/config.js';
import { authenticationConfig } from './management-fixtures.js';

const settings = {
  listen: 'http://localhost:3004',
  basePath: '/console',
  authentication: authenticationConfig,
  onlyOffice: { documentServerUrl: 'http://127.0.0.1' },
  telemetry: { collectorOrigin: 'http://127.0.0.1:4318' },
  onlyOfficeNativeProbe: {
    kind: 'windows',
    installationRoot: 'C:\\Program Files\\ONLYOFFICE\\DocumentServer',
  },
};
const config = {
  ...settings,
  queryConfigFile: 'C:\\ProgramData\\Labframe\\telemetry-targets.json',
};

test('rejects public or ambiguous management listeners', () => {
  ['http://0.0.0.0:3004', 'http://localhost:0', 'http://localhost:3004/'].forEach(
    (listen: string) => {
      const result = parseHostManagementConfigText(JSON.stringify({ ...config, listen }));
      assert.equal(result.ok, false);
      assert.match(result.error, /loopback/u);
    }
  );
});

test('rejects ambiguous mount paths', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({ ...config, basePath: '/console/../api' })
  );
  assert.equal(result.ok, false);
});

test('accepts standalone endpoint configuration without a Labframe config reference', () => {
  const result = parseHostManagementConfigText(JSON.stringify(config));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.onlyOffice, config.onlyOffice);
  assert.deepEqual(result.value.telemetry, config.telemetry);
});

test('requires explicit endpoints in development and installed configurations', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({ ...config, onlyOffice: undefined })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /onlyOffice/u);
});

test('installed configuration cannot select query targets from the service account home', () => {
  const result = parseHostManagementConfigText(JSON.stringify(settings));
  assert.equal(result.ok, false);
  assert.match(result.error, /queryConfigFile/u);
});

test('native inspection can be disabled independently of remote endpoint selection', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({
      ...config,
      onlyOfficeNativeProbe: { kind: 'disabled' },
    })
  );
  assert.equal(result.ok, true);
});

test('rejects malformed JSON without throwing', () => {
  const result = parseHostManagementConfigText('{');
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/u);
});

test('rejects relative installed paths and superseded duplicate endpoint fields', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({
      ...config,
      applicationConfigFile: './application.json',
      queryConfigFile: './targets.json',
      collectorOrigin: 'http://localhost:4318',
      onlyOfficeNativeProbe: { kind: 'windows', installationRoot: './DocumentServer' },
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /absolute/u);
  assert.match(result.error, /Unrecognized key/u);
});

test('authentication is required and has no implicit policy values', () => {
  const missing = parseHostManagementConfigText(
    JSON.stringify({ ...config, authentication: undefined })
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /authentication/u);
  const incomplete = parseHostManagementConfigText(
    JSON.stringify({ ...config, authentication: { ...authenticationConfig, policy: {} } })
  );
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /policy/u);
});

test('authentication accepts HTTPS public origins independently of its loopback listener', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({
      ...config,
      authentication: {
        ...authenticationConfig,
        publicOrigin: 'https://labframe.example.test',
        secretsFile: 'C:\\ProgramData\\LabframeManager\\secrets.json',
      },
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.authentication.publicOrigin, 'https://labframe.example.test');
});

test('authentication rejects ambiguous origins, credentials, paths, and other protocols', () => {
  [
    'https://labframe.example.test/',
    'https://labframe.example.test/console',
    'https://labframe.example.test?mode=test',
    'https://labframe.example.test#console',
    'https://user:password@labframe.example.test',
    'ftp://labframe.example.test',
    'https://LABFRAME.example.test',
  ].forEach((publicOrigin: string): void => {
    const result = parseHostManagementConfigText(
      JSON.stringify({
        ...config,
        authentication: { ...authenticationConfig, publicOrigin },
      })
    );
    assert.equal(result.ok, false, publicOrigin);
    assert.match(result.error, /publicOrigin/u);
  });
});

test('authentication requires a secret key and an absolute or home-relative secret path', () => {
  ['', 'secrets.json', './secrets.json', '~', '~/'].forEach((secretsFile: string): void => {
    const result = parseHostManagementConfigText(
      JSON.stringify({ ...config, authentication: { ...authenticationConfig, secretsFile } })
    );
    assert.equal(result.ok, false, secretsFile);
    assert.match(result.error, /secretsFile/u);
  });
  const result = parseHostManagementConfigText(
    JSON.stringify({
      ...config,
      authentication: { ...authenticationConfig, passwordSecret: '   ' },
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /passwordSecret/u);
});

test('every authentication bound requires a positive safe integer', () => {
  Object.keys(authenticationConfig.policy).forEach((key: string): void => {
    [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].forEach((value: number): void => {
      const result = parseHostManagementConfigText(
        JSON.stringify({
          ...config,
          authentication: {
            ...authenticationConfig,
            policy: { ...authenticationConfig.policy, [key]: value },
          },
        })
      );
      assert.equal(result.ok, false, `${key}: ${String(value)}`);
      assert.match(result.error, /policy/u);
    });
  });
});

test('authentication rejects unrecognized policy switches', () => {
  const result = parseHostManagementConfigText(
    JSON.stringify({
      ...config,
      authentication: {
        ...authenticationConfig,
        policy: { ...authenticationConfig.policy, disabled: true },
      },
    })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Unrecognized key/u);
});
