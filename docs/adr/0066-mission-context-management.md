# ADR 0066: Mission context management

**Status:** Accepted; fresh-review exception approved, implementation pending PX-0046

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
The retained research archive and artifact hashes are indexed in
[`tools/session-boundary-evaluation/archive-index.json`](../../tools/session-boundary-evaluation/archive-index.json).
Access to the operator-retained archive is required to inspect the raw evidence.

The completed 20-pair checkpoint comparison used Qwen3.8 Flash Next through
Strata, comparing prompted checkpoint/gate compaction with retained context
without those prompts. Aggregate results, relative to the compact baseline:

| Measure | Compact baseline | Retained unmanaged | Change from baseline |
| --- | ---: | ---: | ---: |
| Tokens, including cache reads | 281,495,530 | 289,614,865 | +2.9% |
| Agent time | 30,243 s | 32,869 s | +8.7% |

All 40 arms reached first-active readiness with passing declared gates; assisted
repairs count toward the totals. Some interrupted time collection provides
lower bounds. Native near-limit compaction was a shared safeguard after an
initial configuration correction; this was neither a fresh-session comparison
nor an isolated test of near-limit compaction. Compact used fewer tokens in
11/20 pairs and less time in 12/20. These observations do not establish a
population mean benefit or independent review quality. Detailed results and
retained attempts are in the research archive
`parallix-research/px-0008/strata-no-context-20/`.

A separate rebase-conflict study completed 24 pairs, including ten additional
pairs rather than the planned 34. Fresh sessions used 73,064,117 tokens versus
100,735,284 for resumed sessions (-27.5%), and 8,018 versus 12,760 agent seconds
(-37.2%), relative to the resumed baseline. Fresh won 20/24 token comparisons
and 17/24 time comparisons. This adaptively expanded, heterogeneous historical
and regenerated cohort is exploratory and has no independent review-quality
comparison; its results do not transfer directly to checkpoint compaction.
In the ten additional pairs, results differed by source context: fresh used
20,461,148 versus 19,922,633 tokens in the two historical-native-context pairs
(+2.7%, one fresh win), but 17,433,014 versus 41,064,737 in the eight regenerated
current-Qwen pairs (-57.5%, eight fresh wins). That reversal and the small
historical stratum limit the pooled saving as evidence for authentic historical
continuation. Evidence is retained in
`parallix-research/px-0008/rebase-context-34-extension/`.

The separate review-repair study completed six matched triplets: all 18 arms
passed controller checks and independent review. Each triplet shared frozen
active code, active prefix, Mission state and initial findings; implementer
context was fresh, deliberately compacted or continued. Historical reviewer
models were pinned, with fresh reviewer conversations in every arm. This
compares implementer repair context, not reviewer context.

| Measure | Fresh | Compact | Continued |
| --- | ---: | ---: | ---: |
| Repair rounds | 28 | 19 | 21 |
| Measured work, minutes | 253.03 | 178.64 | 210.28 |
| Implementer tokens, including compaction/cache | 101,192,508 | 73,194,566 | 90,659,106 |

Compact used 29.4% less aggregate measured time and 27.7% fewer implementer
tokens than fresh. Time includes implementer calls, deliberate compaction,
controller validation and independent review; reviewer tokens and shared or
invalid attempts are accounted separately. Compact won 4/6 time comparisons
against fresh and 3/6 against continued. These selected samples do not establish
statistical superiority or equivalent defect detection. The original TASK-2665
wave lacked the cumulative reviewer diff and was excluded; its corrected replay
and all original attempts remain retained. Assisted retries count toward effort;
fixture limitations and native near-limit compaction can affect treatments.
Completion and accounting are retained in
`parallix-research/px-0008/review-repair-three-arm/` (`final-results.json`,
`20261022-completion-reconciliation.json` and `cost-accounting.json`), with the
consolidated report at `parallix-research/px-0008/context-management-results.md`.

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

Until PX-0046 lands, apply the policy consistently after recorded checkpoints,
after successful mission-declared gates, before review rounds after the first,
and before act-on-review, including missions without gates. Off prompts retain the
state-reload obligations without requesting compaction. On prompts request
compaction and reload the same authoritative state.

PX-0046 will replace review-round compaction with fresh reviewer invocations,
including fallback and relaunches. Reconstruct them from the Mission, revision,
findings and resolutions; native within-review compaction remains allowed.

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
