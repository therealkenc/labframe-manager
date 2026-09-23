import { fail, ok, parseJsonMaybe, type Result } from '@therealkenc/app-runtime/core';
import { z } from 'zod';

const OBSERVED_SERVICE_NAMES = [
  'DsConverterSvc',
  'DsDocServiceSvc',
  'DsProxySvc',
  'DsExampleSvc',
] as const;
const PROBE_NOTE_CODES = [
  'installation-root-missing',
  'installed-version-unavailable',
  'service-query-failed',
  'process-query-failed',
  'listener-query-failed',
] as const;
const MAXIMUM_PROCESS_ID = 0xffff_ffff;

export type ProbeNoteCode = (typeof PROBE_NOTE_CODES)[number];

const processIdSchema = z.number().int().min(0).max(MAXIMUM_PROCESS_ID);
const containsOnlyVisibleText = (value: string): boolean =>
  [...value].every((character: string): boolean => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
  });
const safeTextSchema = z.string().min(1).max(260).refine(containsOnlyVisibleText);
const versionSchema = z.union([
  z.literal('unknown'),
  z
    .string()
    .max(64)
    .regex(/^\d+(?:\.\d+){1,4}$/u),
]);
const serviceSchema = z.strictObject({
  displayName: safeTextSchema,
  name: z.enum(OBSERVED_SERVICE_NAMES),
  processId: processIdSchema,
  startMode: z.enum(['Auto', 'Boot', 'Disabled', 'Manual', 'System']),
  state: z.enum([
    'Stopped',
    'Start Pending',
    'Stop Pending',
    'Running',
    'Continue Pending',
    'Pause Pending',
    'Paused',
    'Unknown',
  ]),
});
const processSchema = z.strictObject({
  name: safeTextSchema,
  parentProcessId: processIdSchema,
  processId: processIdSchema,
  workingSetBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const listenerSchema = z.strictObject({
  address: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9a-f:.%]+$/iu),
  port: z.number().int().min(1).max(65_535),
  processId: processIdSchema,
});
const probeSchema = z.strictObject({
  installedVersion: versionSchema,
  listeners: z.array(listenerSchema).max(1_024),
  notes: z.array(z.enum(PROBE_NOTE_CODES)).max(PROBE_NOTE_CODES.length),
  processes: z.array(processSchema).max(1_024),
  services: z.array(serviceSchema).max(OBSERVED_SERVICE_NAMES.length),
});

export type OnlyOfficeProbe = z.infer<typeof probeSchema>;

export const parseOnlyOfficeProbe = (text: string): Result<OnlyOfficeProbe, 'invalid-output'> => {
  const json = parseJsonMaybe<unknown>(text);
  if (!json.ok) {
    return fail('invalid-output');
  }

  const parsed = probeSchema.safeParse(json.value);
  return parsed.success ? ok(parsed.data) : fail('invalid-output');
};
