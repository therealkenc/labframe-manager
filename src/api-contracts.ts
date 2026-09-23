import {
  logQueryRequestSchema,
  queryHealthSchema,
  queryPageSchema,
  queryResultSchema,
  queryTargetInfoSchema,
  runPageSchema,
  runQuerySchema,
  sourcePageSchema,
  sourceQuerySchema,
} from '@therealkenc/telemetry/query';
import { z } from 'zod';

export const TELEMETRY_API = {
  targets: 'api/v1/telemetry/targets',
  sources: 'api/v1/telemetry/sources',
  runs: 'api/v1/telemetry/runs',
  logs: 'api/v1/telemetry/logs',
  health: 'api/v1/telemetry/health',
  status: 'api/v1/status',
} as const;

const targetSelectionSchema = z.strictObject({ target: z.string() });

export const telemetrySourcesRequestSchema = targetSelectionSchema.extend({
  request: sourceQuerySchema,
});
export const telemetryRunsRequestSchema = targetSelectionSchema.extend({ request: runQuerySchema });
export const telemetryLogsRequestSchema = targetSelectionSchema.extend({
  request: logQueryRequestSchema,
});
export const telemetryHealthRequestSchema = z.strictObject({
  target: z.string(),
  probe: z.boolean(),
});
export type TelemetryHealthRequest = z.infer<typeof telemetryHealthRequestSchema>;

export const telemetryTargetsSchema = z.strictObject({
  targets: z.array(queryTargetInfoSchema).readonly(),
  timeZone: z.string(),
});
export type TelemetryTargets = z.infer<typeof telemetryTargetsSchema>;

export const telemetryTargetsResultSchema = queryResultSchema(telemetryTargetsSchema);
export const telemetrySourcesResultSchema = queryResultSchema(sourcePageSchema);
export const telemetryRunsResultSchema = queryResultSchema(runPageSchema);
export const telemetryLogsResultSchema = queryResultSchema(queryPageSchema);
export const telemetryHealthResultSchema = queryResultSchema(queryHealthSchema);

export { hostManagementSnapshotSchema } from './observation-contracts.js';
