# Statistics metric contract

This contract defines every production statistic shown by the board FLOW surface or `px stats`. It keeps lifecycle facts separate from agent telemetry so missing measurements never look like delivery results.

## Shared rules

| Rule | Contract |
|---|---|
| Repository identity | `RepositoryId` is resolved from the primary Git worktree. A mission worktree uses that same identity. Every statistics read scopes by this key before it groups or aggregates; rows without it are rejected and counted as partial, never included. |
| Lifecycle authority | `board_lane_events` is authoritative for mission existence in flow history, transitions, delivery completion, lifecycle cycle time, dwell, WIP, lane age, throughput, and review bounces. `usage_statistics` supplies only execution measurements and cohort runtime dimensions. |
| Completion | `completedAt` is the first `integration → done` event. A later `done → done` `close` event is `closedAt` administration: it may bound final-state dwell but cannot alter delivery completion, its week, or lifecycle cycle time. |
| Time | Timestamps are parsed as instants and normalized to UTC before comparison or ISO-week bucketing. A historical projection includes only events and outcomes at or before its requested instant. |
| Weekly decision window | FLOW compares missions delivered in the current rolling seven calendar days (`today-6` through `today`, inclusive) with the preceding non-overlapping seven days. Membership is determined by delivery completion, then each selected mission contributes its complete lifecycle and measured agent data. |
| Missing data | `null` means unavailable; a numeric `0` means an observed zero. Partial data records its rejected/missing-identity count and every derived figure reports the number of observations used or a numerator/denominator coverage. Explicit legacy imports remain marked legacy/estimated. |
| Shared calculation | Board projection and `px stats cohorts` use the application projection (`metrics.ts`, `metrics-read-adapter.ts`, and `cohorts.ts`). CLI and presentation adapters format or fetch; they do not redefine identity, completion, windows, or aggregation. |

## Metric catalogue

| Statistic | Question and source | Aggregation, timestamp/window, coverage, class |
|---|---|---|
| Flow / WIP by lane | How many missions occupied each lane? Source: lifecycle initial-entry and transition events. | Replay initial entry and transitions through the observation instant; do not seed history from today’s state. Counts are measured only with complete history, otherwise unavailable/legacy fallback. Class: lifecycle. |
| Lifecycle cycle time | How long did delivered work take end-to-end? Source: first lifecycle entry and first `integration → done`. | `completedAt - lifecycleStartAt`, one value per delivered mission; never sum agent duration. Median reports its own `n`. Class: lifecycle. |
| Lane dwell | Where did delivered work wait? Source: successive lifecycle events. | Attribute each interval to the state occupied before the next event. Closed intervals feed each lane’s median and coverage. Class: lifecycle. |
| Current lane age / bottleneck | Which non-terminal lane is waiting longest now? Source: latest lifecycle event plus injected projection clock. | `asOf - enteredCurrentLaneAt`; `done` and `integration` never select the bottleneck. Per-lane median reports its own `n`. Class: lifecycle. |
| Throughput / weekly throughput | How many missions were delivered? Source: first `integration → done` event. | Count unique repository-scoped delivered missions, bucket `completedAt` by UTC ISO week. The series includes the requested/current week even when zero. Class: lifecycle. |
| Review bounce rate | How often did reviewed missions return to active? Source: lifecycle events. | `review → active` bounce events divided by missions that entered review; repeated bounces count as events and denominator is missions. `pr_fix_rounds` is a separate review-fix metric. Class: lifecycle. |
| Review-fix rounds | How many reviewed revisions required fixes? Source: authoritative review events. | Median over completed missions with an authoritative review decision; unknown when no writer exists. Coverage is measured missions. Class: review measurement. |
| Agent runtime | How much measured agent execution was used? Source: agent runs in `usage_statistics`. | Sum measured run duration per delivered mission, then aggregate only measured missions. Missing duration is unavailable, not zero. Class: telemetry. |
| Tokens, cost, tool calls | What measured resources did delivery use? Source: agent runs in `usage_statistics`. | Sum available values per delivered mission, then aggregate only values observed for that metric. Display numerator/denominator coverage. Class: telemetry. |
| Cohort comparison | Did a labelled experiment cohort differ? Source: canonical Mission labels/assignee and agent-run provider/model, plus lifecycle events. | Group completed repository-scoped outcomes by label, implementer, model, provider, or inclusive completion-date range. Show cohort `n`, lifecycle and review figures, runtime/tokens/cost, and per-metric coverage. Class: derived comparison. |

## Implementation inventory

The only lifecycle write path is `MissionTransitionStore.saveWithTransition`: intake, lifecycle transitions, integration, and administrative closure use it. `SqliteMissionStore` performs state and lane-event writes together. `ConcreteMetricsReadAdapter` scopes lane events and usage rows before building the shared projection. The remaining pre-consolidation identity derivations in production composition are repaired in CP-2; no adapter may infer a statistics identity from an arbitrary worktree path.

Legacy CSV is an explicit read-only import/analysis boundary. It cannot silently join a repository-scoped production projection.
