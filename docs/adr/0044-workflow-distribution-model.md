# ADR 0044: Workflow Distribution Model for parallix

Status: Accepted
Date: 2026-06-02
Last updated: 2026-06-22 (task-1331 — public distribution stance locked)

## 2026-06-22 Update: Public distribution stance (task-1331)

parallix was pushed to public GitHub on 2026-06-22. This ADR is moved from
`Proposed` to `Accepted` with one concrete near-term public distribution stance,
so the public repo has a single authoritative answer for contributors and
operators. The original Context/Decision/analysis below is preserved as the
reasoning that produced this stance.

**Accepted near-term model: local npm tarball, globally installed `px` CLI — no
registry publish.** This is Alternative A (external runner / package boundary)
realized as the simplest credible delivery for a freshly public repo:

- The published package name is the scoped `@magnusekdahl/parallix`, resolving the
  `px` namespace risk (this ADR, "`px` Namespace Risk", items 1–4). The unscoped
  `px` / `parallix` npm names are not relied upon.
- Acquisition is `npm pack` from this repo followed by a single global
  `npm install -g <tarball>` (a user-writable `--prefix` is supported for
  no-sudo installs). Reinstall replaces rather than accumulates runtimes.
- `node parallix <command>` (source run) remains the compatibility baseline and
  the local-development path; the tarball install is the same code with a
  versioned global `px`.
- `package.json` reflects this: `"private": false`, `"name": "@magnusekdahl/parallix"`,
  `bin.px`, and a `files` allowlist. The operator-facing install/invoke/source-dev
  story lives in `README.md` ("Public distribution (canonical packaging and
  install)").

**Still deferred (not accepted by this stance):** publishing to the public npm
registry or any registry, standalone single-file binaries, Homebrew, Docker, and
CI/release automation or signing. The enterprise no-source-copied artifact path
(acceptance gate 6) and the per-command logging/dry-run audit (gate 7) remain
open follow-up work; the accepted stance is the manual local-tarball path that is
proven by the existing `px.js` runner, `files` allowlist, and Node test suite,
not those still-open enterprise gates.

## Context

parallix (`workflow/`) is a Node.js CLI that coordinates AI-assisted software missions through the full lifecycle: `draft → active → review → integrate → done`. It lives as raw, uncompiled source in the WrGroceries monorepo at `workflow/` — no bundlers, no transpilation, no publish step. This was chosen deliberately in ADR 0037 to preserve the fastest possible developer iteration: `node workflow <command>` works immediately with zero setup.

Since then, parallix (the workflow tool) has grown beyond WrGroceries use:

1. **WrGroceries inner-loop** (current): `node workflow` runs directly from source in the monorepo root. Zero friction.
2. **EM task repository**: The operator maintains a separate repository for EM-only tasks. Copying `workflow/` there is feasible but creates implicit drift — there is no version boundary, no way to say "which revision am I running?", and no automated way to get updates.
3. **Enterprise locked-down repositories**: The operator wants to demonstrate and test parallix in enterprise repos where committing custom Node.js code is prohibited. Enterprise IT policy does not allow unreviewed source code in product repositories. parallix's current architecture requires the code to live *inside* the target repository to function, which is incompatible with this constraint.
4. **Public publishing**: The operator wants to share parallix publicly. A directory of Node files without a package manifest, CLI entry point, semantic versioning, changelog, or distribution mechanism is not credible as a public tool from an EM facing senior/staff engineers.

The current model optimizes for use case 1 at the expense of 2, 3, and 4. The `workflow/package.json` exists but is marked `"private": true`, has no `bin` field, no exports map, no dependencies beyond one optional devDependency (`sonarqube-scanner`), and one entry point (`index.js`). The `workflow/lib/` directory contains 44 modules across these domains:

