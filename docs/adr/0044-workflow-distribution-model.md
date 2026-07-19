# ADR 0044: Strategic Runtime, Persistence, Terminal UI, and Distribution Architecture

Status: Accepted; implementation gated by the proofs in this ADR
Date: 2026-07-19
Supersedes: All previous revisions of ADR 0044
Related: ADR 0037 (AI workflow coordination), ADR 0041 (integration pipeline gates), ADR 0042 (CLI color rendering), ADR 0043 (Git target resolution), ADR 0046 (npm publication), ADR 0049 (diff-scoped mutation testing), task-2229 (TypeScript test authoring)

## Context

Parallix began as a repository-local Node.js workflow harness and became a
public npm-distributed CLI. The TypeScript migration accepted on 2026-07-11
then moved the executing runtime from generated JavaScript beside source to a
CommonJS tree under `dist/`. Tasks 2224 through 2228 implemented that plan:

- runtime source is TypeScript in `index.ts`, `px.ts`, and `lib/**/*.ts`;
- `tsc` emits CommonJS JavaScript and source maps under `dist/`;
- package entry points and tests execute `dist/`;
- checked-JavaScript tests have a separate no-emit typecheck project;
- the sibling-JavaScript build and mtime freshness guard are retired;
- assets resolve through `packageRoot()` rather than the current working
  directory or a fixed compiled-module depth.

That architecture is a sound migration waypoint. It is not the intended
product destination.

The accepted product direction now includes three capabilities that change
the optimization:

1. a standalone `px` executable that does not require a separately installed
   Node.js runtime;
2. SQLite-backed operator-local persistence;
3. a React terminal interface rendered with Ink.

Ink is ESM-only. Its current major release requires Node.js 22 or newer.
`node:sqlite` was added in Node.js 22.5 and became available without an
experimental flag in Node.js 22.13. The minimum development and npm fallback
runtime is the version available on the active development computer when this
decision was accepted: Node.js 22.23.1. Node's single-executable application
(SEA) mechanism expects one embedded script and does not perform normal
filesystem module loading from that script.

There is an important runtime split. Node.js 22 and 24 SEA support only a
CommonJS embedded entry. ESM SEA entries are available in Node.js 25 and 26.
Therefore an ESM SEA payload cannot be claimed to run on the same minimum
runtime as the npm fallback. The binary embeds its own explicitly pinned Node
runtime, while the npm fallback has a separate minimum version.

SQLite also changes the state boundary. Parallix currently has several
file-backed surfaces with different authorities:

- Git branches and worktrees;
- mission, checkpoint, review, and NEL documents;
- backlog tasks and repository configuration;
- repository-local resumable-agent markers under `.workflow/sessions/`;
- operator-local agent blocklists and usage statistics under
  `PARALLIX_HOME`;
- shipped prompts, templates, defaults, and configuration.

Introducing a database without an authority model would create conflicting
sources of truth. The database therefore needs a deliberately limited role
and an explicit migration contract.

The terminal UI creates the same boundary problem. Ink must not become the
place where workflow behavior lives. Parallix remains an automation tool as
well as an interactive operator tool. Existing commands, deterministic exit
codes, non-interactive execution, and machine-readable output remain
independent of React rendering.

This revision replaces the previous ADR 0044 text in full. Git history is the
historical record of the earlier distribution and TypeScript decisions.

## Decision

Adopt an ESM TypeScript and TSX application with explicit domain boundaries,
source-level testing, one canonical bundled ESM runtime payload,
SQLite-backed operator-local persistence, an Ink terminal interface, and
platform-specific Node SEA executables.

The existing CommonJS `dist/` runtime is a transitional compatibility
architecture. It remains supported until the replacement bundle, npm, state,
UI, and binary gates in this ADR pass.

The supported automation surface remains the headless `px` command
interface. The terminal UI is another interface over the same application
services, not a replacement for those commands.

```text
TypeScript / TSX source
        |
        |-- tsc typecheck only
        |-- source-level tests
        `-- direct development execution through tsx
        |
        v
