# parallix Authority Reference

Consolidated parallix workflow authority for the parallix AI mission lifecycle. The executable authority is the `parallix/` code; this file is its canonical markdown companion.

Conflict resolution: `AGENTS.md` wins on hard rules and verification entrypoints; locked `MISSION.md` wins on mission-specific scope and stop rules; `parallix/` runtime code wins over this file.

## 1. Workflow Modes

Mission flow: `backlog → draft → ready → active → review → approved → done`. Blocking review findings loop `review → active → review` on the same branch and PR. One machine, one branch (`mission/<slug>`), one worktree (`../<project>-<slug>`), one implementer. Primary checkout stays on the primary branch (`main` or `master`, detected at runtime) for human integration only.

`AGENTS.md` and the mode's agent-prompt are always in scope. `execute`, `review`, `act-on-review`, and `integrate` also always include locked `MISSION.md` and relevant source files. Expand beyond baseline only on a clear trigger (checkpoint transition, restricted-area entry, failed verification, blocked evidence, review feedback, or material mission-shape change); state what was loaded, why triggered, and why baseline was insufficient.

## Entrypoints

- `parallix/index.js` is the dispatcher for `node parallix <command>`.
- `parallix/px.js` is the `px` binary wrapper and shell-init helper.

## Config Boundary

- `parallix/config/` is tool-owned defaults and launcher policy.
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
| `parallix/README.md` | Workflow modes, lifecycle, context packets, authority model, validation model | Override runtime code or mission-specific scope |
| `missions/<slug>/MISSION.md` | Mission contract, scoped checkpoints, risks, gates, success criteria, stop rules | Override repo-wide hard rules |
| `docs/agent-prompts/*.md` | Mode-specific procedures and entry/exit obligations | Re-teach the full workflow or become a second policy layer |
| `parallix/` code | Executable workflow behavior | Depend on markdown duplication for correctness |

## 3. Agent Selection

Four families: `codex`, `claude`, `mistral`, `qwen`. Step eligibility is in `parallix/config/agents.json`. Launchers are resolved from `PATH` by bare executable name.

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

### 4.3 Review gate

External review by a different agent is mandatory before integration. Valid review: surface exists; reviewer inspects `<primary-branch>..HEAD`; findings cite file references; zero-finding reviews for non-trivial missions include explicit searched-and-found-none evidence.

### 4.4 Integration gate

Complete when: mission reviewed, landing from the correct integration checkout, Backlog state updated, mission branch and worktree cleanup done.

#### 4.4.1 Integration-time pipeline gates (ADR 0041)

`px integrate` runs integration-time gates before the squash-merge lands. These gates are configured via a repo-side config file and invoked per changed top-level area.

- **Config location:** `config/integration-pipelines.json`
- **Schema:** `{"gates": {"<area>": {"command": "<shell-command>", "order": <number>, "run_last": <boolean>}}}`
- **Supported areas:** `server`, `auth-server`, `web-client`, `web-e2e`
- **Ordering:** Gates are executed in ascending `order` value; `run_last: true` ensures the gate runs after all others (regardless of order value)
- **Change detection:** Gates are only invoked for areas with changed files in the mission branch vs the primary branch
- **Opt-out:** `px integrate <slug> --no-integration-gates` skips all integration gates
- **Dry-run:** `px integrate <slug> --dry-run` prints the resolved gate plan without executing

Example config:
```json
{
  "gates": {
    "server": {"command": "./server/updateStaging.sh", "order": 1, "run_last": false},
    "auth-server": {"command": "./auth-server/updateStaging.sh", "order": 2, "run_last": false},
    "web-client": {"command": "SKIP_E2E=1 ./web-client/updateStaging.sh", "order": 3, "run_last": false},
    "web-e2e": {"command": "./web-client/scripts/run-playwright-stage.sh", "order": 4, "run_last": true}
  }
}
```

If the config file is missing or empty, `px integrate` logs `integration-gates: no config present, skipping` and proceeds without error.

## 5. Checkpoint Model

Each completed checkpoint must produce: (1) checkpoint doc under the configured mission base dir for the repo (`missions/<slug>/` in this repo), (2) non-generic `Next action:`, (3) passing relevant gate, (4) commit on `mission/<slug>`. Checkpoint docs make resume and handoff deterministic.

## 6. State Map and Command Aliases

### Virtual vs. actual state names

The workflow uses virtual state names (`backlog | ready | active | review | approved | done`). Each project's `parallix/config/state-map.json` maps virtual names to the actual backlog.md state names used by the board:

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

**Classification:** `<PARALLIX_HOME>/stats.csv` is **parallix-owned cross-repository agent telemetry** — one statistic about how agent families perform across every repo a single parallix runtime drives. It is operator-owned and independent of both the installed package and selected consuming repo, so one runtime working in several repositories accumulates one shared statistic rather than a split per-repo file. The five-column schema (`date,mission,classification,implementer,pr_fix_rounds`) carries no repository identity by design.

## Persistent operator data

`PARALLIX_HOME` overrides the whole persistent-data root. Without it, parallix
uses `~/.local/state/parallix` on Linux,
`~/Library/Application Support/parallix` on macOS, and
`%LOCALAPPDATA%\parallix` on Windows. If the platform-specific base cannot be
resolved, it falls back to `~/.parallix`.