- **Command handlers** (one per `node workflow <command>`): `mission-start.js`, `draft.js`, `active.js`, `status.js`, `checkpoint.js`, `review.js`, `handoff.js`, `integrate.js`, `resolve-conflict.js`, `rebase.js`, `diff.js`, `stats.js`, `verification.js`, `coverage-gate.js`
- **Core infrastructure**: `git.js`, `fmt.js`, `spawn-tee.js`, `gatekeeper.js`
- **Agent adapters**: `codex.js`, `claude.js`, `gemini.js`, `glm.js`, `opencode.js`, `mistral.js`
- **State/config**: `state-map.js`, `backlog.js`, `product-config.js`, `forgejo.js`, `agents.js`, `sessions.js`
- **Review subsystem**: `review-state.js`, `review-polling.js`, `review-events.js`, `review-loop.js`, `review-artifacts.js`, `review-commands.js`, `review-prompts.js`
- **Utility**: `mission-utils.js`, `repair-handoff.js`, `limit-hit.js`, `runtime-matrix.js`, `stats-backback.js`

The `workflow/config/` directory holds `state-map.json` (virtual-to-actual state mappings) and `agents.json` (agent family eligibility). The `workflow/data/` directory holds `stats.csv` (mission history). These are all repo-relative paths assumed to exist at fixed locations beneath the `workflow/` directory root.

There is no existing target-repository resolution mechanism that lets parallix operate from outside the host repository. Some modules read and write repo state through paths rooted in the current `workflow/` checkout, while normal JavaScript imports such as `require('./lib/...')` resolve tool code relative to the runtime. Those are different path classes and must not be collapsed into one rule during extraction.

## Decision

**Adopt parallix productization with `px` as the intended short external binary name, while separating the workflow runtime from target-repository state. Do not lock subcommands, flag names, config schema, install location, or enterprise distribution mechanism in this ADR.**

The current `workflow/` directory remains the source of truth until extraction work proves a safer boundary. Future phases must first classify every path the workflow touches as one of:

- **Tool-owned assets**: code, prompts, built-in config, tests, and release metadata that travel with parallix.
- **Target-repository state**: `AGENTS.md`, mission docs, backlog tasks, review events, git branches/worktrees, verification scripts, and any repo-local policy files.
- **Operator-local state**: credentials, agent launcher commands, sessions, caches, and workstation-specific settings.

Only after that classification is proven by tests may implementation work introduce a package boundary or new invocation surface.

### Candidate consumption modes

These modes describe use cases to validate, not an installation contract:

| Mode | Candidate delivery mechanism | Target repo needs workflow source? | Use case | Required proof before adoption |
|------|------------------------------|-----------------------------------|----------|--------------------------------|
| WrGroceries local | Existing `node workflow <cmd>` from source | Existing repo-owned source | Current inner-loop development | Existing behavior remains byte-for-byte or semantically equivalent where output includes expected runtime data |
| Local external runner | A checked-out or locally linked parallix runtime outside the target repo | No copied `workflow/` in target repo | EM repo and cross-repo dogfooding | Commands operate on an explicit target repo without assuming sibling directories or a fixed OS path |
| Package artifact | npm package, tarball, or another Node-compatible artifact | No copied `workflow/` in target repo | Broader reuse and version pinning | Artifact contents, install/run process, and update path are proven in temporary directories |
| Enterprise artifact | To be determined after enterprise constraints are known | No copied workflow source | Locked-down demos | Human-reviewed feasibility note covering allowed runtimes, network policy, source-review expectations, and artifact handling |
| Standalone binary | Future option only | No copied workflow source | Environments without Node/npm | Separate ADR or task after package boundary is stable |

### Interface Boundary

ADR 0044 accepts `px` as the intended short binary name for external distribution because the product is being renamed and prepared for external visibility. It does **not** define the `px` subcommand list, flag names, help text, or repo-selection syntax. The accepted interface requirements are:

