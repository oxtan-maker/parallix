# Parallix Authority Reference

Consolidated parallix workflow authority for the parallix AI mission lifecycle. The executable authority is the `parallix/` code (in this repository, the root `index.js`/`px.js` and `lib/`); this file is its canonical markdown companion.

> This document holds the internal operator and authority detail that previously lived in `README.md`. It was moved here during the task-1336 README rewrite so the landing page stays focused while none of the operational detail is lost. The public-facing overview is in [`README.md`](../README.md).

Conflict resolution: `AGENTS.md` wins on hard rules and verification entrypoints; locked `MISSION.md` wins on mission-specific scope and stop rules; runtime code wins over this file.

## 1. Workflow Modes

Mission flow: `backlog → draft → ready → active → review → approved → done`. Blocking review findings loop `review → active → review` on the same branch and PR. One machine, one branch (`mission/<slug>`), one worktree (`../<project>-<slug>`), one implementer. Primary checkout stays on the primary branch (`main` or `master`, detected at runtime) for human integration only.

`AGENTS.md` and the mode's agent-prompt are always in scope. `execute`, `review`, `act-on-review`, and `integrate` also always include locked `MISSION.md` and relevant source files. Expand beyond baseline only on a clear trigger (checkpoint transition, restricted-area entry, failed verification, blocked evidence, review feedback, or material mission-shape change); state what was loaded, why triggered, and why baseline was insufficient.

## Entrypoints

- `src/platform/runtime/index.ts` is the dispatcher (TypeScript source).
- `src/platform/runtime/px.ts` is the `px` binary wrapper and shell-init helper (TypeScript source).
- `build/px.mjs` is the canonical ESM bundle produced by `npm run build`; it is the sole executable artifact and the `bin.px` entry in `package.json`.

## Config Boundary

- `config/` is tool-owned defaults and launcher policy.
- The target repository's `config/` directory is repo state, not parallix code.
- Operator-local overlays live in `.local.json` and `.example` files; they are machine-specific and must not be conflated with repo config.

| Mode | Description | Mode-specific context |
|---|---|---|
| `portfolio` | Brainstorm and filter candidate missions | REALITY_PROBE.md, docs/index.md, docs/adr/index.md, Backlog state, active branches/worktrees, strategic framework |
| `draft` | Build one mission spec in detail | REALITY_PROBE.md, selected mission candidate, relevant ADRs/mission history |
| `execute` | Implement steps for a locked mission | current `git status` |
| `review` | Code quality review | `git diff <primary-branch>..HEAD` |
| `act-on-review` | Resolve live review findings on the current mission branch | live PR comments |
| `area-review` | Review one repo area outside a mission execution flow | REALITY_PROBE.md, focused area source files |
| `integrate` | Land a reviewed mission and complete cleanup | integration checkout state |

## 2. Authority Stack

| Layer | Owns | Must not do |
|---|---|---|
| `AGENTS.md` | Hard rules, restricted actions, verification entrypoints, autonomy boundaries | Re-specify mission-specific scope or phase procedures |
| `docs/authority-reference.md` | Workflow modes, lifecycle, context packets, authority model, validation model | Override runtime code or mission-specific scope |
| `missions/<slug>/MISSION.md` | Mission contract, scoped checkpoints, risks, gates, success criteria, stop rules | Override repo-wide hard rules |
| `docs/agent-prompts/*.md` | Mode-specific procedures and entry/exit obligations | Re-teach the full workflow or become a second policy layer |
| `parallix/` code | Executable workflow behavior | Depend on markdown duplication for correctness |

## 3. Agent Selection

Four families: `codex`, `claude`, `mistral`, `custom`. Step eligibility is in `config/agents.json`. Launchers are resolved from `PATH` by bare executable name.

`WORKFLOW_AGENT=<name>` overrides random selection only when that agent is eligible and unblocked. The effective blocklist is operator-owned at `<PARALLIX_HOME>/agents.local.json`; on first use parallix non-destructively migrates the legacy runtime-config, repo-root, and main-worktree files in that precedence order. Per-agent values: `true` (permanent block), `{ "until": "YYYY-MM-DD HH" }` (timed), `{ "blocked": false }` (unblock).