canonical ESM bundle
build/px.mjs
        |
        |-- bundle integration tests
        |-- npm fallback package
        `-- SEA input on an ESM-capable pinned Node runtime
        |
        v
platform-specific executables
artifacts/<platform>/px
```

The architecture is defined by the contracts below.

## Product interface contract

Parallix initially has two accepted interfaces over one application core: the
headless CLI and Ink TUI. A local web operator board is a planned third client
over the same core. ADR 0051, created by TASK-2278, defines the interface
boundary shared by all three; this ADR does not permit a web UI to become a
second workflow engine or state authority.

### Headless commands

The existing form remains the stable automation contract:

```text
px <command> [arguments] [flags]
```

Headless commands must:

- run without initializing React, Ink, cursor control, or interactive input;
- have deterministic exit codes;
- support CI and agent subprocesses;
- emit plain text by default;
- expose `--json` for output consumed programmatically;
- never depend on terminal dimensions or TTY state unless a command
  explicitly requests interaction.

Existing scripts and agents must not be required to drive the terminal UI.

### Interactive terminal UI

Ink is the accepted renderer for the interactive interface.

```text
px                       # TUI when stdin and stdout are TTYs
px ui                    # explicitly request the TUI
px <command>             # headless command
px <command> --json      # machine-readable command output
```

With no command and without interactive stdin and stdout, `px` prints normal
help. The TUI may present state, subscribe to operation progress, and invoke
application use cases. It must not contain workflow rules, execute SQL, call
Git or agent subprocesses, or infer domain state independently.

The headless dispatcher must not statically import the TUI. It loads the TUI
entry only after deciding that interactive rendering was requested. React and
Ink imports are confined to the TUI and composition boundary.

## Supported public surface

Parallix is a CLI application, not a JavaScript or TypeScript library.

The long-term package manifest has:

- `"type": "module"`;
- a `bin` entry for `px`;
- no `main` field;
- no root `"."` export;
- no published declarations.

Internal application and domain APIs are repository boundaries, not a public
SDK. Adding a supported SDK requires a separate ADR covering declarations,
compatibility, and release policy.

Removing the current root package entry is a breaking package change even
without an evidenced external consumer. It lands only in the next major
release.

## Source and dependency direction

The target source tree is:

```text
src/
  entry/
    px.ts
  domain/
    missions/
    agents/
    review/
    verification/
  application/
    ports/
    services/
    use-cases/
  adapters/
    agents/
    filesystem/
    git/
    sqlite/
    subprocess/
  interfaces/
    cli/
    tui/
  platform/
    assets/
    paths/
    runtime/

test/
  unit/
  integration/
  tui/
  binary/

assets/
  prompts/
  templates/
  defaults/
  migrations/

build/                  # generated bundle and maps
artifacts/              # generated executables and release archives
```

All authored runtime, test, and build-tool source is `.ts` or `.tsx` in the
end state. Tracked JavaScript is not an architectural source format; it is a
temporary test-migration format or tool-required configuration. Runtime
JavaScript exists only as ignored generated output under `build/` or
`artifacts/`. Source modules use ESM and retain explicit `.js` specifiers for
relative imports:

```ts
import {runMission} from './run-mission.js';
```

CommonJS `require`, `module.exports`, `__filename`, and `__dirname` do not
appear in application source. Necessary CommonJS interoperation is temporary,
isolated, and documented.

Dependency direction is:

```text
CLI / TUI interfaces
        |
        v
application use cases
        |
        v
domain model
        ^
        |
ports implemented by Git, agent, SQLite, filesystem, and asset adapters
```

The domain layer contains mission lifecycle, review, agent eligibility,
verification, value objects, and transition invariants. It imports no React,
Ink, SQLite, filesystem, child-process, terminal, package, or build APIs.

The application layer coordinates use cases through declared ports. Adapters
implement external effects but do not define workflow policy. CLI and TUI
interfaces translate requests and render results.

`src/entry/px.ts` is the composition root. No other module constructs the
complete application graph.

