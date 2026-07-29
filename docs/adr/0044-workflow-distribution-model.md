# ADR 0044: Workflow distribution model

Status: Accepted
Date: 2026-07-23
Related: ADR 0046 (npm publication), ADR 0051 (application and UI boundary)

## Context

Parallix ships through npm and as platform-specific executables. Both forms
must run the same code without turning the package into a supported JavaScript
SDK.

This ADR decides distribution only. ADR 0051 owns application and UI
boundaries. Persistence authority, database contents, schemas, and state
migration are outside this ADR.

## Decision

`build/px.mjs` is the canonical production runtime. It is an ESM bundle built
from TypeScript/TSX source.

The npm package exposes that bundle only through the `px` bin entry. It has no
programmatic root export, `main`, or published declarations.

Native distributions embed the same bundle in a pinned Node single-executable
application (SEA). A platform is supported only after its native smoke test
passes.

Runtime assets are declared, bundled, and recorded in
`build/manifest.json`. Clean builds are reproducible and contain no source
checkout, tests, secrets, operator state, checkout paths, or undeclared runtime
downloads.

Release verification covers the npm bundle and every supported native target,
including CLI behavior, assets, source maps, checksums, SBOM, licenses, and
third-party notices.

## Consequences

- npm and native executables share one production runtime.
- Parallix has no supported JavaScript library surface.
- Native platform support carries build, signing, and smoke-test costs.

## Stop and reassess

Revisit this decision if Ink, `node:sqlite`, subprocesses, signals, assets, or
source maps cannot run reliably in the canonical bundle; if npm and native
executables cannot run that same bundle; or if a supported programmatic package
consumer is discovered.

An implementation mission may not silently substitute another runtime or
distribution model.

## References

- Node.js, [Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- TypeScript, [Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference)
