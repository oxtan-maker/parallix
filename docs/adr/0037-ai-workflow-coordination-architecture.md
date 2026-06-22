# ADR 0037: AI Workflow Coordination Architecture

Status: Proposed
Date: 2026-04-06

## Context

The repo's AI SDLC has a coordination problem that plays out at two points in every mission:

**At session start:** A fresh agent must reconstruct the current mission state from multiple sources before doing any useful work. This reconstruction fails systematically — enough to have generated dedicated remediation missions (`backlog-sdlc-instructions-fix`, `repair-autonomous-review-launcher`, `fix-codex-crashes`). See `ARCHITECTURE_PROPOSAL.md §1.2` (task-068) for the full failure enumeration.

**At session end or mid-session limit:** An agent hitting a usage limit needs to persist state so the next agent can resume. Currently this relies on checkpoint commits + git log inspection, which agents get wrong under pressure.

The workflow already has scripted coordination for review and integration: `node workflow`, `scripts/autonomous-review.sh`, `scripts/verify-local.sh`, `scripts/cleanup-mission-worktree.sh`. Each replaced a documented procedure that agents were failing to follow. The pattern is established: **code beats documentation for coordination steps**.

This ADR decides which architectural approach should extend that pattern to the remaining coordination gaps (startup, checkpoint persistence, session handoff).

### State layer clarification

The repo already has two layers of mission state that do not need to change:

**Coarse task lifecycle state:** the Backlog task `status` field (`backlog/tasks/<task-id>*.md`, actual values in `backlog/config.yml`). The workflow uses virtual state names (`backlog | ready | active | review | approved | done`) mapped to actual backlog.md values via `workflow/config/state-map.json`. Authoritative task lifecycle per ADR 0026.

**Session handover state:** checkpoint artifact files committed to the mission branch under `docs/missions/2026/<slug>/` (e.g. `CHECKPOINT_3_GSD_COMPARISON.md`). Existing practice for mid-mission handover between agents or sessions.

No new state mechanism is needed. The coordination CLI reads these existing surfaces.

### GSD CLI tools layer (reference architecture)

GSD's `gsd-tools.cjs` is a Node.js CLI with 19 domain modules, handling state, config, phase operations, git commits, and verification. It replaces "repetitive inline bash patterns across ~50 GSD command/workflow/agent files." The architectural separation: agents call the CLI tools; they do not shell out to bash or parse files directly.

The selected option below adapts this pattern to this repo's artifacts (MISSION.md, Backlog, Forgejo) instead of GSD's (.planning/, STATE.md, ROADMAP.md).

## Decision

**Adopt Option C' (Lightweight Node.js Harness, Repo-Adapted).**

### Implementation contract

- **Package:** `workflow/` directory at project root; entry point `workflow/index.js`; invoked as `node workflow <command> [args]`
- **Module structure:** each command in its own module under `workflow/lib/` from the start — no accumulation in a single file
- **Three initial commands:** `mission-start`, `checkpoint`, `status`
- **State inputs:** Backlog task `status` field + existing checkpoint docs in `docs/missions/2026/<slug>/` — no new state store
- **Integrates with:** calls Forgejo API via `workflow/lib/forgejo.js`, `scripts/verify-local.sh`, Backlog MCP
- **New commands:** go in new `workflow/lib/<command>.js` files, not appended to `index.js`
- **Grows only** when a new coordination gap is identified

### Commands

```
node workflow mission-start <slug>
    — verifies directory, branch, reads Backlog task status,
      reads most recent checkpoint doc in docs/missions/2026/<slug>/,
      reads Forgejo PR state, outputs structured PASS/WARN/FAIL report

node workflow checkpoint <slug> <cp-name> "<next-action>"
    — runs verify gate, stages all changes including checkpoint doc the agent
      wrote under docs/missions/2026/<slug>/, commits, pushes

node workflow status [<slug>]
    — reads Backlog task status, most recent checkpoint doc, last 3 commits,
      Forgejo PR state, uncommitted files; outputs human-readable summary
```

### Directory layout (initial)

```
workflow/
  index.js          — CLI entry, command dispatch
  lib/
    mission-start.js
    checkpoint.js
    status.js
    git.js          — shared git helpers
    backlog.js      — Backlog task file reader
    forgejo.js      — the Forgejo API client
```

### Fallback

Option B (bash scripts) if the Node.js investment is deferred. The architectural principle — scripted coordination layer, agents do not follow documented procedures — is the same.

## Decision matrix