The root contains `stats.csv` and `agents.local.json`. Missing directories and
files are created on first write; read-only paths tolerate absence. The first
default access migrates the repo-root legacy `stats.csv` and the three legacy
blocklist locations without deleting them. Statistics rows are
deduplicated by all five columns. Blocklist precedence remains
runtime-config, repo-root, main-worktree; conflicts are logged with both values
and their sources. Malformed legacy blocklists are reported and skipped, while
a malformed effective file is a hard failure and is never overwritten.

Back up `PARALLIX_HOME` separately. It is not target-repository state and is not
inside, restored by, or removed with the globally installed npm package.

- Default preview: `px stats`
- Freeze the reporting window for reproducible checks: `px stats --today 2026-05-18`
- Preview one inclusive workflow-owned range: `px stats --from 2026-05-01 --to 2026-05-31`
- Be explicit about the source file: `px stats --csv-file stats.csv --today 2026-05-18`
- Write the output to a file for inspection or sharing: `px stats --from 2026-05-01 --to 2026-05-31 --output /tmp/workflow-stats.txt`
- Break one mission down by phase: `px stats task-1285` (or `px stats --mission task-1285`)
- Show command help and examples: `px stats --help`

Behavior:
- Workflow-owned stats datasets (`stats.csv` schema) print the current-week and previous-week mission tables plus the two agent-performance tables.
- With `--from YYYY-MM-DD --to YYYY-MM-DD`, workflow-owned stats datasets instead print one mission table and one agent-performance table for rows whose `date` is within the inclusive range.
- With a mission slug (`px stats task-1285`) or `--mission <slug>`, the command prints one mission broken down by phase — `draft`, `execute` (stored as the `active` stage), and `review` are always shown, plus any `follow-up`/extra recorded stages, with per-phase provider, model, implementer, token, tool-call, and duration columns and a totals row. The output is a pure function of the stored rows, so re-running it does not change the data.

Telemetry capture contract (task-1285):
- Stage rows are keyed by `(mission, stage)`; `draft.js`, `active.js`, and the review loop each record their phase via `recordStageStats`/`recordActiveStats`/`recordReviewStats`.
- Structured sources: Codex (`codex-telemetry.js`, rollout JSONL) and Claude (`claude-telemetry.js`, stdout SSE) populate real token/usage fields.
- `opencode` (local Qwen) exposes no structured usage source, so `opencode-telemetry.js` records honest zeros with provider/model falling back to the agent family — never fabricated numbers.
- `vibe`/`mistral` telemetry is **blocked** in this environment; `mistral-telemetry.js` records honest zeros and the verification is tracked as follow-up task-1288.

---

## Public distribution (canonical packaging and install)

This is the one authoritative public distribution story for parallix. It is the
near-term supported model; the architectural decision behind it is recorded in
ADR 0044 (`docs/adr/0044-workflow-distribution-model.md`).

**Supported acquisition/install path.** parallix is a Node.js toolkit (package
name `@magnus/parallix`) that coordinates AI-assisted software missions through
the lifecycle `backlog → draft → active → review → approved → done`. The
supported artifact is a **local npm tarball built from this repository** — not a
public registry install and not a container image. The package name is scoped so
the unscoped `px` / `parallix` npm names are not relied upon. The shortest
supported path is:

```sh
npm pack ./parallix
```

```sh
npm install -g ./parallix-*.tgz
```

```sh
npm install -g --prefix "$HOME/.local" ./parallix-*.tgz
```

Use the user-writable prefix when you do not have `sudo` access. If your shell
does not already place `$HOME/.local/bin` on `PATH`, add it once.

`CHANGELOG.md` is the versioning authority. Until the first public release,
PATCH bumps are the release discipline: bump before each `px integrate`, then
reinstall from the new tarball after the integrate succeeds. That policy is
documented release practice, not automatic CLI behavior.

**How the operator invokes `px`.** After the global install, `px <command>` is
the installed runner; use `px shell-init` in your shell rc if you want mission
transitions to `cd` your terminal into the next worktree. `px --version`
identifies the executing `px.js` path so an accidental PATH collision with an
unrelated `px` is visible.

**What stays source-compatible for local development.** Running directly from a
checkout is unchanged: `node parallix <command>` (equivalently `node index.js
<command>`) runs from source, requires no install step, and never changes the
caller's shell directory. The tarball install and the source run are the same
code; the tarball only adds a versioned, globally linked `px`.

**What is not yet supported.** The following are explicitly out of the near-term
model and are not claimed to work today: publishing to the public npm registry
(or any other registry), Homebrew, Docker images, standalone single-file
binaries, and CI/release automation or signing. Distribution stays a manual
`npm pack` + global install until a follow-up decision changes that.

The old enterprise walkthrough has been removed. The supported packaging and
install path is the three shell lines above.

## References

- ADR 0044 — Workflow Distribution Model for parallix:
  `docs/adr/0044-workflow-distribution-model.md` (candidate consumption modes,
  Interface Boundary, Enterprise Safety Model).
- Phase 1–4 extraction evidence: `docs/missions/2026/task-1231` … `task-1234`.

## License

Copyright (C) 2026 Magnus Ekdahl.

parallix is free software: you can redistribute it and/or modify it under the
terms of the **GNU Affero General Public License** as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [`LICENSE`](LICENSE) for the full text.

The AGPL covers parallix itself and any modified or network-hosted fork of it.
Running `px` as a tool inside your own repository does **not** make your project
a derivative work — your code remains entirely yours under whatever terms you
choose.