## TypeScript and development contract

`tsc` is the authoritative type checker, not the production JavaScript
emitter. Runtime source and tests use separate compiler projects so UI, Node,
and checked-JavaScript migration concerns do not weaken each other.

The runtime project's accepted end state includes:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedSideEffectImports": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

The test project includes `.ts`, `.tsx`, and transitional checked `.js`
tests. During migration it retains `allowJs`, `checkJs`, and `noEmit`. New
tests are TypeScript or TSX after task-2229 establishes the source runner.
Existing JavaScript tests are converted in bounded later phases; checked
JavaScript is not the long-term test-authoring model. Build and release
scripts likewise move to TypeScript rather than becoming a new tracked
JavaScript source tree.

Additional rules:

- the Node type package is pinned to the minimum npm fallback runtime line;
- strictness may land in reviewable phases, but the flags above are the end
  state;
- path aliases are prohibited unless the checker, source runner, bundler,
  tests, source maps, and mutation scoper resolve them identically;
- source execution uses `tsx`; release execution never does.

`moduleResolution: "Bundler"` is accepted because production execution owns
module processing through the canonical bundler. Explicit `.js` source
specifiers preserve Node-valid syntax and an escape route to unbundled ESM.

## Runtime version policy

The npm fallback and source-development workflow support Node.js 22.23.1 or
newer initially:

```json
{
  "engines": {
    "node": ">=22.23.1"
  }
}
```

This pins the accepted floor to the runtime available on the active
development computer. It is newer than Node 22.13, where `node:sqlite` first
became available without the experimental flag, and satisfies Ink's Node 22
minimum.

The standalone binary embeds a separately pinned Node runtime. An ESM SEA
payload requires a Node release that supports `mainFormat: "module"`;
currently that means Node 25 or 26, not Node 22 or 24. Binary implementation
must not silently fall back to the executing npm Node version.

Each release records the embedded runtime. `px --version` reports:

- Parallix version and source commit;
- embedded or executing Node version;
- platform and architecture;
- executing path;
- database schema version.

## Bundle contract

The canonical production JavaScript artifact is:

```text
build/px.mjs
build/px.mjs.map
build/manifest.json
```

The bundler, not `tsc`, owns JavaScript emission. The exact bundler is an
implementation choice, but selection requires proof of:

- TypeScript and TSX transformation with ESM output;
- Ink and React compatibility;
- preservation of `node:sqlite` and other built-ins;
- correct source maps and deterministic shebang handling;
- static inclusion of first-party modules and runtime dependencies;
- support for dynamic agent selection;
- no runtime dependency on `node_modules` or first-party JavaScript files on
  disk;
- deterministic inclusion of runtime assets.

Build responsibilities remain distinct:

```text
npm run dev             direct source execution
npm run typecheck       no-emit runtime and test typechecks
npm test                source-level unit and application tests
npm run bundle          clean build/ and produce build/px.mjs
npm run test:bundle     test the canonical bundle
npm run build:binary    build the current-platform executable
npm run verify:release  run bundle, binary, migration, and content gates
```

Every production build cleans its owned output directory. Release output must
not contain checkout paths, behavior-affecting timestamps, operator state,
test fixtures, secrets, or undeclared dynamic dependencies.

The build writes a sorted SHA-256 manifest. Two builds from the same source,
lockfile, toolchain, and declared environment must produce the same bundle
manifest. Reproducibility claims apply to the unsigned bundle and, where the
platform permits, the pre-sign binary payload; signing metadata may vary.

## Binary contract

Node SEA is the accepted initial binary mechanism, behind a narrow build
adapter. Application code must not depend on SEA APIs. Node 22.23.1 can prove
the source, bundle, Ink, and SQLite architecture, but it cannot prove the
preferred ESM SEA entry because its SEA implementation accepts only CommonJS.
That binary proof waits for access to an ESM-capable Node 25/26 toolchain; it
does not block accepting or implementing the preceding architecture phases.

The preferred SEA configuration is:

