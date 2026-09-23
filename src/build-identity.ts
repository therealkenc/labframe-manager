import { readBuildIdentity, type BuildIdentity } from '@therealkenc/app-runtime/build-identity';

import { MANAGEMENT_SERVICE_NAME } from './constants.js';

export const MANAGEMENT_BUILD_IDENTITY: BuildIdentity = readBuildIdentity({
  moduleUrl: import.meta.url,
  product: MANAGEMENT_SERVICE_NAME,
});

export const MANAGEMENT_BUILD_VERSION =
  MANAGEMENT_BUILD_IDENTITY.kind === 'release'
    ? MANAGEMENT_BUILD_IDENTITY.version
    : MANAGEMENT_BUILD_IDENTITY.kind;
