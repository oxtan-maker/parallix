# ADR 0044: Runtime, persistence, UI, and distribution architecture

Status: Accepted; implementation remains gated by this ADR
Date: 2026-07-23
Related: ADR 0041 (integration gates), ADR 0043 (Git target resolution),
ADR 0049 (mutation testing), ADR 0051 (application and UI boundary)

## Context

Parallix is moving from a repository-local CommonJS workflow harness to a
local-first application with:

- a headless automation CLI;
- an Ink terminal UI and later loopback-only web UI;
- a canonical TypeScript domain and application layer;
- SQLite-backed domain and operator state;
- an npm fallback and standalone executables.

The architecture must not create separate workflow engines for each interface,
make pure policy asynchronous, or leave files and SQLite as competing mutable
authorities.

## Decision

Adopt an ESM TypeScript/TSX application with inward-owned domain and
application boundaries, one canonical bundled ESM runtime, SQLite as the
eventual mutable domain authority, UI clients over shared application services,
and platform-specific Node single-executable applications.

The current CommonJS `dist/` runtime and file-backed workflow stores are
compatibility implementations. They remain authoritative only until their
named replacement gates pass.

## Interfaces and dependency direction

The supported automation contract remains:

```text
px <command> [arguments] [flags]
```

Headless commands have deterministic exit codes, support `--json`, and never
initialize React, Ink, cursor control, or interactive input.

Interactive entry points are:

```text
px       # TUI only when stdin and stdout are TTYs
px ui    # explicit TUI
```

Without a command or interactive TTY, `px` prints normal help. The TUI and
future local web board render projections and invoke application use cases.
They do not execute SQL, Git, agents, or workflow policy directly.

Dependencies point inward:

```text
CLI / TUI / local web
          |
          v
application use cases and ports
          |
          v
domain model
          ^
          |
Git, SQLite, filesystem, agent, and subprocess adapters
```

The domain imports no UI, database, filesystem, Git, subprocess, terminal,
package, or build APIs. `src/entry/px.ts` is the only complete composition
root. Headless dispatch loads the TUI only after selecting an interactive
interface.

## Source and runtime

- Authored runtime and test code converges on `.ts` and `.tsx`.
- Source modules use ESM and explicit `.js` relative specifiers.
- `tsc` performs strict no-emit type checking.
- Development and source tests execute through `tsx`.
- The bundler emits the only production JavaScript payload:

```text
build/px.mjs
build/px.mjs.map
build/manifest.json
```

The bundle statically includes first-party runtime code and declared assets,
retains Node built-ins such as `node:sqlite`, produces actionable source maps,
and does not depend on application modules under `node_modules` at runtime.
Clean builds produce a sorted SHA-256 manifest and contain no operator state,
checkout paths, secrets, test fixtures, or behavior-affecting timestamps.

Parallix is a CLI application, not a supported JavaScript SDK. The long-term
package has `"type": "module"`, a `bin` entry for `px`, no root programmatic
export, no `main`, and no published declarations. Removing the current package
entry and raising the Node floor are next-major changes.

The npm fallback supports Node.js 22.23.1 or newer initially. Standalone
executables embed an explicitly pinned Node runtime that supports ESM SEA
`mainFormat: "module"`; currently this requires Node 25/26 rather than Node
22/24. Application code does not depend on SEA APIs.

Initial executable targets are Linux x64/arm64, macOS x64/arm64, and Windows
x64. A platform is supported only after native smoke tests. npm remains a
fallback until a later ADR removes it.

## State and authority

Local-first means the database and workflow services run on the operator's
machine. It does not require mutable domain state to remain encoded as
Git-tracked files.

### Database authority after cutover

After the database migration reaches its explicit cutover, SQLite is the sole
write authority for:

- mission identity, lifecycle, assignment, labels, and closure;
- checkpoints, review conversations, findings, resolutions, and approvals;
- NEL measurements and resumable session metadata;
- agent blocks, usage measurements, known repositories, UI preferences,
  operational history, and migration metadata.

Repository-scoped rows carry stable repository identity. Review is a local
conversation. Forgejo, when enabled in local Docker, is an optional
pull-request projection and never review or mission authority.

Markdown, JSON, CSV, and provider views may be generated from the database for
people, agents, export, or diagnostics. They are read-only projections, not a
steady-state synchronization path.

### Git and filesystem authority

Git and the filesystem remain authoritative only for facts and inputs they
actually own:

- source files, commits, branches, merge ancestry, and worktree presence;
- repository selection and repository-relative paths;
- user-authored `AGENTS.md`, workflow and verification configuration, and
  other repository policy inputs;
- logs, captures, patches, and large artifacts referenced by database records.

Domain transitions may depend on those observations. A mission closes only
after integration exists on the selected base branch and the mission worktree
is absent. SQLite records the resulting transition; it does not replace the Git
or filesystem fact.

Built-in prompts, templates, default schemas, migrations, and command metadata
are immutable executable assets.

### Cutover rule

Until the database adapter passes its migration and recovery gates, existing
files remain compatibility authorities for their current domains.