| Option | Coord. automation | Agent-agnostic | Adoption cost | Compatibility | State quality | Reversibility | Total |
|---|---|---|---|---|---|---|---|
| A: Extend instructions | 1 | 5 | 5 | 5 | 1 | 5 | 22 |
| B: Bash scripts | 4 | 5 | 4 | 5 | 3 | 5 | 26 |
| C: Full GSD | 5 | 3 | 1 | 3 | 5 | 2 | 19 |
| **C': Lightweight Node.js** | **4** | **5** | **3** | **5** | **5** | **5** | **27** |
| D: BMAD-like | 4 | 5 | 1 | 2 | 5 | 2 | 19 |
| E: Gemini CLI-like | 3 | 3 | 3 | 4 | 3 | 5 | 21 |

Scoring: 5 = strongest fit / 1 = weakest fit. Adoption cost scored inversely (5 = lowest cost).

## Consequences

### Positive

- `node workflow` entry point replaces ad-hoc bash coordination across 50+ agent-followed steps
- No new state store — reads existing Backlog task `status` + checkpoint docs in `docs/missions/2026/<slug>/`
- Multi-file structure from the start prevents single-file accumulation; module boundaries set before complexity arrives
- Extends the proven harness pattern (`node workflow`, `scripts/autonomous-review.sh`, `scripts/verify-local.sh`, `scripts/cleanup-mission-worktree.sh`)
- Node.js handles JSON/YAML parsing, error handling, and testability natively

### Negative

- Node.js knowledge required for `workflow/` maintenance
- `node workflow checkpoint` must be called by agents — behavior change from current manual commit practice
- Module boundary decisions needed as new commands are added

## Alternatives considered

### Option A: Extend Current Instructions

More documentation in AGENTS.md, MISSION_FLOW.md, execute.md.

Positive: near-zero adoption cost, trivially reversible.

Negative: all observed startup failures happen despite existing documentation. Adding more documentation extends the surface that can fail. Ruled out as primary approach.

### Option B: Extend Scripting Support (Bash)

Bash scripts in `scripts/`: `mission-start.sh`, `mission-checkpoint.sh`, `mission-status.sh`.

Positive: proven pattern in this repo, no new dependencies, simple.

Negative: bash quoting and error handling become fragile at scale. JSON/Markdown parsing in bash is error-prone. GSD's experience: gsd-tools.cjs replaced 50+ bash patterns precisely because bash at scale was unmaintainable. Retained as fallback if Node.js investment is deferred.

### Option C: Full GSD-like Architecture

Install `get-shit-done-cc` npm package; adopt full .planning/ file tree, 60+ commands, 21 specialist agents.

Positive: very high coordination automation, excellent state quality.

Negative: very high adoption cost, low compatibility (MISSION.md vs .planning/ authority conflict, low reversibility). Full adoption reopens authority questions without new evidence. The CLI tools layer concept is the one adoptable element — extracted as C'.

### Option D: BMAD-like Architecture

`_bmad/` directory, YAML state machine, 6 agent personas, 34+ workflow files.

Positive: high coordination automation, excellent YAML-typed state.

Negative: very high adoption cost, low compatibility with existing AGENTS.md + MISSION.md. Tier-1 ideas (readiness gate, adversarial review) already adopted via ADR 0033/TASK-055. Full framework disproportionate for a 5-8h/week personal project.

### Option E: Gemini CLI-like Architecture

Per-CLI config files (`~/.gemini/settings.json`, `.gemini/settings.json`) plus MCP server integration.

Positive: correct for per-CLI workspace configuration (already in use).

Negative: per-CLI config is correct for workspace scope, not session handoff. Session state must be git-native (on the mission branch) to be accessible to all agents. Wrong layer for this problem.

## Links

- [ADR 0026](0026-ai-task-state-and-agent-recovery-surface.md) — Backlog as current-state layer
- [ADR 0030](0030-selective-gsd-strategy.md) — Selective GSD strategy
- [ADR 0033](0033-workflow-toolkit-comparative-scan.md) — Toolkit scan (BMAD, Aider)
- [ADR 0034](0034-module-and-skill-invocation-model.md) — Invocation model
- [ARCHITECTURE_PROPOSAL.md](../missions/2026/task-068/ARCHITECTURE_PROPOSAL.md) §6 — Harness-first analysis
- [FOLLOW_UP_MISSIONS.md](../missions/2026/task-068/FOLLOW_UP_MISSIONS.md) — F0 implements this ADR
- GSD architecture: `/tmp/gsd-harness/docs/ARCHITECTURE.md` (cloned 2026-04-06, v1.33.0)