Usage-limit failures: harness writes a timed block to the local blocklist and retries with the next eligible unblocked agent. All exhausted → fail clearly.

## 4. Validation Model

Validation is layered. One prompt declaring work complete is never sufficient.

### 4.1 Primary gate runner

The primary gate is **configured per repo**, not hardcoded. Declare it under
`adapters.verification` in `workflow.config.json`:

```json
{
  "adapters": {
    "verification": { "command": "./scripts/verify-local.sh {{area}}", "defaultArea": "docs" }
  }
}
```

- **`command`** — the shell command the workflow runs as the primary gate. The `{{area}}` token
  is substituted with the mission's detected area before the command runs. A command with no
  `{{area}}` token runs verbatim for every area.
- **`defaultArea`** — the area used when none can be detected from the mission (defaults to `docs`).
- **No-op default:** when `adapters.verification` is absent, verification is a no-op pass — the
  workflow does not invent a gate for repos that have not declared one.

The area is detected from the gate-runner invocation written in `MISSION.md` (the `Gates` lines).
Detection recognizes any verification script referenced as a `./` or `../`-prefixed path
(e.g. `./scripts/ci.sh <area>`, `../tools/gate.sh <area>`), so it is not tied to the
`./scripts/verify-local.sh` name. The relative-path prefix is required, so a bare filename in
prose is not mistaken for a gate.

Default is `./scripts/verify-local.sh {{area}}` .
Repos **without** `verify-local.sh` declare their own command, for example:

```json
// Make target per area: make verify-docs, make verify-server, ...
{ "adapters": { "verification": { "command": "make verify-{{area}}", "defaultArea": "docs" } } }
```

```json
// npm script forwarding the area as an argument
{ "adapters": { "verification": { "command": "npm run verify -- {{area}}", "defaultArea": "docs" } } }
```

The detected area maps from the changed surface as follows (this table reflects visualBoard's
areas; the area names a repo uses are whatever its configured `command` accepts):

| Changed surface | Gate |
|---|---|
| `docs/`, `*.md` only | `docs` |
| `parallix/` or mixed parallix code | `workflow` or `all` |
| `web-client/` | `web` |
| `server/` | `server` |
| `auth-server/` | `auth` |
| `android/`, `wearos/` | `android` |
| `kubernetes/` | `k8s` |
| Multiple functional areas | `all` |

### 4.2 Mission-specific gates

Each locked mission may add gates (staging validation, manual QA, ADR creation, C2 review). These add to the baseline; they do not replace it.

After each successful mission-declared gate, the executing agent compacts its working context before continuing and reloads the locked mission goal and scope plus committed checkpoint or gate evidence that exists. Failed gates do not trigger that compaction; their diagnostic remains available for repair.

### 4.3 Review gate

External review by a different agent is mandatory before integration. Valid review: surface exists; reviewer inspects `<primary-branch>..HEAD`; findings cite file references; zero-finding reviews for non-trivial missions include explicit searched-and-found-none evidence.

The implementer compacts implementation context before `act-on-review`, even when the mission has no `## Gates` section. Before review round 2 and later rounds, the reviewer compacts prior-round context after any successful rebase and baseline capture, then reloads the mission scope, durable checkpoint/gate evidence, round/disposition, unresolved findings and resolutions, and the rewritten revision/baseline. Repair and recovery relaunches compact first while retaining their exact diagnostic and retry state.

### 4.4 Backlog integrity gate (completed/archive-aware board mutations)

A task that has been integrated and moved to `backlog/completed/` (status `done`)
must not reappear in `backlog/tasks/` with `status: backlog`. Board mutations that
enumerate and rewrite tasks — notably the reorder / ordinal write path that
produces the recurring "Reorder tasks in backlog" commits — can otherwise
regenerate a `backlog/tasks/` copy for a task id whose canonical record now lives
in `completed/` (or `backlog/archive/`), so the board shows shipped work as
un-started and `task_list` surfaces the stale backlog copy (TASK-1343).

