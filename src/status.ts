import type {
  HostManagementSnapshot,
  HostStatusReader,
  OnlyOfficeStatusReader,
} from './contracts.js';

export interface HostStatusReaderOptions {
  readonly now: () => Date;
  readonly onlyOffice: OnlyOfficeStatusReader;
  readonly processId: number;
  readonly version: string;
}

export const createHostStatusReader = (options: HostStatusReaderOptions): HostStatusReader => ({
  read: async (): Promise<HostManagementSnapshot> => ({
    control: {
      condition: 'healthy',
      processId: options.processId,
      version: options.version,
    },
    observedAt: options.now().toISOString(),
    onlyOffice: await options.onlyOffice.read(),
  }),
});