1. The existing `node workflow <command>` interface continues to work in WrGroceries during extraction.
2. Any `px` interface beyond the binary name must be proposed by implementation evidence, documented in its own task, and tested against at least one temporary target repo.
3. Target repository selection must be explicit and OS-neutral. It may use CWD, an absolute path, a relative path, or config discovery, but it must not assume sibling worktree names, home-directory layouts, package manager globals, or platform-specific install directories.
4. Existing command behavior is the compatibility baseline. New ergonomics such as `doctor`, `init`, aliases, or dry-run modes are product features, not ADR commitments.

### `px` Namespace Risk

`px` is a good product-aligned short name, but it is not globally unique. Current/historical public uses include:

- `@ae-studio/px`, a JavaScript package-manager command wrapper that installs a `px` binary and advertises invocations such as `px dev` and `px install`.
- PX Systems, a parallel/cloud execution tool centered on a `px` CLI with commands such as `px cluster up` and `px job submit`.
- `@posix/px`, an older npm script-shell package that exposes `px` / `px.cmd`.
- `px`, an older npm package for PC-Axis parsing, which occupies the unscoped npm package name even though it is not primarily a modern CLI.

The practical risk is local PATH collision, not conceptual naming failure. parallix can still use `px` if follow-up packaging work proves:

1. The published package name is scoped, for example `@magnusekdahl/parallix`, rather than relying on the unscoped `px` package name.
2. Install is a single global install (`npm install -g <tarball>`) that replaces on reinstall rather than accumulating runtimes, and is never blind: `px --version` identifies the executing `px.js` path, operators check for a pre-existing `px` on PATH (item 4), and a user-writable prefix (`npm config set prefix`) can control the location. (Resolved by TASK-1236; see `parallix/README.md`.)
3. `px` startup/help output clearly identifies parallix so accidental collisions are obvious.
4. Enterprise and dogfood validation check whether `px` is already present on PATH and document the selected invocation form.

### Configuration and State Boundary

ADR 0044 does **not** define `parallix.config.json`, presets, adapter schemas, or config merge order.

Before a config file is added, follow-up work must produce a configuration inventory that answers:

1. Which current files are tool defaults (`workflow/config/state-map.json`, `workflow/config/agents.json`, prompts, command metadata).
2. Which files are target-repo state (`docs/missions/*`, `backlog/tasks/*`, `review-events/*`, verification scripts, repo instructions).
3. Which values are operator-local and must not be committed (agent commands, tokens, local session paths, caches).
4. Which values truly need repo-local override, with examples from actual WrGroceries and EM usage.

Any eventual config contract must be minimal, evidence-based, and treated as a product API with migration and compatibility tests.

### Package Boundary

The package layout is intentionally unresolved. A future phase may keep the current `workflow/` shape, introduce subpackages, or use another layout, provided it proves:

1. `workflow/index.js` or an equivalent compatibility shim preserves existing `node workflow` behavior.
2. Tool-owned assets resolve relative to the installed/runtime location.
3. Target-repository state resolves relative to the selected target repo.
4. Operator-local state stays outside committed target-repo artifacts.
5. Tests cover path resolution from at least one temporary target repo that is not the parallix source tree.

### Architecture boundary

```
┌─────────────────────────────────────────────────────┐
│  Target Repository                                   │
│  (any git repo: WrGroceries, EM repo, enterprise)   │
│                                                     │
│  optional config       ← only after proven needed    │
│  docs/missions/       ← mission artifacts           │
│  backlog/tasks/       ← backlog tasks               │
│  AGENTS.md            ← repo rules                  │
│  .git/                ← git data                    │
│                                                     │
│  no copied workflow source for enterprise use        │
└──────────────────────┬──────────────────────────────┘
                       │ explicit target-repo selection
                       ▼
┌─────────────────────────────────────────────────────┐
│  parallix runtime                                  │
│                                                     │
│  package, checkout, or other proven artifact        │
│    px — intended external binary                    │
│    lib/ — command implementations                   │
│      draft.js, active.js, review.js, etc.           │
│      git.js, forgejo.js, agents.js                  │
│      codex.js, claude.js, gemini.js, opencode.js    │
│    config/ — tool defaults                          │
│    data/ — tool-owned data, if any                  │
└─────────────────────────────────────────────────────┘
```