```json
{
  "main": "build/px.mjs",
  "mainFormat": "module",
  "useSnapshot": false,
  "useCodeCache": false
}
```

This configuration is valid only with the pinned binary runtime that supports
ESM SEA. The implementation must fail before artifact creation if the chosen
runtime lacks `mainFormat: "module"` support. A temporary CommonJS SEA wrapper
is not the canonical artifact and requires a dated ADR update if it becomes
more than a proof spike.

SEA remains classified by Node.js as active development. The npm bundle
fallback remains supported until the complete binary matrix is proven.

Initial target candidates are:

```text
linux-x64
linux-arm64
darwin-arm64
darwin-x64
win32-x64
```

A platform is supported only after native execution proof. Cross-produced
output without a native smoke run is insufficient.

Every binary release includes the executable, build metadata, LICENSE,
third-party notices, checksums, an SBOM, installation instructions, and a
platform-appropriate signature or explicit unsigned status. Self-update is
outside this ADR.

## State and authority contract

Parallix retains three authority classes.

### Tool-owned immutable assets

Built-in prompts, templates, default schemas, migrations, and command metadata
are versioned with the executable and immutable at runtime.

### Target-repository state

Git branches and worktrees, missions, checkpoints, review state, NEL records,
backlog tasks, `AGENTS.md`, repository configuration, verification commands,
and artifacts intended to travel with the repository remain rooted in the
explicitly selected target repository.

Existing `.workflow/sessions/<slug>-<role>.json` markers are also
target-repository state because they control resumability for a particular
mission checkout. This ADR does not silently move them to operator-local
SQLite authority.

### Operator-local state

Agent blocklists, usage statistics, known repositories, UI preferences,
cached indexes, local operational history, and database migration metadata
belong under `PARALLIX_HOME` and are eligible for SQLite.

The initial database is authoritative only for explicitly migrated
operator-local domains. It may cache target-repository state, but cache rows
must carry repository identity and freshness data and must be rebuildable. If
SQLite conflicts with Git or repository documents, repository state wins.

Moving any target-repository domain into database authority requires a dated
ADR update covering export, inspection, backup, recovery, concurrent access,
portability, downgrade, and migration semantics.

## SQLite contract

Parallix uses `node:sqlite` behind application-owned asynchronous repository
ports. No module outside `src/adapters/sqlite/` imports `node:sqlite`.

```ts
export interface UsageRepository {
  find(id: UsageId): Promise<UsageRecord | undefined>;
  save(record: UsageRecord): Promise<void>;
}
```

Ports remain asynchronous even when the first adapter uses `DatabaseSync`,
preserving the option to move database work to a worker thread.

The database path is:

```text
<PARALLIX_HOME>/parallix.db
```

`PARALLIX_HOME` keeps its existing explicit override. Without it, the current
platform application-state resolver remains authoritative. The database is
never created in the target repository, a mission worktree, the executable
directory, or the npm package directory.

Schema changes use ordered, forward-only migrations. Each migration has a
stable identifier, immutable content, checksum, transaction boundary,
clean-database test, and upgrade test from the immediately previous supported
schema. A checksum mismatch fails closed.

Irreversible migrations require a pre-migration backup, release note, tested
export/import path, and an explicit compatibility decision.

Every connection enables foreign keys, a bounded busy timeout, WAL where the
filesystem supports it, and explicit transactions for multi-statement state
changes. SQL is parameterized. Dynamic identifiers come only from code-owned
allowlists.

Secrets and raw agent credentials are not stored in SQLite. Credential
storage requires a separate decision covering an OS keychain or equivalent
secret store.

Existing operator-local CSV and JSON data is imported explicitly. An importer
must leave the source untouched, import transactionally, record source path
and digest, be idempotent, report malformed records, and create a backup or
export. No old file is deleted in the release that first imports it.

## Runtime assets

Application callers access assets through logical keys, not paths derived
from `__dirname`, `import.meta`, CWD, the package root, or executable depth.

