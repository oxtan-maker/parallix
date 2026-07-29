# Parallix domain model

**This directory models missions and the decisions Parallix makes about them, independently of files, databases, CLI output, and UI components.**

The model is deliberately smaller than the persisted data. A CSV row, JSON file,
storage path, or board lane is an adapter or projection concern unless it has
identity and rules of its own. The checked TypeScript is the model; this note
explains its boundaries and the evidence behind them.

This README documents the checked model and current implementation. It does not
decide storage placement or authority. ADR 0053 owns those decisions; when this
note and ADR 0053 differ, the ADR governs and this note must be corrected.

## The model

`Mission` is the aggregate root. It owns labels, workflow status, closure time,
assignee, replaceable checkpoint evidence, the review conversation, and NEL
(`mission.ts`). `decideMission()` applies workflow-owned
commands and rejects invalid state or missing evidence (`mission-workflow.ts`).
Agent-launch callbacks, operation progress, and restoration after an execution
failure are application orchestration; they are not mission lifecycle commands.
There is no production `Attempt` type: current agent work is modeled as
`AgentRunMeasurement` and `SessionMarker`, neither of which supplies an
Attempt identity or lifecycle invariant. That is not merely an implementation
boundary — no traced launch, retry, failover, usage, review, or UI consumer
needs one (`src/application/consumer-domain-requirements.ts`), and
`test/domain-attempt-guard.test.ts` fails if an Attempt-shaped type, table, or
record is declared under `src/domain`, `src/application`, or `src/adapters`.

Labels are an open-ended collection, matching Backlog task frontmatter. They
preserve independent dimensions: a mission may currently be both `ai_sdlc` and
`bug`, for example. `ai_sdlc` versus `user_value` is a report cohort for a
particular hypothesis, not a permanent mission classification. Future
hypotheses can introduce different labels without changing the aggregate type.

The domain statuses are `backlog`, `refined`, `active`, `review`, `integration`,
and `done`. The Backlog adapter maps its current persisted/virtual
`approved`/`ready-for-integration` vocabulary to the domain's `integration`
queue (`config/state-map.json`). Closure is a separate, explicit fact backed by
successful integration-base closeout and removal of the mission worktree;
`status: done` by itself does not make a mission closed. The valid-state union
represents an open mission with `closedAt: null` or a closed mission with
`status: done` and a closure timestamp. This deliberately permits the
post-integration, pre-cleanup state `status: done, closedAt: null`.
`integrate` and `shipped` are board lanes, not additional mission states;
`boardLane()` keeps that intermediate state in `integrate` and maps only a
closed mission to `shipped`
(`src/application/projections/mission-board.ts`).

The other requested state surfaces have these roles:

| Surface | Model shape | Why | Current evidence |
|---|---|---|---|
| Mission lifecycle | Aggregate state and commands | Status, assignment, checkpoint, and review rules must change consistently | `src/platform/runtime/lib/tools/backlog.ts:526` |
| Checkpoints | Replaceable entity within a mission, keyed by checkpoint name | A mission redo replaces stale CP evidence; Git retains revisions | `src/platform/runtime/lib/commands/checkpoint.ts:8` |
| Review | Ordered round conversation inside a mission | Reviewer decisions, implementer responses, exact revisions, and findings must remain attributable across rounds | `prompts/review.md`, `prompts/act-on-review.md`, `src/platform/runtime/lib/review/review-loop.ts:1375-1696` |
| Agents and eligibility | Value objects plus pure selection policy | Eligibility is evaluated from configuration, explicit blocks, and launcher availability | `src/platform/runtime/lib/agents/launcher-selection.ts:127` |
| Usage/statistics | Agent work measurements plus a completed-mission projection | Statistics need closure, final implementer, model attribution, cost, time, tokens, fix rounds, and change size; the CSV is only one storage format | `src/platform/runtime/lib/commands/stats.ts:108`, `:866`, `:1940` |
| Known repositories | Repository identity plus an application selector projection | No repository registry or last-used signal is authoritative today | `src/domain/repository.ts`, `src/application/projections/repository-selector.ts` |
| NEL | Replaceable numeric attribute on `Mission` | It describes the mission's change size and is captured at handoff; it has no independent identity | `src/platform/runtime/lib/commands/handoff.ts:1093`, `src/platform/runtime/lib/core/nels.ts:186` |
| Session/resume | Value object scoped to mission, role, and agent family | Resume is allowed only when all three match | `src/platform/runtime/lib/tools/sessions.ts:35`, `:58` |