Parallix enforces the invariant **"never keep a `backlog/tasks/` file for a task
id that already exists in `backlog/completed/` or `backlog/archive/`"** in two
places, both in `lib/tools/backlog.js`:

- **Guard / gate:** `checkBacklogIntegrity()` emits a `duplicate-completed` issue
  for any task id present in both `backlog/tasks/` and a canonical
  (`completed/` or `archive/`) location. The gate is exercised by
  `test/backlog_gate.test.ts` (fails when a recurrence ships) and by the `px draft`
  preflight (`lib/commands/draft.js`), which refuses to draft while the duplicate
  exists. This is in addition to the existing filename-vs-frontmatter id check.
- **Mutation hygiene:** `pruneStaleBacklogDuplicates()` treats the completed/archive
  copy as canonical and removes the stale `backlog/tasks/` copy, so a board
  mutation does not leave a recreated `status: backlog` duplicate behind.

Regression coverage for the reorder-recreates-completed-task scenario lives in
`test/backlog_reorder_completed_duplicate.test.ts`.

### 4.5 Integration gate

Complete when: mission reviewed, landing from the correct integration checkout, Backlog state updated, mission branch and worktree cleanup done.

#### 4.5.1 Integration-time pipeline gates (ADR 0041)

`px integrate` runs integration-time gates before the squash-merge lands. These gates are configured via a repo-side config file and invoked per changed top-level area.

- **Config location:** `config/integration-pipelines.json`
- **Schema:** `{"gates": {"<area>": {"command": "<shell-command>", "order": <number>, "run_last": <boolean>}}}`
- **Supported areas:** `lib`, `workflow`, `server`, `auth-server`, `web-client`, `web-e2e`, `docs`, `android`, `kubernetes`
- **Ordering:** Gates are executed in ascending `order` value; `run_last: true` ensures the gate runs after all others (regardless of order value)
- **Change detection:** Gates are only invoked for areas with changed files in the mission branch vs the primary branch
- **Opt-out:** `px integrate <slug> --no-integration-gates` skips all integration gates
- **Dry-run:** `px integrate <slug> --dry-run` prints the resolved gate plan without executing

Example config:
```json
{
  "gates": {
    "lib": {"command": "./scripts/verify-local.sh static-analysis", "order": 1, "run_last": false},
    "workflow": {"command": "node --import tsx test/e2e-mission-lifecycle.test.ts", "order": 50, "run_last": true}
  }
}
```

If the config file is missing or empty, `px integrate` logs `integration-gates: no config present, skipping` and proceeds without error.

In this repo, `workflow.config.json` points verification at `./scripts/verify-local.sh {{area}}`. That gives Parallix two validation layers:

- earlier phases such as draft/active/review run the repo's fast general verifier (`all`, currently `npm test`)
- `px integrate` invokes `verify-local.sh integrate`, which resolves the stricter integration gate plan from `config/integration-pipelines.json` after the target tree is exact

#### 4.5.2 Post-integrate hook (generic, repo-configurable)

Any repo may declare one post-integrate command via `adapters.integrate.postIntegrateCommand`
in `workflow.config.json` (schema: `config/workflow.config.schema.json`). It is a generic
extension seam, matching the existing `adapters.verification.command` opt-in pattern.

```json
{ "adapters": { "integrate": { "postIntegrateCommand": "./scripts/my-post-integrate-hook.sh" } } }
```

- **No-op default:** a repo that does not set `postIntegrateCommand` sees no behavior change —
  `px integrate` runs exactly as it does today.
- **When it runs:** at most once per successful, non-dry-run `px integrate` invocation, after
  the local-authority squash-merge path succeeds — after Variant B's squash commit and (if
  configured) Forgejo sync, or after the equivalent resumed-from-existing-squash-commit path.
  It never runs for `--dry-run`, a failed preflight, a failed integration gate, or a failed
  closeout/squash/sync.
- **Where it runs:** from the base checkout (the mission's recorded base worktree, or the primary
  worktree for legacy missions) — never from the mission worktree, which has already been deleted
  by the time the hook runs.