```ts
export interface AssetStore {
  readText(key: AssetKey): Promise<string>;
  readBytes(key: AssetKey): Promise<Uint8Array>;
  has(key: AssetKey): Promise<boolean>;
}
```

Examples include `prompts/draft.md`, `templates/mission.md`, and
`migrations/0001-initial.sql`. `FilesystemAssetStore` supports source
development; `BundledAssetStore` supports the bundle and executable. A
generated manifest statically includes every runtime asset.

CWD continues to identify the target repository. It never identifies
Parallix-owned assets or operator state.

## Diagnostics and source maps

Source maps are enabled before application modules load. The bundle publishes
a source map; the binary embeds it or ships it as a debugging artifact while
preserving TypeScript filenames and line mappings in diagnostic stacks.

Unhandled errors include a stable category, concise operator message,
optional diagnostic details, executing version and path, and no secret or
prompt-content leakage. Diagnostic mode still redacts tokens, authorization
headers, launcher secrets, and sensitive environment values.

## Test and verification contract

Unit tests must remain fast and hermetic. They mock subprocesses, Forgejo,
network access, Git boundaries that are not under test, and expensive agent
launchers. Source-level tests do not require a production bundle.

The repository uses four layers of proof:

1. source tests for domain rules, use cases, ports, adapters, CLI parsing,
   SQLite migrations, assets, and React components;
2. bundle tests for startup, dispatch, dynamic selection, source maps, assets,
   SQLite, npm execution, and absence of filesystem module dependencies;
3. native binary tests for version/help, a read-only command, database
   creation and transaction, asset access, a temporary Git operation, signals,
   shutdown, and diagnostic mapping;
4. TUI tests for components, view models, keyboard input, resize, non-TTY
   fallback, and PTY end-to-end behavior.

Coverage and diff-scoped mutation testing remain internal quality gates. ADR
0049 receives a dated update when mutation targets move from `dist/` to
TypeScript source or the canonical bundle. Ratchet semantics do not change
implicitly.

| Gate | Required proof |
|---|---|
| V1 — Type boundary | No-emit projects cover runtime source and intended tests. |
| V2 — Source behavior | Unit and application tests pass without a production build. |
| V3 — Clean bundle | A pristine checkout produces `build/` from no prior artifacts. |
| V4 — Deterministic bundle | Two clean builds produce identical path-and-hash manifests. |
| V5 — Bundle runtime | The bundle passes representative CLI, asset, SQLite, and source-map tests. |
| V6 — UI isolation | Headless commands do not import or initialize Ink. |
| V7 — Database migration | Clean, upgrade, interruption, checksum, backup, import, and lock tests pass. |
| V8 — Binary smoke | Every claimed platform runs its own binary suite natively. |
| V9 — Distribution audit | Archives contain only declared runtime and release materials. |
| V10 — Supply chain | Lockfile, vulnerability, license, SBOM, notice, and checksum checks pass. |
| V11 — CLI compatibility | Existing commands, output modes, and exit codes pass. |
| V12 — State boundary | Tests independently resolve repository state, operator state, and assets. |

## Dependency and supply-chain contract

The prior zero-runtime-dependency policy is superseded. React, Ink, and their
transitive dependencies are accepted for the strategic UI capability. They
are bundled into release artifacts rather than installed dynamically on the
operator machine.

The release posture is:

- dependencies locked in `package-lock.json`;
- production inventory, vulnerability, and license audits;
- SBOM and third-party notices for releases;
- no runtime download of JavaScript or UI components;
- no network dependency during normal startup;
- no final-binary post-install script;
- no unbundled native addon without a separate architecture review.

## Distribution contract

Platform-specific binary archives are the long-term primary distribution.
The npm package remains a supported fallback until a future ADR removes it.

```text
parallix-<version>-linux-x64.tar.gz
parallix-<version>-linux-arm64.tar.gz
parallix-<version>-darwin-arm64.tar.gz
parallix-<version>-darwin-x64.tar.gz
parallix-<version>-win32-x64.zip
```

