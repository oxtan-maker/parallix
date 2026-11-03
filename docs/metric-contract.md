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
| Missing data | `null` means unavailable; a numeric `0` means an observed zero. Partial data records its rejected/missing-identity count and every derived figure reports the number of observations used or a numerator/denominator coverage. Explicit legacy imports remain marked legacy/estimated. |
| Shared calculation | Board projection and `px stats cohorts` use the application projection (`metrics.ts`, `metrics-read-adapter.ts`, and `cohorts.ts`). CLI and presentation adapters format or fetch; they do not redefine identity, completion, windows, or aggregation. |

## Metric catalogue

| Statistic | Question and source | Aggregation, timestamp/window, coverage, class |
|---|---|---|
| Flow / WIP by lane | How many missions occupied each lane? Source: lifecycle initial-entry and transition events. | Replay initial entry and transitions through the observation instant; do not seed history from today’s state. Counts are measured only with complete history, otherwise unavailable/legacy fallback. Class: lifecycle. |
| Lifecycle cycle time | How long did delivered work take end-to-end? Source: first lifecycle entry and first `integration → done`. | `completedAt - lifecycleStartAt`, one value per delivered mission; never sum agent duration. Median reports its own `n`. Class: lifecycle. |
| Lane dwell | Where did delivered work wait? Source: successive lifecycle events. | Attribute each interval to the state occupied before the next event. Sum closed intervals per mission per lane before taking the median; coverage counts missions with closed dwell in that lane. Open intervals are excluded. Class: lifecycle. |
| Current lane age / bottleneck | Which non-terminal lane is waiting longest now? Source: latest lifecycle event plus injected projection clock. | `asOf - enteredCurrentLaneAt`; `done` and `integration` never select the bottleneck. Per-lane median reports its own `n`. Class: lifecycle. |
| Throughput / weekly throughput | How many missions were delivered over time? Source: first `integration → done` lifecycle event. | Count delivered missions by completion week; FLOW compares the current and preceding non-overlapping seven-day windows. Class: lifecycle. |
| Review bounce rate | How often did reviewed missions return to active? Source: lifecycle events. | `review → active` bounce events divided by missions that entered review; repeated bounces count as events and denominator is missions. `pr_fix_rounds` is a separate review-fix metric. Class: lifecycle. |
| Review-fix rounds | How many distinct repair obligations required implementation changes? Source: reconciled Review decisions, human corrections and approval revocations. | Count each obligation once, combining duplicate publications and provider/local evidence. Report review, human and evidenced integration repairs separately from pushback, infrastructure incidents, mechanical re-review and unknown causes. Unknown counts and authorship remain unavailable. Mission summaries use mission totals; agent averages use authored obligations and show their measured mission count (`PR fix n`). Class: review measurement. |
| Agent runtime | How much measured agent execution was used? Source: agent runs in `usage_statistics`. | Sum measured run duration per delivered mission, then aggregate only measured missions. Missing duration is unavailable, not zero. Class: telemetry. |
| Tokens, cost, tool calls | What measured resources did delivery use? Source: agent runs in `usage_statistics`. | Sum available values per delivered mission, then aggregate only values observed for that metric. Display numerator/denominator coverage. Class: telemetry. |
| Agent spend by stage | Which resources were recorded for each stage actor? Source: stage measurements. | Weekly and date-range reports group by the agent that performed each stage and its model, using measurement dates rather than mission completion. Codex shows the peak recorded quota level per stage and across the row, labelled "quota peak"; snapshots are never summed or used for stage shares. Missing or invalid levels show unavailable; a recorded zero remains zero. Quota snapshots lack the baseline and quota-window identity needed to attribute consumption deltas. Claude uses dollars and custom runners use minutes even when their provider is OpenAI; their totals and parenthesized stage shares remain additive. Class: telemetry. |
| Cohort comparison | Did a labelled experiment cohort differ? Source: canonical Mission labels/assignee and agent-run provider/model, plus lifecycle events. | Group completed repository-scoped outcomes by label, implementer, model, provider, or inclusive completion-date range. Show cohort `n`, lifecycle and review figures, runtime/tokens/cost, and per-metric coverage. Class: derived comparison. |

Review-fix authorship follows the submitted work when agents change. Earlier
agents retain obligations for their work, even when a replacement performs the
repair. Delivery counts and cohort `n` still use final ownership; repair
observation counts can therefore include an agent with no final deliveries.
An implementer cohort uses that agent’s authored repair observations, while
label and date cohorts use mission totals. Lifecycle metrics keep their own
populations and denominators.

Normal stats and board reads reconcile retained Review history directly, so
repair observations do not require a backfill first. Reports have no persisted
snapshot or scalar fallback. Historical scalar counts are export and
reconstruction outputs of the same calculation; stage telemetry does not
establish a review measurement. `px stats backfill`
previews reconstruction from retained Mission history, including existing rows,
with old/new counts, coverage and unresolved histories. `--apply` writes the
same reconstruction idempotently; raw review evidence is preserved. Inspect an
isolated database copy before applying it to operator state.

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
Collection begins with the installed measurement support; older work has unknown
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

Legacy CSV is an explicit read-only import/analysis boundary. It cannot silently join a repository-scoped production projection.
