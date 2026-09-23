import { z } from 'zod';

export const managedUnitConditionSchema = z.enum(['degraded', 'healthy', 'stopped', 'unavailable']);
export const managedProcessObservationSchema = z.object({
  name: z.string(),
  parentProcessId: z.number(),
  processId: z.number(),
  workingSetBytes: z.number(),
});
export const managedServiceObservationSchema = z.object({
  displayName: z.string(),
  name: z.string(),
  processId: z.number(),
  startMode: z.string(),
  state: z.string(),
});
export const listenerObservationSchema = z.object({
  address: z.string(),
  port: z.number(),
  processId: z.number(),
});
export const endpointHealthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('healthy'), url: z.string(), latencyMilliseconds: z.number() }),
  z.object({ kind: z.literal('unhealthy'), url: z.string(), description: z.string() }),
  z.object({ kind: z.literal('unavailable'), description: z.string() }),
]);
export const windowsOnlyOfficeObservationSchema = z.object({
  kind: z.literal('windows'),
  condition: managedUnitConditionSchema,
  installedVersion: z.string(),
  listeners: z.array(listenerObservationSchema).readonly(),
  notes: z.array(z.string()).readonly(),
  processes: z.array(managedProcessObservationSchema).readonly(),
  services: z.array(managedServiceObservationSchema).readonly(),
});
export const nativeOnlyOfficeObservationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('disabled') }),
  windowsOnlyOfficeObservationSchema,
]);
export const onlyOfficeObservationSchema = z.object({
  endpoint: endpointHealthSchema,
  native: nativeOnlyOfficeObservationSchema,
});
export const hostManagementSnapshotSchema = z.object({
  control: z.object({
    condition: z.literal('healthy'),
    processId: z.number(),
    version: z.string(),
  }),
  observedAt: z.string(),
  onlyOffice: onlyOfficeObservationSchema,
});

export type ManagedUnitCondition = z.infer<typeof managedUnitConditionSchema>;
export type ManagedProcessObservation = z.infer<typeof managedProcessObservationSchema>;
export type ManagedServiceObservation = z.infer<typeof managedServiceObservationSchema>;
export type ListenerObservation = z.infer<typeof listenerObservationSchema>;
export type EndpointHealth = z.infer<typeof endpointHealthSchema>;
export type WindowsOnlyOfficeObservation = z.infer<typeof windowsOnlyOfficeObservationSchema>;
export type NativeOnlyOfficeObservation = z.infer<typeof nativeOnlyOfficeObservationSchema>;
export type OnlyOfficeObservation = z.infer<typeof onlyOfficeObservationSchema>;
export type HostManagementSnapshot = z.infer<typeof hostManagementSnapshotSchema>;