Checkpoint content is not immutable. `recordCheckpoint()` replaces an existing
checkpoint with the same name and rejects cross-mission evidence
(`checkpoint.ts:46`). Review is not a mutable phase enum. `Review` records an
ordered sequence of rounds; each round names the exact revision, reviewer
decision, findings, and implementer response (`review.ts`). Agent family names
are open values, but reviewer assignment succeeds only when the family appears
in the user-configured `review` eligibility policy. The application must
materialize `ConfiguredReviewerEligibility` from that explicit step. A missing
or empty review step makes reviewer assignment unavailable; it must not fall
back to built-in agent families or the default policy.

Checkpoint `nextActionText` preserves the tracked `Next action:` guidance for
board/detail display. It is deliberately text, not an executable command.
The reviewer can approve, with an optional comment, or request changes with
identified findings. A standalone reviewer comment is an event, not a command.
The implementer either submits one fixed/disputed resolution for every finding
or requests human intervention. The domain does not distinguish the legacy
`PARKED` and `BLOCKED` labels because both stop autonomous progress for the same
operator action. After a complete resolution, application policy selects the
next reviewer from configured eligibility and opens the next round. Status
(`awaiting-review`, `awaiting-implementation`, `ready-for-next-round`,
`approved`, or `human-intervention`) is derived from that conversation.
Identity types live with their owners: `MissionId` in `mission.ts`,
`RepositoryId` in `repository.ts`, and `AgentFamily` in `agents.ts`.

## Mission rules

The state machine contains only transitions the current workflow owns:

```text
backlog/refined --activate--> active --submit-for-review--> review
       ^                                          |
       +-------------request-changes--------------+--approve--> integration --integrate--> done
```

`submit-for-review` requires passed gates, checkpoint evidence, and a review
awaiting a reviewer decision. `request-changes` requires that same exact
revision to be awaiting an implementer response; `approve` requires it to be
approved. `integrate` requires the durable `integration` queue state.
Pull-request identity represents the local review conversation: an optional
review-surface key, its opaque ID, optional URL, and source/target branches.
Forgejo may project that conversation through its locally hosted Docker
surface, but it does not make review a remote-service concept. Each round also
records the exact commit revision, so approval cannot silently survive a branch
update. Operation without a review surface uses the local-branch variant. The
application may expose Integrate while a mission is still `review` only when
the approval fact names that same reviewed revision. It must first apply the
approval/promotion transition, matching `px integrate` preflight behavior
(`src/platform/runtime/lib/commands/integrate.ts:1071-1152`). Invalid
commands throw `MissionRuleViolation` with the ADR 0048 human-only disposition.

## Persistence seam

The domain does not depend on repository interfaces. Application-owned ports
live in `src/application/domain-ports.ts`; a Markdown/Git adapter can implement
`MissionStore` without changing `Mission` or `decideMission()`. Markdown/Git is
the current compatibility adapter. ADR 0053 exclusively defines the target
SQLite location, persisted domain concepts, authority, and cutover rules.

`materializeBacklogMission()` defines what the current Backlog/Git adapter must
prove. Its
`integrationBase` is the recorded feature base, or `main` for a normal mission.
That committed view owns lifecycle status and assignment. While the mission is
open, a readable mission worktree may supply newer labels, title, checkpoint,
review, and NEL content. Once integration is committed, the merged integration
base supplies all mission content; a stale worktree cannot reopen or overwrite
it.

For the current Backlog/Git adapter, `completionRecorded` means the committed
integration-base task has both `status: done` and canonical placement in
`backlog/completed/`. Closure is exposed only after that fact is durable and Git
reports the mission worktree absent. Backlog Markdown stores the lifecycle
status; it does not gain a second closure field. The ADR 0053 adapter may record
closure only after the same integration and worktree-removal conditions.

| Repository observation | Materialized result |
|---|---|
| Integration-base task is open; readable worktree exists | Open mission; base status/assignee plus worktree content |
| Integration-base task is open; no worktree exists | Open mission from the integration base |
| Integration-base task is committed as done/completed; worktree still exists | Open `done` mission in closeout-pending state |
| Integration-base task is committed as done/completed; worktree is absent; closure time exists | Closed mission |
| Any optional PR view says merged but the integration base is not done/completed | Still open; PR state is not mission authority |
| Status and completed placement disagree | Unavailable: adapter conflict |
| Duplicate/ambiguous integration-base task copies | Unavailable: adapter conflict |
| Open worktree exists but cannot be read | Unavailable rather than stale reconstruction |
| Integration base is missing, even if a worktree copy exists | Unavailable: lifecycle authority is missing |