## Enterprise Safety Model

parallix is designed for use in enterprise environments where source code hygiene is mandatory:

- **No workflow source copied into enterprise target repos**: Enterprise use requires parallix to run from outside the target product repository. Vendored source may remain a separate non-enterprise distribution mode, but it does not satisfy the enterprise safety model.
- **No assumed install directory or operating system layout**: Enterprise docs must describe inputs and constraints, not hard-coded paths. Validation must use temporary directories and paths supplied at runtime.
- **Artifact claims require proof**: A `.tgz`, npm package, or binary is not assumed enterprise-safe. Each artifact must be inspectable, hashable, and tested for install/run behavior before it is documented as supported.
- **No secrets in repo config**: Credentials, tokens, local agent launcher commands, and session state remain operator-local. If config is later introduced, it must not require secrets in committed files.
- **Dry-run and logging are requirements to evaluate, not assumed existing features**: Enterprise-facing tasks must inventory which commands already support preview behavior and add explicit support only where implementation and tests prove it.
- **Explicit logging boundary required**: parallix's logging must be audited before enterprise use. The required outcome is that logs do not expose git secrets, credentials, local agent command contents, or sensitive prompt material.

## Decision matrix

| Option | WrGroceries loop | EM repo | Enterprise demo | Public credible | Source coupling | Ops cost | Decision |
|--------|-----------------|---------|-----------------|-----------------|-----------------|----------|----------|
| **A: External runner/package boundary** | Fast if compatibility shim stays | Clean if target-state boundary is proven | Possible but unproven until constraints are known | High if versioned and documented | Low — parallix tool and target repos are separate | Medium — packaging, release process, compatibility work | **Accept** |
| B: Copy/export script | Fast (is source) | Feasible but drift | Prohibits — source must be copied in | Low — no version boundary, no install mechanism | High — hidden forks across repos | Low — copy a directory | Reject as primary |
| C: Git submodule/subtree | Fast (is source) | Versioned but inline | Prohibits — source lives in target repo | Low — Git dependency, not a standard package | Medium — submodule ref is versioned code in target | Low-Medium | Accept only for non-enterprise repos that explicitly allow vendored source |
| D: Keep embedded (current) | Fastest (zero setup) | Drift-prone copy required | Prohibits — must commit source | Very low — no package, no CLI, no versioning | Maximum | Zero | Reject — status quo is the problem |
| E: Single binary (packaged) | Slower iteration (rebuild needed) | Clean | Best — no node/npm dependency | High — standalone executable | Low — separated | High — bundling, rebuild cycle, debuggability | Keep as future extension, not primary |

### Alternative analysis

**Alternative A (external runner/package boundary)**: Separate the parallix runtime from target-repo state and make versioning possible. npm packaging may be the eventual delivery path because the current workflow is Node-based and already has `workflow/package.json`. The ADR accepts `px` as the intended external binary name, but does not prescribe subcommands, flags, config schema, tarball installation flow, or filesystem layout. Those details must be proven by follow-up implementation tasks.

**Alternative B (copy/export with `w.sh` script in target)**: The operator currently solves the EM repo use case by copying `workflow/` into a second repository. This works but creates the well-known software distribution problems: no version tracking, no way to update downstream consumers, silent drift when the source repository's workflow changes. The `w.sh` shell wrapper helps with context switching between repos but does not address distribution. This is a pragmatic migration bridge but not the target architecture.

**Alternative C (git submodule)**: A submodule keeps `workflow/` as a versioned external reference. The consuming repo does not own the source but still contains it on disk. This solves versioning for non-enterprise repos that explicitly allow vendored tooling, but it fails the enterprise requirement because workflow source materializes inside the target repository. It also adds Git operational complexity (submodule init/update, fixed commits) that is unnecessary for the primary productization path.

