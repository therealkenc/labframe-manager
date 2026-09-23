# Labframe Manager

Independent host management UI: telemetry queries, live log tailing, service build
identity, and ONLYOFFICE observations. It remains available when Labframe is down.
It owns no Labframe configuration, business logic, or customer storage.

The Windows service name is `LabframeManager`; the product and executable are
`labframe-manager` and `labframe-manager.exe`. This repository owns the application
and its release recipe. Generic runtime helpers come from `@therealkenc/app-runtime`;
packaging and Windows service mechanics come from `@therealkenc/release-tools`.

## Development

Use Node 26 and pnpm 11. Build the peer `app-runtime`, `release-tools`, and
`secrets-api` packages before installing this repository's local file dependencies.

```powershell
pnpm install
pnpm build
pnpm check
pnpm test
pnpm dev --config C:\path\to\manager.json
```

Both development and installed processes require the same explicit `--config`.
There is no Labframe profile resolver. Start from [config/example.json](config/example.json)
and choose absolute paths for telemetry queries and installed secret bags. The
password gate remains mandatory; configuration contains only its secret key name.
Do not put credential values in this repository.

`onlyOffice.documentServerUrl` and `telemetry.collectorOrigin` are Manager's own
settings. Migrating the former in-tree deployment means copying those two settings
from the old referenced application JSON and removing `applicationConfigFile`.
Prepare that candidate configuration with the site deployment plan; the new runtime
does not read the old shape or depend on Labframe being present.

Native Windows ONLYOFFICE inspection can be disabled with
`"onlyOfficeNativeProbe": { "kind": "disabled" }`. Remote health observation remains
available. Telemetry query targets are owned by the telemetry package and are
selected through `queryConfigFile`.

## Releases

`pnpm release` builds a portable Node executable artifact using the shared release
toolkit. Run `pnpm release --help` for the release arguments. Each artifact includes
its matching product hooks under `deploy/ops/manager` and shared installation
mechanics under `deploy/ops/windows-service`. Installation consumes that artifact;
it does not build or pull source.

The immutable artifact contains the UI, password gate resources, native probe,
release manifest, checksummed inventory, and selected runtime dependency payloads.
The public service-info endpoint and `--build-info` identify the running build.
Packaging smoke checks must run away from the checkout before site deployment.

See [ops/manager/README.md](ops/manager/README.md) for installation and upgrade.
Site configurations and release selections belong in the private deployment
repository. The UI and authentication behavior are unchanged by this extraction.

## Verification

Unit tests cover the password gate, telemetry API, status observations, routing,
configuration, process lifecycle, and artifact deployment assets.
`pwsh -NoProfile -File ops/manager/test-upgrade.ps1` exercises upgrade success,
rollback, idempotence and failure paths with isolated fixtures. It does not install,
stop, or start a real Windows service.
