import { z } from 'zod';

const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;

export const nativeOnlyOfficeProbeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('disabled') }),
  z.strictObject({
    kind: z.literal('windows'),
    installationRoot: z.string().regex(WINDOWS_ABSOLUTE_PATH),
  }),
]);

export type NativeOnlyOfficeProbe = z.infer<typeof nativeOnlyOfficeProbeSchema>;
