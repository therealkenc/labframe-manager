# Labframe Manager Windows service

For an existing authenticated Manager installation, use the command shipped
inside the new portable release, from an elevated PowerShell 7 session:

```powershell
pwsh -File C:\Releases\labframe-manager-0.1.0-alpha.1\deploy\ops\manager\upgrade.ps1
```

The command derives the candidate release from its own artifact directory. Its
default state directory is `C:\ProgramData\LabframeManager`; supply `-StateRoot`
for another installation. `-CheckOnly` performs the same read-only preflight.
From a checkout, add `-ReleasePath` pointing at the reviewed portable artifact.

Upgrade verifies the complete candidate and installed inventories, pinned WinSW,
current service identity, health, and authentication gate before stopping anything.
It stages a new release beside the installed one, changes only Manager's service
binary path, starts it, and verifies that the healthy HTTP listener belongs to the
selected executable under the same service account. Configuration bytes, secret
bytes and their ACLs are checked before and after; they are never rewritten.
Existing SCM registration, startup policy and recovery settings remain intact.

`Labframe`, `Welcome` and `Caddy` are the default independent services checked for
unchanged state, process, account and command. Supply `-PreservedServices` if the
host uses other names. The command creates no temporary scripts or configuration.
Durable receipts live in `StateRoot\upgrade-history`; release directories remain
available for inspection. A failed switch automatically restores the prior
authenticated Manager and checks it again. The command still exits nonzero so a
failed upgrade cannot be mistaken for success. Sessions are cleared by the normal
Manager restart. Labframe and its background work continue running.

`install.ps1` registers a new, independently packaged manager with Windows Service
Control Manager. Run it in an elevated PowerShell 7 session after preparing the
portable release and the selected JSON configuration files.

```powershell
pwsh -File ops/manager/install.ps1 `
  -ReleasePath C:\Releases\LabframeManager\reviewed-release `
  -ServiceWrapperPath C:\Tools\WinSW-x64.exe `
  -ConfigurationPath C:\ProgramData\LabframeManager\config.json `
  -InstallRoot 'C:\Program Files\LabframeManager\releases\reviewed-release' `
  -StateRoot C:\ProgramData\LabframeManager
```

The paths above are illustrative. `ReleasePath` must contain `release.json`,
`labframe-manager.exe`, the manager web resources, sign-in resources, and its
native status script.
Every release file must be inventoried with its size
and SHA-256; links, missing/unlisted files, and path traversal are rejected. The
installer checks the copy again before registering the service. The supplied
wrapper must match the tested WinSW hash in the
[shared policy](../windows-service/policy.psd1).

`InstallRoot` must be a new directory below Program Files. `StateRoot` belongs
below ProgramData and may already contain the selected manager configuration.
Existing service registration or release directories fail rather than being
replaced. Existing ProgramData logs and temporary contents are retained; an old
installation receipt is archived under `installation-history` before replacement.
A failed partial install is retained
for inspection; this script does not remove existing files or roll back changes.

The Manager configuration must explicitly supply `onlyOffice.documentServerUrl`,
`telemetry.collectorOrigin`, and the existing query-target JSON file through
`queryConfigFile`. It does not reference or load Labframe's configuration.
It also requires `authentication`, with the selected password bag, reference,
public origin, and session policy:

```json
{
  "authentication": {
    "secretsFile": "C:/ProgramData/LabframeManager/secrets.json",
    "passwordSecret": "management.password",
    "publicOrigin": "https://management.example.com",
    "policy": {
      "sessionLifetimeSeconds": 28800,
      "maximumSessions": 256,
      "attemptWindowMilliseconds": 60000,
      "maximumAttemptsPerWindow": 30,
      "maximumConcurrentAuthentications": 2
    }
  }
}
```

The public origin is the browser's origin, without the management path prefix.
It determines the accepted form origin and whether the session cookie is Secure.
Use the actual HTTPS origin when Caddy terminates TLS. The shared-password session
is independent of Labframe and expires after the configured lifetime; restarting
Manager clears sessions. The sign-in form and minimal health endpoint are public.
The dashboard, observations, and telemetry queries require a session.

Provision the password bag separately using the existing `{ "version": 1,
"values": { ... } }` secret-resource schema. Keep this bag beneath Manager's
StateRoot, outside `logs` and `tmp`, with only its own selected secret. Its password
value belongs in that private bag; configuration and release files contain only
the reference. Do not point Manager at Labframe's full administration bag.

The installer grants read access to the Manager config, query-target config,
and `authentication.secretsFile`. A bag inside StateRoot receives a protected ACL:
Administrators and SYSTEM have FullControl, and `NT SERVICE\LabframeManager` has
Read. References outside StateRoot retain their existing permissions with Manager
Read added. Arrange parent-directory traversal separately without inheriting access
to sibling secret files.

The service runs as `NT SERVICE\LabframeManager`. Administrators and SYSTEM own
the release and manager configuration; the service receives read access. Only
the manager's `logs` and `tmp` directories grant it modification rights. Shared
configuration files retain their other ACL entries. No access is added to the
shared configuration directory or its other contents.

The wrapper launches the release executable directly with:

```text
labframe-manager.exe --config <absolute manager configuration path>
```

Its working directory and TEMP/TMP point into `StateRoot`. Service stdout/stderr
rotate by size. Failure restart delays are 5, 15, then 60 seconds, with the last
delay retained for further failures and the failure count reset after a day.
WinSW allows 30 seconds for graceful stop before forcing termination. The manager
handles Ctrl+C, closes its HTTP listener, and flushes telemetry within that window;
qualify the actual service stop/restart path on the installed host.

The installer registers the `LabframeManager` and `Windows Service Wrapper`
sources in the Windows Application event log before service startup. WinSW uses
the XML service ID for normal service events and the second name for fallback
events. Registration requires administrator rights; the virtual service account
must not create event sources itself. Existing registrations are retained when
they belong to Application; a conflicting log assignment fails installation.
These names follow the pinned wrapper's
[event appender](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/Logging/ServiceEventLogAppender.cs)
and [service initialization](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/WrapperService.cs).

The installer configures automatic startup but leaves the service stopped. Check
the selected configuration and port availability, then start it explicitly.
Verify that anonymous telemetry requests receive 401 and that sign-in and sign-out
work at the configured public origin. Caddy publication is a separate deployment
step. Installation does not change Labframe, ONLYOFFICE, telemetry, SQL, firewall,
certificates, or secret values; it applies access permissions to the selected bag.

The extraction from Labframe changes the configuration schema. Prepare the new
explicit endpoint fields in the site deployment plan before this version starts;
remove `applicationConfigFile`. The upgrade command deliberately preserves
configuration bytes and does not infer values from another application's config.
Configuration replacement and recovery belong to the enclosing site deployment.

In a checkout the product scripts resolve shared mechanics from the installed
`@therealkenc/release-tools` dependency. In a release they use the matching files
shipped next to them under `deploy/ops/windows-service`. No global toolkit or source
checkout is required at installation time.

The shipped wrapper license is from
[WinSW v2.12.0](https://github.com/winsw/winsw/blob/v2.12.0/LICENSE.txt) and lives
with the [shared installer](../windows-service/README.md).
