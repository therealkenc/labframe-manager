import { fileURLToPath } from 'node:url';
import { packageResourceUrl, type PackageResourceLocation } from '@therealkenc/app-runtime/runtime-resources';

const RESOURCE_OWNER = {
  moduleUrl: import.meta.url,
  packageName: 'labframe-manager',
  modulePath: 'dist/resources.js',
} as const;

export const MANAGEMENT_WEB_RESOURCE: PackageResourceLocation = {
  ...RESOURCE_OWNER,
  resourcePath: '../web/',
};

export const MANAGEMENT_ONLYOFFICE_STATUS_RESOURCE: PackageResourceLocation = {
  ...RESOURCE_OWNER,
  resourcePath: '../resources/onlyoffice-status.ps1',
};

export const MANAGEMENT_RESOURCES: PackageResourceLocation = {
  ...RESOURCE_OWNER,
  resourcePath: '../resources/',
};

export const MANAGEMENT_WEB_DIRECTORY = fileURLToPath(packageResourceUrl(MANAGEMENT_WEB_RESOURCE));
export const MANAGEMENT_ONLYOFFICE_STATUS_SCRIPT = fileURLToPath(
  packageResourceUrl(MANAGEMENT_ONLYOFFICE_STATUS_RESOURCE)
);