Agent selection proves the sync/async boundary on the consumer that caused the
TASK-2280 cascade. An `AgentSelectionSnapshotPort` asynchronously materializes
configuration, block, and launcher-availability facts once.
`PreparedAgentSelection.prepare()` crosses that boundary; subsequent `select()`
calls are synchronous pure reads (`src/application/services/agent-selection.ts:6-15`).
No launcher probe or persistence read occurs in `selectAgent()`.
The custom launcher's internal concurrency check remains runtime-specific; it
is not modeled as a general capability shared by every agent family.
Unweighted selection is random across the available pool. Array order is never
a selection strategy; explicit CLI choice enters as `preferred`, while durable
selection bias must be declared with `weighted` policy and explicit weights.

## Compatibility routing

`src/application/mission-authority.ts` describes current file-backed routing
while migration is incomplete. Its exhaustive `MISSION_FIELD_AUTHORITY` map
prevents an unclassified compatibility write, but it is not the architecture
decision for the target store. ADR 0053 owns that decision.

Forgejo remains an optional projection. Git and filesystem observations used
by the compatibility adapter remain external facts rather than fields whose
meaning is redefined by this README.

## Read models and access patterns

Board/TUI contracts belong to application read use cases, not the domain. They
are split by screen instead of collected in one miscellaneous module:

| Query/use case | Contract |
|---|---|
| Mission board: labels, lifecycle state, current live work, agent, checkpoint, guidance, gate, PR approval, blockers, flags, guarded commands | `application/projections/mission-board.ts` |
| Mission detail: checkpoints, review round/phase/findings, NEL, completed statistics | `application/projections/mission-detail.ts` |
| Attention queue and WIP by lane | `application/projections/mission-board.ts` |
| Cumulative flow and median cycle time | `application/projections/analytics.ts` |
| Agent availability and timed-block countdown | `application/projections/agent-status.ts` |
| Command/event log | `application/projections/activity.ts` |
| Repository selector | `application/projections/repository-selector.ts` |

These projections may combine repository authority with Forgejo, gate, and
operator-local facts. They do not become write models. `integration` projects
to the `integrate` lane; an unclosed `done` mission stays there during
closeout, and only a closed mission projects to `shipped`. This keeps UI
language out of the mission state machine. `currentWork` is the latest ephemeral
operation progress (`operationId`, phase, summary, agent, timestamp), allowing a
live board to distinguish “launching agent”, “recording”, “handoff”, or gate work
without inventing lifecycle states. On reconnect it is refreshed from the
application operation/progress source; it is never completion authority. Board
commands expose enabled/disabled state and a reason; the projection does not
mutate a mission.

Usage is modeled from the report decisions rather than as a CSV-row class.
`AgentRunMeasurement` retains the dimensions those decisions require:
recording date, work stage, actor role and family, provider, model, input,
output, cached and context tokens, tool calls, provider-usage samples, duration,
and cost (`usage.ts:81`). `MissionOutcome` contains only outcome measurements:
cycle time, request-changes count, and the measured work. It does not duplicate
labels, closure, implementer, or NEL from `Mission`.

Work stages describe why an agent consumed tokens, not mission lifecycle or CSV
aliases. Current launch paths map to `draft`, `execute`,
`review-preparation`, `review`, `review-response`, `conflict-resolution`, or
`integration-verification`. Draft repair remains draft work; handoff, pre-review
gate, and static-review repairs are review preparation; act-on-review is a
review response. `default` remains only as an explicit debt sentinel for an
imported measurement whose producer supplied no stage. No known activity maps
to it (`AGENT_WORK_STAGE_BY_ACTIVITY`). Conflict resolution is implementer
work; TASK-2294.01 owns the runtime correction that will pin both conflict
entrypoints to the recorded mission implementer and remove their separate agent
pool.

`completedMissionStatistics()` requires a validated `ClosedMission`, rejects an identity
mismatch or missing mission NEL, and returns the final implementer and every
model involvement with its provider, stage, role, and agent (`usage.ts:152`).
It preserves all mission labels so reporting can evaluate separate cohorts such
as hypothesis labels and `bug` without forcing them into one enum.
A provider that cannot identify a model or report a numeric measurement produces
`Measurement.unavailable`; projections return `null` instead of substituting an
agent-family label or inventing a zero.

## Modeling decisions audit

