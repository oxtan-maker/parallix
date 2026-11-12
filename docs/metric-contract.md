# Statistics metric contract

This contract defines every production statistic shown by the board FLOW surface or `px stats`. It keeps lifecycle facts separate from agent telemetry so missing measurements never look like delivery results.

## Shared rules

| Rule | Contract |
|---|---|
| Repository identity | `RepositoryId` is resolved from the primary Git worktree. A mission worktree uses that same identity. Every statistics read scopes by this key before it groups or aggregates; rows without it are rejected and counted as partial, never included. |
| Lifecycle authority | `board_lane_events` is authoritative for mission existence in flow history, transitions, delivery completion, lifecycle cycle time, dwell, WIP, lane age, throughput, and review bounces. `usage_statistics` supplies only execution measurements and cohort runtime dimensions. |
| Completion | `completedAt` is the first `integration → done` event. A later `done → done` `close` event is `closedAt` administration: it may bound final-state dwell but cannot alter delivery completion, its week, or lifecycle cycle time. |
| Time | Full timestamps are parsed as instants, preserving their UTC or explicit offset meaning. Reporting calendar days use the local timezone of the machine running Parallix; date-only measurements retain their recorded calendar date. A historical projection includes only events and outcomes at or before its requested instant. |
| Weekly decision window | FLOW compares missions delivered in the current rolling seven calendar days (`today-6` through `today`, inclusive) with the preceding non-overlapping seven days. Membership is determined by delivery completion, then each selected mission contributes its complete lifecycle and measured agent data. |
| Missing data | `null` means unavailable; a numeric `0` means an observed zero. A missing applicable observation on newly measured work is an integrity diagnostic that names the affected mission and source; it is not a successful unknown result. A configured workflow that was explicitly skipped is inapplicable; no eligible population, running, interrupted and pre-instrumentation work retain their own states instead of becoming measured zeroes. FLOW observation is complete only when every applicable source is complete; elapsed-time coverage alone cannot establish it. Partial data records its rejected/missing-identity count and every derived figure reports the number of observations used or a numerator/denominator coverage. Explicit pre-instrumentation imports remain marked legacy/estimated. |
| Shared calculation | Board FLOW, normal `px stats`, and `px stats cohorts` use application projections. CLI and presentation adapters format or fetch; they do not redefine identity, completion, windows, or aggregation, and synchronous reads do not contact model providers. |

## Metric catalogue

