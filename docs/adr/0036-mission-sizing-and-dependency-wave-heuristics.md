# ADR 0036: Mission Sizing and Dependency-Wave Heuristics

**Status:** Accepted
**Date:** 2026-04-05

## Context

As the number of concurrent missions and agents increases, the repository requires a standardized way to:
1. Prevent missions from hitting agent limits (token/usage budgets) midway through implementation.
2. Enable safe parallel work by managing dependencies.
3. Optimize the use of finite token budgets across the mission portfolio.

Previously, all missions followed the same full `MISSION.md` + checkpoint sequence, regardless of size. This created unnecessary ceremony for small fixes and led to "over-budget" failures for large ones.

## Decision

Introduce three sizing tracks and a dependency-wave planning heuristic.

### 1. Sizing Tracks

| Track | Scope | Process | NEL Budget |
|-------|-------|---------|------------|
| **Quick Flow** | < 3 files, < 2h estimated, or docs-only. | Minimal `MISSION.md` (Goal, Why Now, Refinement Signals, Gates). Skip detailed checkpoints if straightforward. | 0–80 NEL (Small) |
| **Full Method** | > 3 files, complex logic, or > 2h. | Standard `MISSION.md` with all sections. Detailed checkpoints. Mandatory external review (C2 review remains required for sensitive scopes per AGENTS.md). | 81–235 NEL (Medium) |
| **Multi-Wave** | Very large, high risk, or complex dependencies. | Split into multiple `Full Method` missions (waves). | 235+ NEL (Large) |

### 2. "Too Large" Thresholds

A mission is "Too Large" for single-wave execution when its predicted NEL bucket exceeds the following thresholds:

- **Small (0–80 NEL)**: suitable for Quick Flow; no decomposition needed.
- **Medium (81–235 NEL)**: suitable for Full Method; consider splitting if dependencies are complex.
- **Large (235+ NEL)**: MUST be split into dependency waves before activation.

These thresholds are derived from empirical terciles in task-1355 data (n=29 missions) as documented in ADR 0047. Missions exceeding these thresholds MUST be split into dependency waves before activation.

### 3. Dependency-Wave Heuristic

When a mission is too large or has complex dependencies, it must be planned in "waves":

- **Wave 1: Foundation**: Infrastructure, core logic, or data models that other parts depend on.
- **Wave 2: Implementation**: Main features or integration logic.
- **Wave 3: Polish & Verification**: Advanced UI, edge cases, and final E2E validation.

**Wave Execution Rules:**
1. **Upfront Sequence**: The full sequence of waves must be defined during the `draft` phase of Wave 1.
2. **Sequential Integration**: Each wave MUST reach `done` status (merged into `master`) before the next dependent wave can transition from `ready` to `active`. Parallel execution of dependent waves is NOT permitted.
3. **Production Readiness**: Per trunk-based development, each wave MUST be production-ready, functional, and safe for production use upon integration into `master`. No "broken" or "partially-functional" states are permitted in the main branch.
4. **Integration Boundary**: Each wave is a separate mission. Upon completion, its branch is merged into `master` via a single squash/merge commit.
5. **Mandatory Review**: Each wave MUST pass its own external review (and C2 review if the scope is sensitive per AGENTS.md) before integration into `master`.
6. **Context Clearing**: Each subsequent wave MUST be executed in a fresh agent session/context. This prevents context bloat and ensures the previous wave's outcomes are documented well enough for a "new" agent to resume work.
7. **Context Carryover**: Each subsequent wave's `MISSION.md` must explicitly reference the completed mission and outcomes of the previous wave in its `## Why Now` or `## Context` section.
8. **Verification Boundary**: Each wave must pass its own validation gates. Wave 3 (or the final wave) must include a full E2E validation of the entire multi-wave feature set.

**Parallelism Rules:**
- Missions can run in parallel ONLY if they do not touch the same files or shared logic.
- If a dependency exists, the dependent mission must wait until the parent mission is `done` (merged to `master`).
- Use the `dependencies` field in `Backlog.md` tasks to track these relationships.

### 4. Mandatory Task Assignment

Agents MUST assign themselves to a task in `Backlog.md` before beginning work in `active` mode. This provides immediate visibility into who is working on what across parallel worktrees.

## Consequences

### Positive
- Reduced ceremony for small, straightforward changes.
- Predictable mission completion within agent limits.
- Clearer path for splitting large work into manageable units.
- Improved visibility of parallel work via mandatory assignment.

### Negative

- Requires upfront estimation effort during the `draft` phase.
- Agents must estimate NEL buckets, which requires understanding the exclusion rules from ADR 0047.

## Links
- [ADR 0032](0032-mission-refinement-state-and-usage-budget-signals.md)
- [ADR 0047: Per-Mission Change Size Budget](0047-per-mission-change-size-budget.md) — NEL bucket definitions and exclusion globs
- [MISSION_FLOW.md](../../MISSION_FLOW.md)
- [AGENTS.md](../../AGENTS.md)
