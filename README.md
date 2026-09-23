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
settings. The artifact-owned upgrade copies those two settings from the old
referenced application JSON, preserves existing explicit values and removes
`applicationConfigFile`. It validates the candidate before stopping Manager and
restores the original configuration if the new release fails acceptance. The new
runtime does not read the old shape or depend on Labframe being present.

`node dist/main.js --validate-config <path>` (or the packaged executable with the
same option) validates configuration without opening secrets or starting a listener.

Native Windows ONLYOFFICE inspection can be disabled with
`"onlyOfficeNativeProbe": { "kind": "disabled" }`. Remote health observation remains
available. Telemetry query targets are owned by the telemetry package and are
selected through `queryConfigFile`.

## Releases

`pnpm release` builds a portable Node executable artifact using the shared release
toolkit. For example, with the matching Node 26 Windows runtime and its license:

```powershell
pnpm release --version 0.1.0-alpha.1 `
  --output build/releases/labframe-manager-0.1.0-alpha.1 `
  --node 'C:/Program Files/nodejs/node.exe' `
  --node-license C:/Tools/node-v26.8.2-LICENSE
pnpm test:artifact build/releases/labframe-manager-0.1.0-alpha.1
```

The output directory must be new. A source commit is required for release identity.
Each artifact includes
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

`pnpm test:artifact <release-directory>` copies the artifact under an isolated
`build/deploy` directory, checks its executable build identity from a different
working directory, and starts it on an available loopback port with a generated
test password bag. It verifies health, anonymous API rejection, sign-in, dashboard
and bundled frontend assets, then terminates that test process. Logs stay with the
proof directory. No installed configuration or service is changed.

The initial extraction passed all 72 unit tests, strict checks, the Windows
upgrade/recovery fixtures, and this relocated executable smoke on 2026-09-22.
