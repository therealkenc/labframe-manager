import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  errorMessage,
  fail,
  isCanonicalHttpBaseUrl,
  ok,
  parseJsonMaybe,
  type Result,
} from '@therealkenc/app-runtime/core';
import { z } from 'zod';

import { LOOPBACK_HOSTS, MANAGEMENT_MOUNT_PATTERN } from './constants.js';
import { nativeOnlyOfficeProbeSchema } from './onlyoffice-probe-config.js';

const managementListenSchema = z.url().refine((value: string): boolean => {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.some((host: string) => host === url.hostname) &&
    url.origin === value &&
    url.port.length > 0 &&
    url.port !== '0'
  );
}, 'Expected a canonical loopback HTTP listener origin with an explicit nonzero port');

const absolutePathSchema = z.string().min(1).refine(isAbsolute, 'Expected an absolute file path');
const managementPublicOriginSchema = z.url().refine((value: string): boolean => {
  const url = URL.parse(value);
  return (
    url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  );
}, 'Expected a canonical HTTP or HTTPS origin without credentials or a path');
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const managementAuthenticationSchema = z.strictObject({
  secretsFile: z
    .string()
    .min(1)
    .refine(
      (value: string): boolean => isAbsolute(value) || /^~[\\/].+/u.test(value),
      'Expected an absolute or home-relative secret file path'
    ),
  passwordSecret: z.string().trim().min(1),
  publicOrigin: managementPublicOriginSchema,
  policy: z.strictObject({
    sessionLifetimeSeconds: positiveSafeIntegerSchema,
    maximumSessions: positiveSafeIntegerSchema,
    attemptWindowMilliseconds: positiveSafeIntegerSchema,
    maximumAttemptsPerWindow: positiveSafeIntegerSchema,
    maximumConcurrentAuthentications: positiveSafeIntegerSchema,
  }),
});
const hostManagementConfigSchema = z.strictObject({
  listen: managementListenSchema,
  basePath: z.string().regex(MANAGEMENT_MOUNT_PATTERN),
  authentication: managementAuthenticationSchema,
  queryConfigFile: absolutePathSchema,
  onlyOfficeNativeProbe: nativeOnlyOfficeProbeSchema,
  onlyOffice: z.strictObject({
    documentServerUrl: z
      .string()
      .refine(isCanonicalHttpBaseUrl, 'Expected a canonical HTTP or HTTPS base URL'),
  }),
  telemetry: z.strictObject({ collectorOrigin: managementPublicOriginSchema }),
});

export type HostManagementConfig = z.infer<typeof hostManagementConfigSchema>;
export type ManagementAuthenticationConfig = z.infer<typeof managementAuthenticationSchema>;
export type ManagementConfigLoader = () => Promise<Result<HostManagementConfig>>;

const describeIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue: z.core.$ZodIssue): string => {
      const path = issue.path.length === 0 ? 'configuration' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const parseConfiguration = <T>(text: string, schema: z.ZodType<T>): Result<T> => {
  const json = parseJsonMaybe<unknown>(text);
  if (!json.ok) {
    return fail(`Management configuration is not valid JSON: ${json.error}`);
  }
  const parsed = schema.safeParse(json.value);
  return parsed.success
    ? ok(parsed.data)
    : fail(`Management configuration is invalid: ${describeIssues(parsed.error.issues)}`);
};

export const parseHostManagementConfigText = (text: string): Result<HostManagementConfig> =>
  parseConfiguration(text, hostManagementConfigSchema);

const loadConfiguration = <T>(path: string, schema: z.ZodType<T>): Promise<Result<T>> =>
  readFile(path, 'utf8')
    .then((text: string) => parseConfiguration(text, schema))
    .catch((error: unknown): Result<T> =>
      fail(`Unable to read management configuration ${path}: ${errorMessage(error)}`)
    );

export const loadHostManagementConfig = (path: string): Promise<Result<HostManagementConfig>> =>
  loadConfiguration(path, hostManagementConfigSchema);
