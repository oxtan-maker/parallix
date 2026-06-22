# ADR 0032: Mission Refinement State and Usage-Budget Signals

**Status:** Accepted
**Date:** 2026-04-03
**Supersedes:** ADR 0026 in part (mission lifecycle specifics only)

## Context

ADR 0026 adopted Backlog.md as the repo's current-state and recovery surface and fixed the first mission lifecycle at:

- `backlog`
- `active`
- `review`
- `approved`
- `done`

This ADR is not a duplicate of ADR 0026.

- ADR 0026 decided that Backlog.md is the repo's current-state and recovery surface.
- ADR 0032 decides how mission selection and pre-activation readiness work inside that current-state model.

That rollout solved the "what is current right now?" problem, but later workflow use exposed a selection gap:

- `backlog` was doing too much work as a state
- draft stubs, incomplete mission ideas, and genuinely shovel-ready missions were all mixed together
- the workflow had no explicit place to park a mission that already had a proper `MISSION.md` and passed docs verification, but was not yet chosen for execution
- mission selection still lacked a lightweight, shared way to express whether a mission fit inside the practical AI usage budget of the current workflow

The result was unnecessary ambiguity during pickup decisions. A mission could look well-specified in practice while still reading as generic `backlog`, and agents had no canonical place to record whether the mission should be activated as-is, split first, or deferred because it would likely overrun current AI-session and review budget.

## Decision

Adopt a six-state target mission lifecycle for the workflow:

- `backlog`
- `ready`
- `active`
- `review`
- `approved`
- `done`

State meanings:

- `backlog`: idea stub, queued mission, or incomplete draft; a proper execution-ready mission contract does not yet exist
- `ready`: a proper `MISSION.md` exists, follows the repo mission shape, includes `## Refinement Signals`, and passes `./scripts/verify-local.sh docs`; the mission is shovel-ready and waiting for deliberate pickup (backlog.md actual state: `refined`)
- `active`: execution is underway in the mission worktree
- `review`: external review is underway and the review surface already exists
- `approved`: implementation and review are complete; only human/main-checkout merge follow-through remains (backlog.md actual state: `ready-for-integration`)
- `done`: the mission is integrated or otherwise conclusively closed

Also adopt one explicit place for selection metadata:

- store refinement metadata in `MISSION.md` under `## Refinement Signals`, immediately after `## Why Now`
- do not create custom Backlog task fields for this metadata; Backlog status plus notes/references remain the current-state layer

`## Refinement Signals` must contain:

- `Estimated agent % usage limit`: one of `0-25%`, `25-50%`, `50-75%`, `75-100%`, `100%+`
- `Confidence`: `High`, `Medium`, or `Low`
- `Selection note`: `activate as-is`, `split first`, or `defer`, with one short reason
- `Main drivers`: the 2-4 factors driving the estimate

Interpretation rule for `% usage limit`:

- it is an approximate share of a meaningful AI-assisted execution budget under the current repo workflow
- it may reflect scope breadth, trust-tier sensitivity, validation burden, review/handoff overhead, context churn, and cross-surface coupling
- it is a selection aid, not a delivery promise or pseudo-scientific schedule estimate

Default activation guidance:

- `0-25%` or `25-50%`: normally safe to activate as-is when confidence is not low
- `50-75%`: split first unless the mission is unusually high leverage and already sharply bounded
- `75-100%` or `100%+`: defer or split before activation under normal conditions
- if confidence is `Low`, keep refining instead of treating the estimate as reliable enough for pickup

Current rollout blocker:

- the repo config carries `refined`, and first-class `refined` support is now live in the Backlog MCP toolchain.
- this ADR therefore changes the workflow contract immediately, and the live task-state implementation is fully supported.

## Consequences

### Positive

- The workflow now distinguishes "not ready yet" from "ready, but not yet started."
- Mission comparison becomes more deliberate because shovel-ready candidates can be compared without immediately activating them.
- The `% usage limit` signal is lightweight enough to aid selection without creating a second planning system.
- `MISSION.md` remains the detailed execution contract while Backlog stays the current-state surface.

### Negative

- The lifecycle gains one more state conceptually, so operators must learn one more transition.
- Some older workflow docs and historical artifacts will continue to mention the earlier five-state model.
- `% usage limit` still depends on judgment and may drift if agents stop recording the main drivers behind the estimate.

## Alternatives Considered

### Keep the five-state lifecycle and treat "shovel-ready" as a note inside `backlog`

Positive:

- No lifecycle change.
- No Backlog config update required.

Negative:

- Keeps draft stubs and execution-ready missions mixed together.
- Makes pickup decisions depend on deeper reading and tribal interpretation.

### Add custom metadata directly to Backlog tasks

Positive:

- Puts all selection data on the board surface.

Negative:

- Turns Backlog into a second mission-template system.
- Pushes schema/tooling churn into the current-state layer instead of keeping detailed reasoning in `MISSION.md`.

### Use numeric scoring or story points instead of usage-limit bands

Positive:

- Feels more precise for ranking.

Negative:

- Encourages false precision.
- Creates higher calibration cost than the workflow can realistically sustain.

## Links

- [ADR 0026](0026-ai-task-state-and-agent-recovery-surface.md)
- [Mission](../missions/2026/task-024-mission-complexity-estimation/MISSION.md)
