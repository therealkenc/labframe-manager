import type { HostManagementSnapshot, OnlyOfficeObservation } from './observation-contracts.js';

export type {
  EndpointHealth,
  HostManagementSnapshot,
  ListenerObservation,
  ManagedProcessObservation,
  ManagedServiceObservation,
  ManagedUnitCondition,
  NativeOnlyOfficeObservation,
  OnlyOfficeObservation,
  WindowsOnlyOfficeObservation,
} from './observation-contracts.js';
export interface HostStatusReader {
  readonly read: () => Promise<HostManagementSnapshot>;
}

export interface OnlyOfficeStatusReader {
  readonly read: () => Promise<OnlyOfficeObservation>;
}

export interface ManagementLogger {
  readonly error: (message: string, context: Readonly<object>) => void;
  readonly info: (message: string, context: Readonly<object>) => void;
  readonly warn: (message: string, context: Readonly<object>) => void;
}

export interface FlushableManagementLogger extends ManagementLogger {
  readonly flush: () => Promise<void>;
}