The npm package contains the canonical ESM bundle, source map, package
metadata, LICENSE, README, and third-party notices. It contains no unbundled
application modules, TypeScript source, tests, operator or repository state,
or unrelated platform binaries.

Source checkout execution remains a development path, not the end-user
installation contract.

## Decision matrix

Scores are 1 (weakest) to 5 (strongest). Migration cost is inverse: 5 means
lowest cost.

| Criterion | Weight | A: CJS tree + npm | B: ESM tree + npm | C: ESM bundle + Node SEA | D: Bun executable |
|---|---:|---:|---:|---:|---:|
| Strategic product fit | 4 | 1 | 2 | 5 | 5 |
| Standalone readiness | 4 | 1 | 2 | 5 | 5 |
| Ink / ESM compatibility | 3 | 2 | 5 | 5 | 4 |
| SQLite packaging | 3 | 2 | 2 | 5 | 5 |
| Platform reach | 3 | 5 | 5 | 4 | 3 |
| Migration cost | 2 | 5 | 3 | 2 | 3 |
| Development and debugging | 2 | 4 | 4 | 4 | 4 |
| Low runtime lock-in | 2 | 4 | 4 | 4 | 1 |
| **Weighted total** | | **61** | **74** | **102** | **92** |

Choose C: an ESM bundle with Node SEA. It aligns source, UI, persistence,
npm fallback, and standalone distribution around one Node-compatible payload.
Its binary leg is conditional on an ESM-capable pinned SEA runtime; the npm
fallback does not claim that Node 22 can embed the payload.

## Alternatives considered

### Keep the CommonJS `dist/` tree

This has the lowest immediate migration cost and remains the compatibility
baseline. It conflicts with the accepted Ink dependency, does not match the
single-script binary shape, and would turn a migration waypoint into a
long-term constraint. Rejected as the destination.

### Emit an unbundled ESM tree

This is compatible with Ink and conventional Node ESM, but it still needs a
separate bundle before SEA creation and preserves filesystem module and asset
assumptions not shared by the binary. Rejected as the production artifact.

### Bundle ESM source to a CommonJS SEA payload

This permits Node 22 or 24 SEA but means npm and the binary do not execute the
same canonical artifact. It is permitted only as a time-bounded proof spike.
Adopting it for production requires a dated update with compatibility and
sunset terms.

### Bun compile with `bun:sqlite`

Bun offers a direct executable workflow and built-in SQLite, but changes
runtime semantics across subprocesses, signals, PTYs, Git integrations, and
Node APIs. It also introduces broad runtime lock-in. Rejected initially; the
ports-and-adapters boundaries preserve it as a reassessment option if SEA
fails concrete gates.

### Native-language rewrite

A native rewrite improves executable packaging but abandons the TypeScript
codebase, React/Ink direction, tests, and accumulated behavior. Rejected.

### npm-only distribution

npm remains a useful fallback but requires Node and npm on the operator
machine and does not meet the standalone direction. Rejected as the long-term
primary channel.

## Phased migration

Each phase is reviewable and revertible. The current CommonJS `dist/` runtime
remains available until its replacement gates pass.