| Statistic | Question and source | Aggregation, timestamp/window, coverage, class |
|---|---|---|
| Flow / WIP by lane | How many missions occupied each lane? Source: lifecycle initial-entry and transition events. | Replay initial entry and transitions through the observation instant; do not seed history from today’s state. Counts are measured only with complete history, otherwise unavailable/legacy fallback. Class: lifecycle. |
| Lifecycle cycle time | How long did delivered work take end-to-end? Source: first lifecycle entry and first `integration → done`. | `completedAt - lifecycleStartAt`, one value per delivered mission; never sum agent duration. Median reports its own `n`. Class: lifecycle. |
| Lane dwell | Where did delivered work wait? Source: successive lifecycle events. | Attribute each interval to the state occupied before the next event. Sum closed intervals per mission per lane before taking the median; coverage counts missions with closed dwell in that lane. Open intervals are excluded. Class: lifecycle. |
| Current lane age / bottleneck | Which non-terminal lane is waiting longest now? Source: latest lifecycle event plus injected projection clock. | `asOf - enteredCurrentLaneAt`; `done` and `integration` never select the bottleneck. Per-lane median reports its own `n`. Class: lifecycle. |
| Throughput / weekly throughput | How many missions were delivered over time? Source: first `integration → done` lifecycle event. | Count delivered missions by completion week; FLOW compares the current and preceding non-overlapping seven-day windows. Class: lifecycle. |
| Review bounce rate | How often did reviewed missions return to active? Source: lifecycle events. | `review → active` bounce events divided by missions that entered review; repeated bounces count as events and denominator is missions. `pr_fix_rounds` is a separate review-fix metric. Class: lifecycle. |
| Avg reimplementation rounds / mission | On average, how often was a model's delivered work sent back for reimplementation? Source: reconciled Review decisions, human corrections, approval revocations, lifecycle returns to active and gate repairs that never moved a lane (pre-review and pre-approval gates). | Count each distinct return once whatever its cause or sending stage (gate, reviewer, human, integration, infrastructure, pushback, unknown); duplicate publications and provider/local copies are one return, repeated cycles are separate, and initial implementation, no-return failures and approval-only re-reviews count zero. A model's figure is its returns divided by the completed missions it was attributed in (finisher or author of returned work) that have return evidence, so models are comparable. A trailing `+` marks a lower bound when a return could belong to the model but cannot be attributed. Missions without return evidence are left out of the average and named as `(k/m measured)` instead, because their returns could be any number; a model with none measured shows unavailable. Class: review measurement. |
| FLOW lifecycle shape / first-pass yield / extra launches | What path did delivered missions take, how many avoided a return or conflict before first delivery, and how many additional agents actually launched? Source: durable workflow operations, rebase/gate/activity history, Review history and retained run identities. | Count distinct observed node and edge identities for missions delivered in the decision window. Sibling percentages use one observed outcome population and total 100%; gate-return arrows retain every typed return so they reconcile to rework. Reused proofs are not gate executions. Rebase stages retain ordered no-op, clean, conflict, resolved and failed outcomes with operation/source provenance; conflict alone is not terminal. Later claims or stops of the same durable workflow operation do not erase earlier rebase evidence, and non-terminal evidence from a superseded activation is interrupted rather than running. Applicable missing evidence is a FLOW diagnostic, while running, interrupted, explicitly inapplicable and pre-instrumentation stages remain distinct from measured zero. First pass is disqualified by an observed implementation return, conflict or recovery before first delivery. Rework and launch summaries report their measured population, and retained launch caps produce lower bounds. Extra launches are actual launches after the first, never inferred return obligations. Class: lifecycle. |
| Agent and human send-backs | How often did each reviewing actor send implementation back? Source: durable Review decisions, explicit operator corrections/revocations and deduplicated workflow returns. | The numerator is distinct actor-provenanced returns; the denominator is distinct eligible episodes for the same actor and stage. Agent rounds never stand in for human episodes. An explicit operator revocation supplies a zero-duration observed human decision boundary when no earlier human-review start was recorded; this measures an episode, not hands-on time. Duplicate provider/local publications count once. No eligible episodes is shown as inapplicable only when the numerator is also zero; missing applicable provenance is an integrity defect. Class: review measurement. |
| Exclusive elapsed ownership | Where did refined-to-first-delivery elapsed time go? Source: durable queue, handoff, run, gate, rebase, review, lead and terminal boundaries with causal dependencies. | Partition observed elapsed time into non-overlapping step/actor/model rows; working gates/rebases/internals are Parallix work, admission is waiting, and an explicit human handoff is held elapsed time without a CPU claim. Dependency depth resolves nested overlap deterministically. Each step row averages every mission with any ownership observation, and lane shares use observed work only; observation gaps are reported separately over every windowed mission and are not promoted to a holder. The largest lane excludes external handoffs. True CPU and provider resources remain separate totals. FLOW reports observed waiting, working and held totals, row means, p90 and `n`; its state cards use the established median lane dwell for the selected delivery and implementer cohort. Class: lifecycle. |
| Agent runtime | How much measured agent execution was used? Source: agent runs in `usage_statistics`. | Sum measured run duration per delivered mission, then aggregate only measured missions. Missing duration is unavailable, not zero. Class: telemetry. |
| Tokens, cost, tool calls | What measured resources did delivery use? Source: agent runs in `usage_statistics`. | Sum available values per delivered mission, then aggregate only values observed for that metric. Display numerator/denominator coverage. Class: telemetry. |
| Agent spend by stage | Which resources were recorded for each stage actor? Source: stage measurements. | Weekly and date-range reports group by the agent that performed each stage and its concrete recorded model; amounts whose model is unrecorded or generic (`mixed`, runner family names) appear once as unavailable model attribution instead of a model row, using measurement dates rather than mission completion. Codex shows the highest recorded quota level per stage; the total column adds the stage columns, like dollars and minutes, and no stage shares are shown for quota. Missing or invalid levels show a dash; a recorded zero remains 0%. Unattributed quota levels are not shown. Claude uses dollars and custom runners use minutes even when their provider is OpenAI; their totals and parenthesized stage shares remain additive. Class: telemetry. |
| Cohort comparison | Did a labelled experiment cohort differ? Source: canonical Mission labels/assignee and agent-run provider/model, plus lifecycle events. | Group completed repository-scoped outcomes by label, implementer, model, provider, or inclusive completion-date range. Show cohort `n`, lifecycle and review figures, runtime/tokens/cost, and per-metric coverage. Class: derived comparison. |