**Alternative D (keep embedded — current model)**: The existing model. Works perfectly for use case 1 and nothing else. The `workflow/` directory is the thing being evaluated — it is the constraint, not the solution.

**Alternative E (standalone binary)**: Tools like `pkg` or `nexe` can produce a single executable. Useful for enterprise demos where the target machine has no Node.js installed. However, packaging adds a build step that breaks the current zero-friction inner loop, and single-executable Node has debugging limitations. This is a good future extension for enterprise air-gapped demos, not the right primary model.

### Why Node package artifacts remain the leading candidate over standalone binary

The distinction between Option A and E in the matrix above is delivery mechanism. Option A first proves a runtime/target-repo boundary for the existing Node workflow. A Node package artifact is the leading candidate after that proof because it fits the current implementation, but this ADR does not accept npm, tarball, or any specific install flow as the final distribution contract. Option E (standalone binary) is retained as a future enterprise extension.

The reason a Node package artifact is preferred over a standalone binary for the **first proof path** is:

1. **Inner-loop speed**: The existing source-run mode preserves the current zero-compilation loop while the boundary is proven. A binary would need rebuilds.
2. **Debuggability**: Source-level debugging of Node modules is well-supported. Standalone binaries obscure stack traces and source maps.
3. **Ecosystem alignment**: The workflow already has `package.json`, depends only on Node builtins, and has no external npm dependencies to vendor. The expected packaging cost is lower than a standalone binary, but the exact package metadata and layout remain follow-up proof work.
4. **Ecosystem familiarity**: npm packages, changelogs, and semantic versioning are standard expectations for public Node tools. A custom binary format has none of those conventions.

## Consequences

### Positive

- **WrGroceries keeps fast inner-loop**: `node workflow <cmd>` remains the compatibility baseline. No rebuild step is required until a later task proves an alternative.
- **EM repo usage can become clean**: No copying once the target-state boundary is proven. The same verified runtime can operate on a selected repo and respect that repo's backlog, missions, and AGENTS.md.
- **Enterprise demos get a credible path**: The design no longer requires copying workflow source into a target repo. Actual artifact acceptability remains to be proven with enterprise constraints.
- **Public publishing becomes credible after proof**: Semantic versioning, changelog, package metadata, and tests are standard expectations for a tool at this scope.
- **Version pinning**: A package or artifact can prove exactly which revision ran and eliminate silent copy drift.
- **Senior/staff credibility**: Versioned tooling with ADRs, changelogs, and test suites is recognized as professional-grade. The "my personal scripts" narrative is replaced by an explicit target-repo boundary backed by evidence.
- **Multi-repo consistency becomes possible**: Once package/artifact distribution is proven, repositories can run the same versioned runtime instead of divergent copies.

### Negative

- **Initial extraction cost**: The 44 modules in `workflow/lib/` must be audited and may need reorganization. Cross-module imports and `__dirname`-relative paths need classification before they can be changed safely.
- **Release discipline required**: Every change to the workflow after extraction needs a version bump (or at least clear development-version tracking). The current model has no such overhead.
- **External-runner setup for WrGroceries**: If a later task introduces workspace linking, a local package, or another external runner, that setup must be documented and tested. It is not assumed by this ADR.
- **Agent adapter coupling**: Each agent adapter (`codex.js`, `claude.js`, `gemini.js`, `glm.js`, `opencode.js`, `mistral.js`) currently resolves commands from environment variables or `agents.json`. Follow-up work must preserve the operator-local command protocol before adding repo-level overrides.
- **Config migration is unproven**: The existing `workflow/config/state-map.json` and `agents.json` may remain tool defaults, become target-repo state, or be split. A new schema is not accepted until a task proves the need.
- **Tests need adaptation**: The 44 lib modules reference each other and `workflow/` filesystem paths. Tests must be restructured to prove both source-tree and external-target execution.