| Phase | Depends on | Scope | Required proof | Rollback |
|---|---|---|---|---|
| L1 — Local decision proof spikes (TASK-2277) | TASK-2276 | On Node 22.23.1, prove the Ink bundle, `node:sqlite`, assets, source maps, signals, and subprocesses. Record ESM SEA as deferred. | Narrow prototypes for V5 and V6; explicit deferred V8 evidence. | Discard prototypes; current runtime unchanged. |
| L2 — Application and interface boundaries (TASK-2278) | L1 | Create ADR 0051; extract domain, commands, queries, projections, ports, CLI delegation, and adapter seams without behavior change. Define the future web board as a client, not an authority. | Import-boundary, unit, lifecycle, and CLI compatibility tests. | Revert extraction and ADR 0051. |
| L3 — Source ESM and canonical bundle (TASK-2279) | L2 | Move to `src/`, ESM package mode, source tests, `AssetStore`, and `build/px.mjs`. | V1–V6 and bundle smoke. | Restore CommonJS `dist/` package entry. |
| L4 — SQLite operator state (TASK-2280) | L2, L3 | Add migrations and import eligible `PARALLIX_HOME` CSV/JSON domains. | V7, backup, import, concurrency. | Disable database adapter; original files remain. |
| L5 — Shared operator board model (TASK-2281) | L4 | Build UI-neutral workflow projections, attention ranking, flow metrics, guarded commands, and progress events. | Projection, stale-command, authority, and event-order tests. | Remove board model; CLI use cases remain. |
| L6a — Ink UI (TASK-2282) | L5 | Add `px ui`, then TTY default after UI gates pass. | V6, component, keyboard, resize, PTY tests. | Remove TUI entry; headless commands remain. |
| L6b — Local web board (TASK-2283) | L5 | Implement a loopback-only web client over the same projections and guarded commands. | Browser, reconnect, stale-state, accessibility, and local-control security tests. | Remove web entry; CLI and TUI remain. |
| L7 — Task-authority decision (TASK-2284) | L6b | Decide whether the board remains a projection over Git-tracked task files or becomes an authoring/authority surface through a separate ADR and lossless migration. | Authority inventory, alternative matrix, import/export round trip, rollback. | Keep current task Markdown authoritative. |
| L8 — npm canonical bundle (TASK-2285) | L3, L6a, L6b | Ship `build/px.mjs` as the next-major npm fallback with supply-chain evidence. | Package, install, content, license, SBOM, and compatibility tests. | Restore prior CommonJS npm artifact. |
| L9 — One-platform SEA (TASK-2286) | L4, L6a, L6b, L8, ESM-capable Node toolchain | Build one native executable with a pinned Node 25/26-or-newer runtime that supports ESM SEA. This phase may wait for the main development computer. | Native bundle, database, UI, asset, signal, Git, and diagnostic smoke. | Withdraw binary; npm unaffected. |
| L10 — Platform matrix (TASK-2287) | L9 | Add native builds, signatures, checksums, SBOM, and archives. | V8–V10 per platform. | Withdraw only unsupported targets. |
| L11 — Retire and reconcile (TASK-2288) | L7, L8, L10 | Remove CommonJS `dist/` output and temporary shims; reconcile ADRs 0037, 0042, 0046, and 0049. | Full repository, release, and documentation pipeline. | Revert phase to restore shims. |

Ink and web UI work may proceed in parallel after the shared board model is
stable. No phase removes compatibility before its named replacement gates
pass. TASK-2284 treats eventual replacement of task-file presentation or
authority as a separate decision; a UI mission cannot make that change by
implication.

Task-2229 establishes TypeScript test authoring without waiting for L3. The
current runner already discovers `.test.ts` and conditionally loads `tsx`, but
the task is incomplete until `tsconfig.test.json` includes TypeScript tests
and at least one such test passes both `npm test` and static analysis.
Converting the remaining checked-JavaScript tests is mandatory for the final
architecture, but is split into later review-sized missions rather than added
to task-2229.

## Compatibility and semantic versioning

Accepting this ADR changes no runtime behavior by itself.

- internal source reorganization with unchanged installed behavior is PATCH;
- `px ui` and binary downloads while commands and npm remain are MINOR;
- making no-command TTY execution launch the TUI is MINOR and must be called
  out in release notes;
- raising the npm Node floor from 20 to 22.23.1 is MAJOR;
- removing the root programmatic package entry is MAJOR;
- changing the npm package from CommonJS to ESM is MAJOR for programmatic
  consumers;
- a compatible SQLite import is MINOR only when rollback and export gates
  pass; otherwise it is MAJOR;
- removing the npm fallback requires a future ADR and is MAJOR.

The CLI command contract remains the primary compatibility surface. The final
package-boundary and runtime changes land in the next major release.

## Consequences

### Positive

- The architecture points at the standalone, persistent, interactive product
  rather than extending a temporary CommonJS layout.
- CLI and TUI behavior share application services without coupling automation
  to React.