Review keeps owning its decision, cause, revision and sender. Fresh return
history adds only the sending stage and, when a durable workflow owns the
return, its exact operation and generation. An operator return without a
workflow owner retains its stage while leaving both authority fields absent.
Gate, rebase and activity observations remain joinable after a workflow stops
or is replaced because the authorized generation is derived from the durable
operation lifecycle, never from a numeric range. A foreign, forged or incomplete
identity is excluded with a scoped collection defect. Labels and timestamp
proximity never supply a missing stage or generation.

Returns follow the submitted work when agents change. The round under review
when a return happens names the author of the rejected work. The report shows the
return under the model telemetry proves wrote it: the only model the agent used
on the mission (when none of its implementation telemetry is generic, mixed or blank), or the model recorded on or before the return when it switched.
Same-day switches and missing telemetry leave it as unavailable model attribution.
`# missions as implementer` counts every completed mission a model was attributed
in, whether it finished the mission or wrote work that was sent back. Lifecycle
metrics keep their own populations and denominators.

Normal stats and board reads reconcile retained Review history directly, so
repair observations do not require a backfill first. Reports have no persisted
snapshot or scalar fallback. Stored `pr_fix_rounds` values are legacy authored-fix counts, never
relabelled as all-cause totals; reconstruction outputs come from the same calculation; stage telemetry does not
establish a review measurement. `px stats backfill`
previews recovered evidence from retained Mission, lifecycle, workflow, Git and
provider history, including old/new counts, coverage, conflicts and unresolved
sources. For one-time measurement recovery, the operator supplies exact
mission/actor identities with `--recovery-inventory`; the command does not infer
the population from task names, dates, configured models or neighboring rows.
It reports each original row and the exact run used as evidence, including its
hash;
missing exact run links remain named gaps rather than being matched by date,
defaults or neighboring missions. It does not restore a CSV or legacy
review-state importer. Explicit apply records the original and proposed row
before writing an evidence-backed correction through the measurement store,
and writes only to a consistent isolated database copy; the live operator
database is refused. Repeating or resuming an unchanged apply preserves
existing evidence and corrections without duplicating them.

The JSON backfill report is also the historical analysis export. Every metric
states its eligible population, observation count, denominator and coverage,
with supported period, model, stage and cause cohorts. Return distributions are
reconstructed facts from the shared all-cause counting owner. Recorded
`rebound.repair` durations are direct observations of individual repair
attempts, not complete mission repair time. Provider PR-to-review durations are
elapsed turnaround between recorded timestamps, not execution time. Means are
estimates of the observed retained cohort only; their intervals describe
sampling uncertainty and do not correct retention or selection bias.