Cutover switches all reads and writes for a migrated domain as one unit.
Parallix must not retain bidirectional synchronization or independently
writable file copies. Legacy files remain untouched for the bounded rollback
window and may then be archived or removed explicitly. Generated exports remain
rebuildable and visibly non-authoritative.

This database direction is decided. A future implementation mission chooses
schema and migration mechanics within these constraints; it does not reopen
file-backed domain authority as the long-term design.

## SQLite boundary

`node:sqlite` is confined to `src/adapters/sqlite/`. Application-owned
repository ports remain asynchronous even if the adapter initially uses
`DatabaseSync`.

Pure policy remains synchronous. An application service awaits I/O once,
materializes an immutable snapshot, and passes it to synchronous domain
selection or transition code. Agent selection is the proven pattern:
`PreparedAgentSelection.prepare()` crosses the port; `select()` performs no
filesystem, launcher, configuration, or database read.

The database path is:

```text
<PARALLIX_HOME>/parallix.db
```

It is never created in the target repository, mission worktree, executable
directory, or package directory.

Required database rules:

- ordered forward-only migrations with stable IDs and checksums;
- foreign keys, bounded busy timeout, WAL where supported, and transactions
  for multi-statement changes;
- parameterized SQL and code-owned allowlists for dynamic identifiers;
- clean-database, previous-version upgrade, interruption, concurrency, backup,
  restore, and import/export tests;
- transactional, idempotent import that records source path and digest and
  reports malformed records;
- no source-file deletion in the first importing release;
- no secrets or raw agent credentials in SQLite.

Irreversible migrations require a pre-migration backup, tested export/import,
release note, and explicit compatibility boundary.

## Runtime assets

Callers address assets by logical key through `AssetStore`; they do not derive
paths from CWD, module location, package depth, or executable location.
`FilesystemAssetStore` serves source development and `BundledAssetStore` serves
the bundle and executable. A generated manifest includes every runtime asset.
CWD identifies the selected target repository, never Parallix-owned assets or
operator state.

## Verification and release gates

Unit tests remain fast and hermetic. They mock subprocesses, Forgejo, network,
Git boundaries outside the test, and agent launchers.

The migration and release require:

1. strict no-emit type coverage for runtime and tests;
2. source-level domain, application, adapter, CLI, and UI tests;
3. clean and reproducible bundle builds;
4. bundle tests for CLI, assets, SQLite, source maps, and dynamic agents;
5. proof that headless commands do not initialize UI code;
6. database migration, repository-identity, recovery, concurrency,
   import/export, and no-dual-write tests;
7. native smoke tests on every supported executable platform;
8. CLI compatibility tests;
9. locked dependencies, vulnerability/license audits, checksums, SBOM, and
   third-party notices.

Release artifacts contain the executable or canonical npm bundle, build
metadata, source maps as declared, LICENSE, notices, checksums, SBOM, and
installation instructions. They contain no source checkout, tests, secrets,
operator state, or undeclared runtime downloads.

## Migration sequence

1. Establish application/domain boundaries and the canonical ESM bundle.
2. Add SQLite migrations, repository identity, ports, backup/restore, and
   imports without changing authority.
3. Build shared UI-neutral projections and guarded commands.
4. Cut mission, checkpoint, review, NEL, session, statistics, and agent-block
   state over to SQLite in one gated migration.
5. Add the Ink and local web clients over the same application services.
6. Ship the npm bundle and then native executable targets.
7. Remove CommonJS output, legacy state-file writers, and temporary shims after
   their rollback windows close.

No phase removes compatibility before its replacement gates pass. UI work
cannot change authority by implication.

## Consequences

Positive:

- CLI, TUI, and local web clients share one workflow model.
- One mutable database authority removes file/database reconciliation paths.
- Git and filesystem observations retain their real semantics.
- Pure domain policy remains synchronous despite asynchronous persistence.
- npm and executables run the same canonical bundle.

Costs:

- SQLite adds schema, migration, corruption, locking, backup, recovery,
  repository-identity, and portable-export responsibilities.
- ESM, Ink, bundling, SEA, signing, and native platform tests increase release
  work.
- The final package and runtime boundary requires a major release.

## Stop and reassess

Return to this ADR if:

- a single local database cannot provide acceptable recovery, portability, or
  concurrent behavior without restoring dual authority;
- the TUI requires duplicated workflow rules;
- Ink, `node:sqlite`, subprocesses, signals, assets, or source maps cannot run
  reliably in the canonical bundle;
- an ESM-capable pinned SEA runtime cannot pass native tests on a claimed
  platform;
- npm and executables cannot execute the same canonical bundle;
- a supported programmatic package consumer is discovered.

A stop condition requires rewriting this ADR. An implementation mission may not
silently substitute another authority, runtime, or distribution model.

## References

- Node.js, [Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- Node.js, [SQLite](https://nodejs.org/api/sqlite.html)
- Ink, [package and documentation](https://github.com/vadimdemedes/ink)
- TypeScript, [Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference)