- SQLite has bounded authority and cannot silently replace Git or mission
  documents.
- Source tests stay fast while bundle and binary tests exercise release
  artifacts.
- Assets work across source, npm bundle, and executable contexts.
- Platform support and supply-chain claims require evidence.
- The package boundary is explicit: Parallix is a CLI, not an undocumented
  library.

### Negative

- The migration is larger than the completed CommonJS-to-`dist/` work.
- React and Ink add a substantial dependency graph.
- ESM changes mocking, dynamic loading, and initialization behavior.
- SEA is active development and ESM SEA currently requires a newer embedded
  runtime than the npm fallback.
- SQLite adds migration, backup, corruption, and concurrency duties.
- Binary and npm channels increase release work.
- Native platform builds, signing, and smoke infrastructure are required.
- The next major release is required for the final runtime and package
  boundary.

## Reconciliation with related decisions

| ADR | Relationship | Reconciliation |
|---|---|---|
| 0037 — AI workflow coordination | Runtime shape superseded | Harness-first coordination remains; raw Node module layout does not. |
| 0041 — Integration gates | Aligned | Gate behavior remains an application use case; bundle and binary gates extend release proof. |
| 0042 — CLI color rendering | Refined | Existing formatting remains for headless output; Ink owns only interactive rendering. |
| 0043 — Git target resolution | Unchanged | CWD and explicit target selection still identify repository state. |
| 0046 — npm publication | Partially superseded | npm remains fallback; zero dependencies and npm-primary distribution do not. |
| 0049 — Mutation testing | Deferred update | Ratchet semantics remain; target mapping changes when source or bundle mutation lands. |

## Stop-and-reassess conditions

Implementation returns to this ADR if:

1. Ink cannot be bundled without runtime filesystem module loading;
2. the pinned ESM-capable SEA runtime cannot reliably execute Ink,
   `node:sqlite`, subprocesses, signals, or Git workflows on a required
   platform;
3. `node:sqlite` changes incompatibly before the adapter is production-ready;
4. observed concurrency cannot be handled without unacceptable locking or
   data-loss risk;
5. binary releases cannot provide acceptable license, SBOM, checksum, and
   signature evidence;
6. source maps cannot produce actionable TypeScript stack traces;
7. binary size, startup, or memory materially harms normal command use;
8. a supported JavaScript library consumer is discovered;
9. the TUI requires duplicated workflow logic;
10. npm and binary execution cannot use the same canonical ESM bundle.

A stop condition requires a dated ADR update. It does not authorize an
implementation mission to silently substitute another runtime or authority
model.

## Completion evidence

This architecture is implemented only when:

1. authored runtime, test, and build-tool source is TypeScript/TSX under the
   accepted boundaries;
2. no tracked runtime JavaScript, checked-JavaScript tests, transitional
   generated siblings, or generated runtime under `dist/` remains;
3. no-emit typechecks cover runtime source and intended tests;
4. source tests run without a production build;
5. one canonical ESM bundle passes integration tests and powers npm;
6. SQLite stores only declared operator-local domains and passes recovery and
   migration tests;
7. Ink uses application services and headless commands remain UI-independent;
8. every documented binary platform passes native smoke tests;
9. archives include checksums, licenses, notices, and SBOM;
10. source-mapped binary errors identify TypeScript locations;
11. existing supported CLI behavior passes compatibility tests;
12. dependent ADRs and authority documentation are reconciled.

## References

Accessed 2026-07-19.

- Node.js, [Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- Node.js 24 LTS, [Single executable applications](https://nodejs.org/download/release/latest-v24.x/docs/api/single-executable-applications.html)
- Node.js 22 LTS, [Single executable applications](https://nodejs.org/download/release/latest-v22.x/docs/api/single-executable-applications.html)
- Node.js, [SQLite](https://nodejs.org/api/sqlite.html)
- Ink, [package and documentation](https://github.com/vadimdemedes/ink)
- TypeScript, [Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference)
- TypeScript, [Choosing compiler options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options)