Historical retention, provider availability and missing attribution can make
cohort coverage unequal. The export names those gaps and does not claim the
observed cohort represents unretained work or apply a correction multiplier.
Cause cohorts come from the same distinct all-cause returns used by the report;
provider publications and approvals are not causes. Model and stage coverage
for repair duration uses every repair in that attributed cohort as the
denominator and only repairs with a recorded duration as observations.
Pre-measurement CPU, per-gate execution intervals, source intervals, gate DAGs
and verification attempts remain unavailable. Reconstructed historical
boundaries are never joined to measured verification-attempt telemetry. The
recovery collector excludes `verification.attempt` records already owned by the
measured verification projection and labels retained post-cutoff workflow facts
as measured workflow rather than historical reconstruction.

## Bug-labeled mission trend

`px stats` shows bug counts and shares for the same delivery-completion
populations as mission flow and agent performance: the current rolling seven
local calendar days (`today-6` through `today`) and the preceding seven
(`today-13` through `today-7`), both inclusive. On October 8 these are October
2–8 and September 25–October 1. Explicit `--from` / `--to` reports show the
whole selected inclusive range, including partial calendar weeks.

Reporting dates advance once at local midnight, including across daylight-saving
changes. New deliveries appear on the next stats read or board refresh during
the day. For a machine in Stockholm, reporting uses `Europe/Stockholm`; stored
UTC and explicit-offset timestamps are interpreted in that zone without
rewriting historical records.

Bug share is `bug missions / completed missions`. The exact `bug` label from
Mission state is authoritative; Backlog task labels do not determine membership.
A bug mission still contributes to its AI SDLC, user value, or unclassified flow
count. A period with no completions shows a dash and “no completions”, while an
observed population without bugs shows 0%. Unavailable lifecycle history makes
the report unavailable. Administrative closure never moves a delivery into a
later period. These shares describe delivery effort, not a defect rate per line
of code or proof of causation.

## Verification measurements

FLOW and `px stats` share a repository-scoped verification breakdown labelled
**retained history**. It includes open work and historical attempts independently
of the weekly delivery cohort. A mission stats report limits it to that mission.
Measurement begins with the installed support; older work has unknown
attempt and CPU coverage. These observations do not authorize proof reuse.

Each gate execution has a distinct attempt identity and start/terminal
observations. Reused proofs are counted separately. Reruns are later executions
of the same mission, phase, gate key and command, including across revisions.
Failures retain their typed classification; infrastructure failures remain a
separate count. Starts without terminal observations are incomplete, with no
invented finish time or CPU value.

Elapsed values are milliseconds. Execution and waiting totals use interval
unions, so concurrent or nested intervals count once. Waiting reports only
observed admission/activity intervals outside execution; unrecorded scheduling
or dependency waiting remains unknown. Lifetime is the union of observed mission
intake-to-first-delivery intervals, not a sum of agent runtimes. Overlap is
summed execution duration minus its union, not a contention measurement.

The gate DAG path is the longest sum of execution durations along observed
dependencies in a fully recorded batch. It excludes admission and agent work;
it is not an end-to-end workflow critical path. Missing plan nodes, dependency
edges, terminals or links between batches produce unknown paths. Failure-to-
success recovery spans include waiting, repair and rerun time; their CPU shows
only observed gates within those spans. Repair and re-review activity report
closed source intervals. Unscoped historical activity and agent CPU are unknown.

OS CPU is reported in microseconds from Bash's OS accounting for the command
and descendants it waited for, with millisecond collection precision. Detached
or unwaited descendants are outside this boundary. CPU boundaries suppress
observations already included by a measured parent. Legacy synchronous commands
may supply wall time without CPU; coverage is shown alongside observed totals.
Measured zero differs from missing values.

Revision comparisons disclose observation counts and configuration fingerprint
agreement. Matching command text or configuration does not prove equivalent
discovered workloads or host load. Ranked observed costs identify investigation
candidates; missing coverage prevents a trustworthy optimization-benefit or
contention estimate. See [opt-in profiling](verification-profiling.md) for sample
semantics and retained experiments.

Any legacy CSV analysis remains a separate read-only boundary. Stats recovery
does not read it or join it to a repository-scoped production projection.
