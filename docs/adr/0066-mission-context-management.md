# ADR 0066: Mission context management

**Status:** Accepted

**Date:** 2026-10-14

## Context

Mission work crosses checkpoints, verification, review rounds and operator
restarts. Frequent prompted compaction can discard investigation details and
adds work even when the provider still has context capacity. Retaining a
conversation also carries old observations and assumptions. Durable Mission
state and review evidence must remain authoritative under either policy.

PX-0008 compared context strategies in a small local research sample, including
historical/replay checkpoint comparisons and a frontier checkpoint pilot.
Reported token differences depend on the selected missions, cached input,
recovery allowances and unresolved outcomes. The sample does not establish
population-level savings or a delivery-reliability advantage for any policy.
No additional experiment or statistical expansion is required for this decision.

The research draft of this ADR proposed retaining unconditional production
compaction during evaluation and fresh checkpoint continuation in TASK-2720.
The subsequent explicit operator decision, implemented by TASK-2737, supersedes
both proposals. Research results remain historical observations.

## Decision

Make Parallix-requested context compaction enabled by default with a validated
repository opt-out. `adapters.prompts.contextCompaction` accepts only booleans:
omission and `true` resolve on; `false` opts out. The repository value takes
precedence over the built-in on default. There is no environment, per-user,
per-agent or per-stage override. The opinion override coexists with this policy
and does not remove core workflow rules.

Apply the policy consistently after recorded checkpoints, after successful
mission-declared gates, before review rounds after the first, and before
act-on-review, including missions without gates. Off prompts retain the
state-reload obligations without requesting compaction. On prompts request
compaction and reload the same authoritative state.

Keep durable checkpoint evidence, locked goals and scope, successful-gate
records, failed-gate diagnostics, unresolved findings, implementer resolutions,
review baselines and authorization rules under both policies. A failed gate
keeps its diagnostic while repair proceeds. Conversation summaries never
replace application-owned Mission or review authority.

Provider-native automatic near-limit compaction remains independently governed
by runtime configuration. This option neither disables those safeguards nor
changes session identity. Completed checkpoints continue in retained
conversations; fresh checkpoint sessions are not adopted. Dedicated diagnostic
repair sessions retain their existing separate recovery contract.

Parallix self-development configuration and shipped templates leave the option
absent and inherit the same default-on behavior as consumers. No repository
identity check or special development override is introduced.

## Alternatives and consequences

Unconditional prompted compaction imposes a context strategy on every mission
without population-level evidence for its benefit. Fresh checkpoint sessions
remove conversation history but add reconstruction and continuity risks; the
operator has not adopted that proposal. Runtime near-limit safeguards respond
to provider window pressure and remain a separate mechanism.

The operator selected default-on compaction after reviewing the research,
superseding the earlier default-off decision in this mission. Operators can opt
out to retain investigation context without prompted early compaction. Neither
setting guarantees provider compliance, token savings or improved reliability.
The continuity contract remains durable workflow state and independent review.