- **Context passed via environment variables:**

  | Variable | Meaning |
  |---|---|
  | `INTEGRATE_HOOK_SLUG` | The mission slug (e.g. `task-1402`) |
  | `INTEGRATE_HOOK_BASE_WORKTREE` | Absolute path to the base checkout the hook runs from |
  | `INTEGRATE_HOOK_BASE_BRANCH` | The branch the mission was integrated into |
  | `INTEGRATE_HOOK_VARIANT` | `variant-b` or `variant-b-resumed` |

- **Failure handling:** a non-zero exit is reported as a distinct post-integrate-hook failure
  (`[FAIL] Post-integrate hook failed (exit code N): <command>`, followed by the hook's captured
  output) instead of a generic merge/gate failure, and suppresses the normal integrate success
  message. Because the hook runs after the integration has already landed locally, a hook failure
  cannot roll back the integration — it surfaces clearly so the operator can rerun or fix the hook
  manually, but the mission itself is already integrated.

**parallix's own hook — keeping the global `px` runner current.** `workflow.config.json` wires
`postIntegrateCommand` to `./scripts/refresh-global-px.sh`. Every successful `px integrate` in
this repo now: bumps the patch version in `package.json`/`package-lock.json`, commits that bump,
builds the canonical `build/` bundle (`build/px.mjs`), packs a tarball whose prepack step also builds `build/`,
and reinstalls the global `px` runner from that tarball (`npm install -g ./<tarball>`) — the same
local-tarball path documented in [Public distribution](#public-distribution-canonical-packaging-and-install)
below. This automates what was previously a manual operator step ("bump before integrate,
reinstall after") and closes the gap where the globally installed `px` drifts behind a source tree
that missions actively modify.

## 5. Checkpoint Model

Each completed checkpoint must produce: (1) checkpoint doc under the configured mission base dir for the repo (`missions/<slug>/` in this repo), (2) non-generic `Next action:`, (3) passing relevant gate, (4) commit on `mission/<slug>`. Checkpoint docs make resume and handoff deterministic.

## 6. State Map and Command Aliases

### Virtual vs. actual state names

The workflow uses virtual state names (`backlog | ready | active | review | approved | done`). Each project's `config/state-map.json` maps virtual names to the actual backlog.md state names used by the board:

```json
{ "ready": "refined", "approved": "ready-for-integration" }
```

Rules:
- When a virtual state has a non-null mapping, the corresponding backlog.md write happens with the actual name.
- When a virtual state maps to `null` or is absent from the map, the workflow step advances but makes no backlog.md write (useful for sparse boards with fewer states).
- States that match in both worlds (e.g. `active`, `review`, `done`) need not appear in the map.

### Command aliases

Command aliases are derived automatically from `state-map.json` — no second config file to maintain. The derivation rules are:

- `ready` and its actual backlog.md name (if any) → `draft`
- `approved` and its actual backlog.md name (if any) → `integrate`
- `done` → `integrate` (always)

With the default state-map above, the effective alias table is:

| alias | canonical |
|-------|-----------|
| `approved` | `integrate` |
| `done` | `integrate` |
| `ready` | `draft` |
| `ready-for-integration` | `integrate` |
| `refined` | `draft` |

When `px <alias>` is invoked, the CLI logs `[INFO] Resolving alias <alias> → <canonical>` and delegates to the canonical command.

View the current alias table: `px aliases`

## 7. Stats Preview

Use `px stats` before integration when you want to validate the weekly tables from committed workflow data, or add `--from` and `--to` to inspect one larger inclusive date range.

**Authority:** the **measurement database** `<PARALLIX_HOME>/parallix.db` is the sole authority for statistics (ADR 0053, TASK-2322.08). It holds checked `AgentRunMeasurement` and `MissionOutcome` data, reached through `MeasurementStorePort` (`src/application/measurement-ports.ts`) and its SQLite adapter (`src/adapters/sqlite/measurement-store.ts`). `stats.csv` is **not** an authority, a fallback, an output target, or an auto-discovered input: no default run resolves, reads, or writes it, and when the database is unavailable the command fails with a database error rather than reading a file.

**Classification:** the measurement database is **parallix-owned cross-repository agent telemetry** — one statistic about how agent families perform across every repo a single parallix runtime drives. It is operator-owned and independent of both the installed package and the selected consuming repo, so one runtime working in several repositories accumulates one shared statistic rather than a split per-repo store. A measurement is identified by `(repo, mission, stage, actor)`; per TASK-2322.02 there is no per-launch (`Attempt`) identity.

**Legacy CSV import:** a historical `stats.csv` may be imported explicitly and read-only:

- Inspect what would be imported (dry run, writes nothing): `px stats import-legacy --csv-file <path>`
- Import it in one atomic transaction: `px stats import-legacy --csv-file <path> --apply`

The apply is idempotent — re-running the same file creates no duplicate records — and the source CSV is never modified. Malformed rows (bad date, missing mission, unknown classification, non-numeric measurement) and ambiguous rows (two rows claiming one identity with different values) are reported with their line numbers, and a file containing any of them is refused whole: no partial import is committed.

## Persistent operator data

`PARALLIX_HOME` overrides the whole persistent-data root. Without it, parallix
uses `~/.local/state/parallix` on Linux,
`~/Library/Application Support/parallix` on macOS, and
`%LOCALAPPDATA%\parallix` on Windows. If the platform-specific base cannot be
resolved, it falls back to `~/.parallix`.

The root contains `parallix.db` and `agents.local.json`. Missing directories and
files are created on first write; read-only paths tolerate absence. The first
default access migrates the three legacy blocklist locations without deleting
them; historical statistics are migrated only by the explicit
`px stats import-legacy` command. Statistics rows are deduplicated by their
`(repo, mission, stage, actor)` identity. Blocklist precedence remains
runtime-config, repo-root, main-worktree; conflicts are logged with both values
and their sources. Malformed legacy blocklists are reported and skipped, while
a malformed effective file is a hard failure and is never overwritten.

Back up `PARALLIX_HOME` separately. It is not target-repository state and is not
inside, restored by, or removed with the globally installed npm package.

- Default preview: `px stats`
- Freeze the reporting window for reproducible checks: `px stats --today 2026-05-18`
- Preview one inclusive workflow-owned range: `px stats --from 2026-05-01 --to 2026-05-31`
- Analyze a legacy CSV read-only instead of the database: `px stats --csv-file legacy-stats.csv --today 2026-05-18`
- Import a legacy CSV into the database: `px stats import-legacy --csv-file legacy-stats.csv --apply`
- Write the output to a file for inspection or sharing: `px stats --from 2026-05-01 --to 2026-05-31 --output /tmp/workflow-stats.txt`
- Break one mission down by phase: `px stats task-1285` (or `px stats --mission task-1285`)
- Show command help and examples: `px stats --help`

Behavior:
- Workflow-owned stats datasets print the current-week and previous-week mission tables, the two agent-performance tables, and — for the current week only — an agent spend-by-stage table (columns `draft`, `execute`, `review`, `follow-up`, `default`, `total`) showing each agent's tracked spend per stage as `<metric> (<share %>)`: Codex/OpenAI rows use usage-percentage snapshots (`openai_usage_after`), Claude and Mistral rows use dollar cost (`cost_usd`), and Custom/local-model rows use clock duration (`duration_minutes`). Rows with no non-zero spend for their metric family show `—` instead of misleading `0%` math.
- With `--from YYYY-MM-DD --to YYYY-MM-DD`, the command instead prints one mission table and one agent-performance table for rows whose `date` is within the inclusive range.
- With a mission slug (`px stats task-1285`) or `--mission <slug>`, the command prints one mission broken down by phase — `draft`, `execute` (stored as the `active` stage), and `review` are always shown, plus any `follow-up`/extra recorded stages, with per-phase provider, model, implementer, token, tool-call, and duration columns and a totals row. The output is a pure function of the stored rows, so re-running it does not change the data.

Telemetry capture contract (task-1285):
- Stage rows are keyed by `(mission, stage)`; `draft.js`, `active.js`, and the review loop each record their phase via `recordStageStats`/`recordActiveStats`/`recordReviewStats`.
- Structured sources: Codex (`codex-telemetry.js`, rollout JSONL) and Claude (`claude-telemetry.js`, stdout SSE) populate real token/usage fields.
- `opencode` (local custom) exposes no structured usage source, so `opencode-telemetry.js` records honest zeros with provider/model falling back to the agent family — never fabricated numbers.
- `vibe`/`mistral` telemetry is **blocked** in this environment; `mistral-telemetry.js` records honest zeros and the verification is tracked as follow-up task-1288.

---

## Public distribution (canonical packaging and install)

This is the one authoritative public distribution story for parallix. It is the
near-term supported model; the architectural decision behind it is recorded in
ADR 0044 (`docs/adr/0044-workflow-distribution-model.md`).

**Supported acquisition/install path.** parallix is a Node.js toolkit (package
name `@magnusekdahl/parallix`) that coordinates AI-assisted software missions through
the lifecycle `backlog → draft → active → review → approved → done`. The
supported artifact is a **local npm tarball built from this repository** — not a
public registry install and not a container image. The package name is scoped so
the unscoped `px` / `parallix` npm names are not relied upon. The shortest
supported path is:

```sh
npm pack
```

```sh
npm install -g ./magnusekdahl-parallix-*.tgz
```

```sh
npm install -g --prefix "$HOME/.local" ./magnusekdahl-parallix-*.tgz
```

Use the user-writable prefix when you do not have `sudo` access. If your shell
does not already place `$HOME/.local/bin` on `PATH`, add it once.

`npm pack` runs the production TypeScript build through `prepack`. The packed
executable is `build/px.mjs`; the tarball contains `build/px.mjs`,
`build/px.mjs.map`, the runtime assets under `build/` (config, prompts, templates),
and the package metadata files listed in ADR 0044 §8. Release
verification runs `npm run test:package-content` to audit the package list and
`npm run test:reproducible-output` to compare two clean-build `build/` artifact
bytes. There is no sibling-JavaScript compatibility build or mtime freshness
guard.

`CHANGELOG.md` is the versioning authority. Until the first public release,
PATCH bumps are the release discipline: bump before each `px integrate`, then
reinstall from the new tarball after the integrate succeeds. That policy is not
built into the `px integrate` CLI itself — it is opt-in per repo via the generic
post-integrate hook (§4.5.2). In this repo it is automated: `workflow.config.json`
wires the hook to `scripts/refresh-global-px.sh`, so every successful
`px integrate` bumps the patch version and reinstalls the global `px` runner
from this checkout without a separate manual step.

**How the operator invokes `px`.** After the global install, `px <command>` is
the installed runner; use `px shell-init` in your shell rc if you want mission
transitions to `cd` your terminal into the next worktree. `px --version`
identifies the executing `px.js` path so an accidental PATH collision with an
unrelated `px` is visible.

**Local development and built runtime.** From a checkout, run `npm run dev --
<command>` to execute `src/platform/runtime/px.ts` directly through `tsx`. For the built runtime,
run `npm run build` followed by `node build/px.mjs <command>`. The tarball
uses the same `build/` bundle and adds a versioned, globally linked `px`.

**What is not yet supported.** The following are explicitly out of the near-term
model and are not claimed to work today: publishing to the public npm registry
(or any other registry), Homebrew, Docker images, standalone single-file
binaries, and CI/release automation or npm provenance (Sigstore). ECDSA registry
signatures are automatic on the public npm registry and require no publisher action.
Distribution stays a manual `npm pack` + global install until a follow-up decision
changes that.

The old enterprise walkthrough has been removed. The supported packaging and
install path is the three shell lines above.

## References

- ADR 0044 — Workflow Distribution Model for parallix:
  `docs/adr/0044-workflow-distribution-model.md` (candidate consumption modes,
  Interface Boundary, Enterprise Safety Model).
- Phase 1–4 extraction evidence: `docs/missions/2026/task-1231` … `task-1234`.
