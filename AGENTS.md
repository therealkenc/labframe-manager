# Labframe Manager

Ken is an experienced developer. Keep explanations direct and collaborate at that level.

This is an ESM-only TypeScript application. Keep Manager independent of Labframe:
explicit Manager configuration, generic runtime helpers from `app-runtime`, release
mechanics from `release-tools`. Do not import sibling application source files.

Prefer composition, functional helpers, named exports, and typed Result values for
expected failures. No `any`; narrow unknown at untrusted boundaries. Strict TypeScript
and the configured lint rules apply. Avoid broad casts and non-null assertions.
Give policy constants one home. Aim for functions around 40 lines and review module
cohesion around 500 lines; don't fragment coherent algorithms just to count lines.

Every unhappy path records a cause and relevant boundary context through telemetry.
Long-lived tasks belong to an owner; unexpected termination must surface, clean up
within bounds, flush telemetry, and fail nonzero when safe continuation is lost.
Do not print secrets. Authentication is mandatory, including development.

Use pnpm. Keep unit tests in `test/unit`, temporary work in ignored `tmp/`, and release
artifacts under ignored `build/`. Build/check/unit tests are the package gates.
Never modify installed production services unless deployment is explicitly authorized.
Use product upgrade tests and artifact smoke checks without touching installed services.

Preserve immutable publication and release receipts. Do not add compatibility paths
for pre-release configuration shapes; site configuration updates belong to deployment.
