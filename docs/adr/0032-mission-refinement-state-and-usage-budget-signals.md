# ADR 0032: Mission Refinement State and Usage-Budget Signals

**Status:** Accepted 
**Date:** 2026-04-03 
**Last updated:** 2026-09-15 

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
- `backlog` was doing too much work as a state; 
- draft stubs, incomplete mission ideas, and genuinely shovel-ready missions were mixed together; 
- the workflow had no explicit state for a mission that was sufficiently refined for execution but had not yet been activated; and 
- mission selection lacked a lightweight, shared way to express whether a mission fit the practical size and review budget of the current workflow. The result was unnecessary ambiguity during pickup decisions. A mission could be well specified in practice while still reading as generic `backlog`, and agents had no canonical way to distinguish work that should be activated as-is from work that should be split or refined further.

## Options Considered

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

## Decision Adopt the following Mission lifecycle: 
- `backlog` 
- `refined` 
- `active` 
- `review` 
- `integration` 
- `done` 

State meanings: 
- `backlog`: queued work that is not yet sufficiently refined for execution; 
- `refined`: the mission has enough execution context and refinement evidence for deliberate activation; 
- `active`: implementation is underway; 
- `review`: the change is in the review workflow; 
- `integration`: implementation and review are complete and the change is in the integration workflow; 
- `done`: integration and closeout are complete. 

External task sources may use different raw status vocabulary. That vocabulary may be preserved for compatibility but does not redefine the Mission lifecycle. A `refined` Mission records: 
- `Predicted NEL bucket`: one of `Small (0–80)`, `Medium (81–235)`, `Large (235+)` per ADR 0047; 
- `Confidence`: `High`, `Medium`, or `Low`; - `Selection note`: `activate as-is`, `split first`, or `defer`, with one short reason; and 
- `Main drivers`: the 2–4 factors driving the estimate. The detailed execution information required to make a Mission genuinely shovel-ready must also exist before activation. ADR 0053 defines persistence and authority for Mission state; this ADR does not require a particular file representation.

`## Refinement Signals` must contain:

- `Predicted NEL bucket`: one of `Small (0–80)`, `Medium (81–235)`, `Large (235+)` per ADR 0047
- `Confidence`: `High`, `Medium`, or `Low`
- `Selection note`: `activate as-is`, `split first`, or `defer`, with one short reason
- `Main drivers`: the 2-4 factors driving the estimate

Interpretation rule for NEL bucket:

- it is an approximate measure of engineering change volume (insertions + deletions, whitespace-ignored) for the mission's merge diff against the primary branch
- it may reflect scope breadth, trust-tier sensitivity, validation burden, review/handoff overhead, context churn, and cross-surface coupling
- it is a selection aid, not a delivery promise or pseudo-scientific schedule estimate
- NEL is computed by the reusable `nels` module (`lib/core/nels.js`) which excludes workflow/bookkeeping files per ADR 0047

Default activation guidance:

- `Small (0–80)`: normally safe to activate as-is when confidence is not low
- `Medium (81–235)`: split first unless the mission is unusually high leverage and already sharply bounded
- `Large (235+)`: defer or split before activation under normal conditions
- if confidence is `Low`, keep refining instead of treating the estimate as reliable enough for pickup

Current rollout blocker:

- the repo config carries `refined`, and first-class `refined` support is now live in the Backlog MCP toolchain.
- this ADR therefore changes the workflow contract immediately, and the live task-state implementation is fully supported.

## Consequences

### Positive

- The workflow now distinguishes "not ready yet" from "ready, but not yet started."
- Mission comparison becomes more deliberate because shovel-ready candidates can be compared without immediately activating them.
- The NEL bucket signal is lightweight enough to aid selection without creating a second planning system.
- Refinement remains part of the Mission execution contract without coupling readiness semantics to a particular persistence or presentation format.

### Negative

- The lifecycle gains one more state conceptually, so operators must learn one more transition.
- NEL bucket estimates still depend on judgment and may drift if agents stop recording the main drivers behind the estimate.


## Links

- [ADR 0026](0026-ai-task-state-and-agent-recovery-surface.md)
- [ADR 0047: Per-Mission Change Size Budget](0047-per-mission-change-size-budget.md) — NEL bucket definitions and exclusion globs
- [Mission](../missions/2026/task-024-mission-complexity-estimation/MISSION.md)