| Chosen shape | Rejected alternative | Evidence |
|---|---|---|
| One `Mission` aggregate with a nested review entity | A file-oriented class per JSON/Markdown artifact | Lifecycle commands update status, assignee, review, and checkpoint evidence as one mission (`backlog.ts:526`, `handoff.ts:637-641`) |
| IDs colocated with their owning concepts | Shared `ids.ts` namespace | Callers import the concept they use; there is no independent identity subsystem |
| Mission lifecycle state separated from live work | Launch callbacks and rollback as `MissionCommand` variants | `active` emits operation progress and compensates failed execution around the authoritative task write; those are application facts, while `activate` is the durable mission decision (`active-service.ts:26-35`, `active.ts:123-197`) |
| Replace checkpoint by name | Immutable checkpoint value object | Missions are redone and CP documents are revised; `px checkpoint` commits the current tracked tree (`checkpoint.ts:51-58`) |
| `nextActionText` as display guidance | Executable `nextAction` | The checkpoint command writes `Next action:` into commit/document evidence but does not dispatch it (`checkpoint.ts:57`) |
| Domain `integration` queue vs adapter status and board lane | Encoding `approved`, `ready-for-integration`, and `integrate` as three domain states | `config/state-map.json` maps adapter vocabulary; live work distinguishes queued from active integration |
| Review as reviewer/implementer commands over exact revisions | Copying the mutable `review-state.json` phase/disposition snapshot | Prompts expose two reviewer decisions and implementer resolution/intervention; runtime phase and disposition can legitimately disagree (`review-loop.ts:1375-1696`) |
| Explicit configured reviewer eligibility passed into round creation | Built-in reviewer names, the default step policy, or fallback families | `config/agents.json` owns the eligible `review` families; missing or empty review eligibility makes assignment unavailable |
| Stable finding IDs and per-finding resolutions | Global `CHANGES_MADE`/`PUSHBACK_ALL` transitions | The implementer prompt already requires a response for every finding, while the current file format cannot reliably join them; durable storage needs stable IDs |
| One human-intervention state | Separate `PARKED` and `BLOCKED` domain states | Both legacy dispositions stop the autonomous loop and hand control to a human (`review-loop.ts:1637-1641`) |
| Provider-neutral reviewed revision on each round | Forgejo PR fields in `MissionOperationalFacts` or approval tied only to a branch | Review can run with provider disabled, while approval must identify both the stable PR/local change and the exact reviewed commit |
| Valid open/closed `Mission` union with an explicit `done` closeout-pending case | Nested closure object or inferring closure from `status: done` | Integration commits `done`/completed before worktree cleanup; cleanup can fail independently (`integrate.ts:829-891`) |
| Backlog/Git integration-base/worktree materialization policy in its adapter | Making Git topology part of `MissionStore` or letting the last queried checkout win | Current integration takes lifecycle status from the base checkout and mission metadata from the worktree (`integrate.ts:978-1001`) |
| NEL as a mission attribute | Standalone NEL entity or duplicated outcome field | Handoff captures one replaceable change-size observation for the mission (`handoff.ts:1093`) |
| Agent work and completed-mission statistics | Copy of `StatsRow`/CSV columns or an outcome detached from its mission | Reports group completed missions by final implementer/model and attribute review rows to reviewers (`stats.ts:667`, `:866`, `:1940`) |
| Explicit token-using work stages with `default` as an unmapped-debt sentinel | Copying `active`/`follow-up` CSV aliases or allowing known launches into `default` | Execute, review preparation, review response, conflict resolution, and integration verification all launch agents today; the runtime does not yet record every path |
| Open agent-family value | Closed enum of current built-ins | Launcher selection accepts configured families and probes their CLI (`launcher-selection.ts:93-101`, `:127`) |
| Random or explicitly weighted agent selection | Implicit first-eligible selection | Runtime configuration defaults to random, CLI overrides are explicit, and intentional durable bias belongs in weights (`launcher-selection.ts:150-208`, `config/agents.json`) |
| Application-owned async ports, pure synchronous domain policy | Repository interfaces inside the domain or async selection everywhere | ADR 0051 dependency direction and the synchronous `selectAgent` consumer (`launcher-selection.ts:150`) |
| Concrete projection contracts/functions | `catalog.ts` and `read-model.ts` string registries | Board consumers need data and behavior, not filenames and rationales encoded as runtime records |
| Screen-specific application projections | Domain-level `projections.ts` grab bag | ADR 0051 defines several interface reads and keeps view data out of the write model |

## Implementation status

- The checked `MissionStore` implementation still uses the compatibility
  adapter; ADR 0053 cutover is not implemented by this README.
- `Attempt` is absent from the checked domain, and TASK-2322.02 re-tested that
  exclusion against real consumers rather than restating it: the durable
  consequences of a launch are a family-keyed `AgentBlock`, one replaceable
  `SessionMarker` per (mission, role), and measurement rows grouped by
  `(repo, mission)`. ADR 0053 therefore excludes `Attempt` from persistence
  until domain code establishes its identity and invariants, and
  `test/domain-attempt-guard.test.ts` enforces that.
- Each `database-owned-domain-state` boundary in the ADR 0053 inventory resolves
  to one of these concepts plus its invariant, or to the explicit
  technical-persistence-metadata list, in
  `src/application/persistence-domain-map.ts`.
- Existing SQLite adapters predate the complete ADR 0053 cutover and must not be
  read as architecture decisions.
