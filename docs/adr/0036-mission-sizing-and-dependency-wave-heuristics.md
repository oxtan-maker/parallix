# ADR 0036: Mission Sizing and Dependency-Wave Heuristics

**Status:** Accepted 
**Date:** 2026-04-05 
**Last updated:** 2026-09-15

## Context

As the number of concurrent missions and agents increases, the repository requires a standardized way to:
1. Prevent missions from hitting agent limits (token/usage budgets) midway through implementation.
2. Enable safe parallel work by managing dependencies.
3. Optimize the use of finite token budgets across the mission portfolio.

Previously, all missions followed substantially the same coordination depth regardless of size. This created unnecessary ceremony for small fixes and made large missions more likely to exceed practical agent-context, verification, or review limits.

## Options considered 
| Option | Benefit | Cost / Risk | Decision | 
|---|---|---|---| 
| One workflow depth for every mission | Simple model | Over-processes small work and under-controls large work | Reject | 
| Agent usage/token budget as the sizing unit | Directly reflects one agent session | Provider/model specific and not retrospectively measurable | Reject | 
| File-count based sizing | Very cheap | File boundaries are a weak proxy for engineering size and dependency | Reject | 
| NEL-based Quick / Full / Multi-Wave tracks with dependency-wave rules | Portable size signal and explicit decomposition | Requires refinement judgment | **Accept** |

## Decision

Introduce three sizing tracks and a dependency-wave planning heuristic.

### 1. Sizing Tracks

| Track | Scope | Process | NEL Budget |
|-------|-------|---------|------------|
| **Quick Flow** | Small, bounded, low-risk change | Minimal coordination and only the checkpoint/review depth required by the change | 0–80 NEL |
| **Full Method** | Material logic, cross-surface change, or increased validation/review risk | Full execution context, checkpoint evidence, and required external review | 81–235 NEL |
| **Multi-Wave** | Very large, high-risk, or strongly dependent work | Split into multiple independently executable missions | 235+ NEL |

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
1. **Upfront Sequence**: The intended sequence and dependency relationships must be identified during refinement of the first wave.
2. **Sequential Integration**: Each prerequisite wave MUST reach `done` before a dependent wave becomes `active`.
3. **Production Readiness**: Per trunk-based development, each wave MUST be production-ready, functional, and safe for production use upon integration into the configured primary branch. No "broken" or "partially-functional" states are permitted in the main branch.
4. **Integration Boundary**: Each wave is a separate mission. Each wave is a separate Mission and is integrated through the repository's configured integration mode.
5. **Mandatory Review**: Each wave MUST pass its own external review (and C2 review if the scope is sensitive per AGENTS.md) before integration into `master`.
6. **Context Clearing**: Each subsequent wave MUST be executed in a fresh agent session/context. This prevents context bloat and ensures the previous wave's outcomes are documented well enough for a "new" agent to resume work.
7. **Context Carryover**: Each subsequent wave must receive the relevant completed outcomes and decisions from its prerequisite waves as part of its execution context. It must not depend on conversational memory from the previous agent session.
8. **Verification Boundary**: Each wave must pass its own validation gates. Wave 3 (or the final wave) must include a full E2E validation of the entire multi-wave feature set.

**Parallelism Rules:**
- Missions can run in parallel ONLY if they do not touch the same files or shared logic.
- If a dependency exists, the dependent mission must wait until the parent mission is `done` (merged to `master`).
- Dependencies must be represented explicitly enough for Mission selection and activation to enforce them. ADR 0053 defines persistence and authority for that state.

### 4. Mission assignment 

An active Mission has an explicit assignee. Assignment must be visible through the Mission/application model before execution begins so parallel work does not silently acquire multiple owners.

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