## Alternatives considered

### Keep embedded (current model)

Positive: Zero-friction inner loop. No packaging overhead. Everything works out of the box.
Negative: As documented in Context, creates friction for EM repo (task 2), enterprise demos (task 3), and public publishing (task 4). Each additional repository multiplies the copy-drift problem. The ChatGPT research in the backlog task identified the embedded model as "good for one repo, poor as a reusable EM/developer tool."
Assessment: Retain as the compatibility baseline while the external boundary is proven. Do not require workspace linking until an implementation task demonstrates it is the right local development shape.

### Shell wrapper + env-based config extraction

Positive: No build step, no package boundary, no npm. Wrap `workflow/` with a shell script that sets environment variables for parallix to read, pointing it at a target repo path.
Negative: The workflow's modules use `__dirname` directly (not environment variables). Every module would need refactoring to respect env-based paths. The approach is essentially reimplementing the config/CLI layer that Option A provides as a first-class feature. The environment variable protocol would be undocumented unless treated as a formal spec.
Assessment: A valid interim step for EM repo usage if full extraction takes too long. Any environment-variable or config resolution pattern must be documented as a product API before consumers depend on it.

### Docker container

Positive: Isolates parallix from the target repo's environment. No npm, no Node installation required on the target machine. Container image can include everything.
Negative: Docker is overkill for a pure Node CLI. Container image size, build time, and runtime overhead are not justified by the problem scope. Docker-in-Docker may be blocked in enterprise environments anyway (the same environments where we want parallix).
Assessment: Not worth the cost for this problem domain unless enterprise constraints require it. A tarball may be simpler than Docker, but it is still an artifact containing files that must be reviewed and tested before being called enterprise-safe.

### Git worktree-based distribution

Positive: Leverages existing worktree infrastructure. parallix lives in one worktree, commands run from it targeting sibling worktrees.
Negative: Worktrees are a repository-level mechanism, not a distribution mechanism. They require the workflow source to exist in *some* worktree, which does not solve the enterprise constraint (some enterprise repo may not allow any worktrees, or parallix may need to run against a repo on a machine without write access).
Assessment: parallix already uses worktrees as its mission orchestration mechanism (ADR 0037). This ADR is about how parallix *code itself* reaches target repos, not how it orchestrates them. Worktrees remain an internal implementation detail.

## Acceptance Gates for `Status: Accepted`

ADR 0044 can move from `Proposed` to `Accepted` only after follow-up work proves:

1. A committed path inventory classifies tool-owned assets, target-repository state, and operator-local state across the current `workflow/` runtime.
2. `node workflow <cmd>` remains compatible for WrGroceries after any boundary refactor.
3. A `px` proof slice runs against at least one temporary target repo without relying on fixed OS paths, sibling directory names, package-manager globals, or copied workflow source.
4. The config/state decision is settled: either no repo config is needed yet, or a minimal schema is documented with migration and compatibility tests.
5. The chosen local artifact/dogfood path is tested from caller-supplied temporary paths and its contents exclude operator-local state.
6. Enterprise distribution has a constraints matrix and either a supported no-source-copied artifact path with proof or an explicit defer/no-go decision.
7. Logging and dry-run/preview behavior are inventoried command-by-command before any enterprise safety claim is made.

## Links

- ADR 0037: AI Workflow Coordination Architecture — established the `workflow/` directory as the repo's coordination CLI
- ADR 0041: Integration-time pipeline gates — the `node workflow integrate` command that operates on target repos
- ADR 0042: Workflow CLI Color Rendering Approach — the `fmt.js` module that the new package will reorganize
- ADR 0043: Git target resolution strategy — shows the workflow already has repo-target reasoning, but only for the host repo
- backlog task-1229: Adopt an ADR and create missions for productification of workflow
