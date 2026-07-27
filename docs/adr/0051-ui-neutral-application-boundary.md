# ADR 0051: UI-neutral application boundary and retained workflow authority

Status: Accepted; implementation requires integrated-ADR and explicit human approval
Date: 2026-07-20
Related: ADR 0037 (workflow coordination), ADR 0044 (workflow distribution model), ADR 0048 (fail-closed harness), ADR 0052 (task catalog authority), TASK-2277, TASK-2278

## Context

ADR 0044 establishes the product direction: the headless CLI remains the
automation surface, Ink is an additional terminal interface, and a local web
board is a possible third client. It also sets the intended dependency
direction—interfaces call application use cases; adapters implement effects.
This ADR makes that direction concrete for the current repository without
pretending that the current `lib/` layout already has those layers.

Today a command module is both an interface adapter and an orchestrator. For
example, `active` parses a CLI flag, runs preflight, resolves a worktree,
selects and starts an agent, changes task state, records statistics, starts
handoff, emits terminal text, and determines the process exit code
(`lib/commands/active.ts:24-191`). Its injected-function tests make those
dependencies mockable, but the interface contract and lifecycle policy remain
mixed together. A TUI or web server that calls these command handlers would
inherit argument parsing, terminal rendering, and `process.exit` semantics;
one that bypasses them would be likely to reimplement lifecycle behavior.

The existing lifecycle behavior is more consequential than the UI shape. When
`active` starts an execute agent, it records `status=active` and the actual
implementer only from the launch callback. If the launch subsequently fails or
returns a non-zero status, it restores the prior status and assignee
(`lib/commands/active.ts:195-299`). `transitionTask` writes the authoritative
task record on the integration branch and only then attempts to synchronize a
mission worktree; it deliberately defers that rebase while an agent can have
uncommitted work (`lib/tools/backlog.ts:676-760`). The tests name both the
ordering and exit-code contracts (`test/active.test.ts:203-244`,
`test/active.test.ts:301-323`, `test/active.test.ts:385-406`). A new interface
must preserve these invariants, not merely expose a convenient button.

Workflow state already has distinct, legacy authorities. Task records are
currently individual Markdown files in `backlog/tasks/`, `backlog/completed/`,
and `backlog/archive/`; `resolveTaskFile` searches those stores and
`getTaskStatus` reads their front matter (`lib/tools/backlog.ts:52-83`,
`lib/tools/backlog.ts:280-307`). Mission and review artifacts are Git-owned.
ADR 0037 retained those surfaces rather than adding a new state store.
`backlog.md` is an optional legacy aggregate, not the canonical task catalog;
this ADR neither requires it nor makes preserving writes to it a goal. That
Markdown authority is the pre-cutover state: ADR 0052 owns the task-catalog
authority decision and the rule for who may author a task record. The
operator board supplied to this mission is evidence of desired operator
attention and interaction, not evidence for a browser-owned store, component
model, or authority migration.

The proposed boundary also has to retain the CLI's public behavior. The `px`
entry delegates command dispatch through `index.js` while capturing the command
exit code (`px.ts:157-260`). `stats-backfill` already distinguishes a read-only
report from a write: it produces its JSON or text projection first and writes
rows only when `--apply` is present (`lib/commands/stats-backfill.ts:355-413`).
Its fixture test asserts help, JSON, summary, skipped records, and apply
behavior (`test/stats-backfill.test.ts:268-389`). `active` intentionally has no
JSON contract. A shared application boundary must not silently normalize these
differences away.

Repository automation evidence also constrains this decision. ADR 0048 and
completed TASK-1384 document the fail-closed response to unsupported agent
claims and lifecycle failures. The deterministic lifecycle suite
`test/e2e-mission-lifecycle.test.ts` and real-agent smoke suite
`test/e2e-real-agent-smoke.test.ts`, together with completed TASK-2205,
TASK-2236, and TASK-2269, record operational constraints from slow or
workstation-dependent agent runs, runner/configuration failures, and unavailable
environment resources. Therefore the proposed boundary must retain deterministic
mocked-port tests and must not treat UI progress or an agent assertion as proof
of a durable lifecycle transition.

Reliability is the primary reason to change the architecture. Development
throughput is useful, but the workflow repeatedly creates follow-up bug work;
making the same system faster without reducing that frequency would make the
product worse. The task catalog provides a direct, if coarse, baseline through
its exact `bug` label:

| Completed-mission cohort at 2026-07-20 | All unique missions | `bug` missions | Non-`bug` missions | Bug frequency | Bugs per 100 non-bug missions |
|---|---:|---:|---:|---:|---:|
| Since label observation began (2026-06-22) | 129 | 39 | 90 | 30.2% | 43.3 |
| Created 2026-06-22 through 2026-06-30 | 58 | 9 | 49 | 15.5% | 18.4 |
| Created in July 2026 through July 20 | 71 | 30 | 41 | 42.3% | 73.2 |

The observation window starts on 2026-06-22, the standalone repository's
initial commit, where the imported task catalog already used the `bug` label.
Tasks dated before that point are excluded because their non-`bug` status
cannot be assumed to mean the same classification was applied. The denominator
contains only unique mission IDs currently recorded under `backlog/completed/`;
open, backlog, refined, active, review, and archived records do not count as
completed missions. The inventory deduplicated completed copies by task ID,
filtered to the 129 completed IDs created in the observation window, and
treated an ID as a bug if any completed copy carried the exact `bug` label.
Existing malformed frontmatter is included only when ID,
creation date, and exact-label classification remain unambiguous, and is
reported as a data-quality warning; ambiguity in any of those fields aborts
the count instead of silently classifying the record. This is a workload-
frequency measure, not a production defect rate or severity measure: label
application may still be inconsistent,
a task can describe more than one defect, July is a partial month, and task mix
and reporting behavior can change. The period rows therefore do not prove a
trend or architectural causation. They do show that bug work is too large a
share of the recorded development workload to leave reliability implicit in
this decision.

## Decision drivers and evidence

The decision is evaluated first on its credible mechanism for reducing that
bug frequency, then on the architectural properties that protect current
behavior. Delivery speed is secondary and cannot compensate for more bug work:

1. **Lower completed-mission bug frequency and prevent recurrence.** The change must make
   lifecycle policy testable once, preserve deterministic regression evidence,
   and stop interface or adapter changes from bypassing the same rules. The
   completed-mission label baseline must continue after implementation so reduction is
   measured rather than asserted.
2. **One authority and one transition path during migration.** Until the
   ADR 0044 database cutover replaces it, a task lifecycle update continues to
   use the existing Markdown/Git path, including its integration-branch and
   rebase behavior. A UI cache, event stream, or SQLite index cannot become a
   competing writer.
3. **Preservation of fail-closed lifecycle semantics.** ADR 0048 classifies
   state-machine violations and infrastructure blockers as human-only. An
   interface must be able to show an operation failure without converting it
   into a completed-looking board move.
4. **Interface compatibility.** Existing scripts depend on text, supported
   JSON payloads, and exit codes. The boundary must let the CLI retain those
   translations while giving non-terminal clients structured results.
5. **Effect isolation and testability.** Filesystem, Git, Forgejo,
   subprocess/agent, configuration, and statistics effects are currently
   injected ad hoc in command tests. New services should make those seams
   explicit and retain fast mocked tests; they must not contact Forgejo or
   launch real agents.
6. **Operational truth over UI liveness.** An agent process, Git rebase, or
   review operation can outlive a client connection. Progress is useful for
   attention management, but durable task and Git evidence—not a UI event or
   browser memory—is proof of a completed transition.
7. **Incremental adoption.** The repository has a large, mixed command layer.
   A boundary that requires moving all commands or converting task authority
   before it can be used creates an unreviewable migration and obscures
   lifecycle regressions.

## Decision matrix

The matrix separates non-negotiable correctness constraints from benefits and
costs. It does not use a numeric score: assigning unmeasured weights would
hide a judgement call. An option is eligible only when it satisfies C0–C4.
Among eligible options, the decision favours stronger C5–C7 with a bounded C8
cost. `✓` = satisfies with current evidence; `~` = possible but requires
unproven behaviour or a separate decision; `✗` = contradicts the criterion.

| Criterion | Type | What is being tested | Repository evidence |
|---|---|---|---|
| C0: Bug-frequency reduction | Hard constraint | Centralize policy and effects behind enforceable, regression-tested seams; continue measuring completed `bug` missions versus completed non-`bug` missions after the change. | Since label observation began, 39 of 129 unique completed missions carry `bug`; ADR 0048 and TASK-1268 identify recurring fail-open and lifecycle clusters. |
| C1: Single authoritative writer | Hard constraint | No UI cache, event stream, or new store can independently change lifecycle state during migration. | `transitionTask` writes task state on the integration branch (`lib/tools/backlog.ts:676-760`). |
| C2: Transition correctness | Hard constraint | Preserve launch → record → rollback ordering and do not represent an incomplete operation as complete. | `active` launch/rollback code and ordering tests (`lib/commands/active.ts:195-299`; `test/active.test.ts:301-323`). |
| C3: Automation compatibility | Hard constraint | Preserve CLI text, existing JSON schemas, and exit codes. | `px` captures command exit codes; `stats-backfill` and `active` tests cover their distinct contracts (`px.ts:157-260`; `test/stats-backfill.test.ts:268-389`; `test/active.test.ts:385-406`). |
| C4: Isolated effects | Hard constraint | Unit-test use-case behavior without real Git, Forgejo, filesystem, or agent processes. | Existing command tests inject collaborators, but the seam is not yet an application boundary (`lib/commands/active.ts:24-40`). |
| C5: Interface independence | Benefit | CLI, Ink, and web can invoke the same behavior without parsing terminal output or reproducing lifecycle policy. | ADR 0044 requires one application core for these clients. |
| C6: Operational truth and recovery | Benefit | Long-running work can report progress, reconnect by re-querying, and distinguish durable evidence from UI liveness. | `active` can launch agents and defer synchronization; ADR 0048 requires fail-closed handling. |
| C7: Authority evolution and rollback | Benefit | A future catalog can replace the current task adapter without a dual-write steady state; this change can be removed without persisted-data migration. | Task storage is already behind `resolveTaskFile`/`transitionTask`; ADR 0044 defines the later database cutover. |
| C8: Structural cost and cognitive load | Cost | New abstractions should be limited to behavior with multiple interface/effect boundaries; do not create ceremonial layers around every helper. | Current `lib/` is mixed and only the two selected slices are characterized. |

| Option | C0 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1. Existing command handlers as the shared API | ✗ | ✓ | ✓ | ✓ | ~ | ✗ | ✗ | ~ | ✓ | Rejected: preserves the coupling associated with the current bug workload and still fails interface independence. |
| 2. Board/TUI facade with direct reads and command processes | ✗ | ~ | ~ | ~ | ✗ | ~ | ✗ | ✗ | ~ | Rejected: adds bypass paths and no mechanism to reduce recurring lifecycle defects. |
| 3. Narrow Hexagonal Architecture boundary; CLI remains an adapter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | **Accepted:** centralizes policy behind characterized ports, limits migration risk, and creates a seam where regression prevention and bug frequency can be measured. |
| 4. Full Clean Architecture layering as the migration target | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✗ | Rejected for this mission: it can provide the same defect-isolation mechanism, but extra layer distinctions either collapse to option 3 at this scope or increase migration-regression risk without evidence of additional bug reduction. |
| 5. Board store, SQLite, or event log becomes authority now | ✗ | ✗ | ~ | ~ | ~ | ✓ | ~ | ~ | ✗ | Deferred: may be viable, but adds authority-migration defects before supplying a measured reliability benefit. |
| 6. Generalized command-framework rewrite first | ~ | ~ | ~ | ~ | ~ | ✓ | ~ | ~ | ✗ | Rejected: changes too many uncharacterized policies to establish C0–C4 credibly and creates a large regression surface. |

### Clean Architecture comparison

Robert C. Martin's [Clean Architecture
description](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
explicitly treats Hexagonal Architecture as one of several closely related
approaches. It synthesizes them as concentric policy/mechanism layers—entities,
use cases, interface adapters, and frameworks/drivers—governed by a dependency
rule: source dependencies point inward, and data crossing a boundary does not
carry an outer framework's types into an inner layer. Its intended outcomes
of framework, UI, database, and external-agency independence align directly
with C4, C5, and C7.

Option 4 can satisfy the hard constraints if the current CLI becomes an outer
interface adapter, the lifecycle is implemented as an application use case,
and Markdown/Git and agent operations remain outer details behind inward-owned
interfaces. It does not, by itself, define Parallix's launch/rollback ordering,
CLI compatibility, reconnect semantics, or durable-evidence rules; those
repository-specific contracts are still required. This is why C6 remains
unproven for the generic alternative rather than inheriting a `✓` from its
layer diagram.

The material difference from option 3 appears only if this mission establishes
more layers than its evidence supports. The article says the number of circles
is schematic, so a narrow application of Clean Architecture to these two
slices is effectively the selected ports-and-adapters boundary plus the same
inward dependency rule. A fuller interpretation would additionally separate
stable enterprise entities from application-specific use cases before the
repository has identified such reusable entity policy. That would increase C8
cost, encourage ceremonial wrappers around legacy helpers, and make an
incremental behavior-preserving extraction harder to review. The decision
therefore retains Clean Architecture's dependency discipline without adopting
its full layer vocabulary as a separate migration target.

The decisive trade-off is therefore not delivery speed. Option 3 accepts the
extra interfaces and composition wiring in C8 in exchange for satisfying the
five hard constraints while retaining a reversible path to the ADR 0044
database cutover. Option 5 remains outside this mission because the required
migration evidence belongs to that later implementation.

## Decision

Adopt a narrow **Hexagonal Architecture (Ports and Adapters)** boundary for
newly extracted behavior. The boundary is a target architecture and an
incremental migration rule; it is not a claim that all existing `lib/` modules
are already layered, nor authority to implement a web server, Ink UI, SQLite
authority, or a task-record migration.

This boundary applies Clean Architecture's compatible inward-dependency rule:
application policy owns the contracts and outer mechanisms depend on them. It
does not require a distinct entity layer until a selected slice demonstrates
stable domain policy that is genuinely independent of an application use case.

The first proof slices are deliberately different:

- the `stats-backfill` report, including its explicit `--apply` mutation
  boundary; and
- the `active` execute-launch lifecycle, including preflight, launch-before-
  record, rollback, post-launch synchronization, handoff, and exit semantics.

They exercise read projection, controlled mutation, long-running work, task
authority, and compatibility without making a command-family rewrite the
price of entry.

### Dependency direction

New modules introduced under this decision follow this direction:

```text
CLI adapter / Ink adapter / future web transport
                    |
                    v
application use cases and contracts
                    |
          domain policy and value rules
                    |
                    v
      application-owned ports (interfaces)
                    ^
                    |
task-Markdown, Git, agent/subprocess, Forgejo, filesystem,
configuration, statistics, and future SQLite/HTTP adapters
```

The arrows express dependencies, not process order. Interfaces translate input
and render results. Application use cases coordinate a request through ports.
Domain policy contains only rules that can be expressed without interface or
infrastructure dependencies. Adapters perform effects and translate external
failures; they do not choose lifecycle transitions or authorization policy.

### Relationship to controller/service/repository

Hexagonal Architecture is compatible with the controller/service/repository
style familiar from a Spring Boot backend; it makes different boundaries
explicit. A controller is normally an inbound adapter, a service commonly
contains the application use case, and a repository is one kind of outbound
adapter. This ADR does not prohibit that structure inside an adapter or use
case; it avoids letting a database-shaped repository become the only model for
all external dependencies.

| Concern | Controller/service/repository | Hexagonal Architecture in this ADR | Trade-off for Parallix |
|---|---|---|---|
| Entry point | A controller accepts HTTP input. | CLI, Ink, and future web transport are inbound adapters; each translates its input into the same use-case request. | Controller/service/repository is direct for a single HTTP API. Hexagonal needs explicit adapters, but avoids making HTTP the centre of a multi-interface tool. |
| Application behavior | A service coordinates business behavior, often called by a controller. | A use case coordinates the behavior and owns ports for dependencies. | These are often the same implementation in practice. Hexagonal adds naming and dependency discipline. |
| Persistence | A repository abstracts database access. | A task-catalog port can be implemented by Markdown/Git today or another store later; agent launch, Git, and Forgejo are separate ports rather than repositories. | Repository is concise for CRUD over one database. Ports fit this repository's heterogeneous effects, but can be over-engineering for simple reads. |
| Dependency direction | Often controller → service → repository, with frameworks influencing the outer layers. | Use cases depend on application-owned interfaces; adapters depend on the use cases and port contracts they implement. | The latter makes it easier to test a lifecycle with fake Git/agent/task adapters, but introduces more interfaces and wiring. |
| Testing | Services are commonly tested with mocked repositories; controllers with HTTP tests. | Use cases are tested with mocked ports; adapters are tested at their own boundary. | Both support fast unit tests. Hexagonal is useful here because the important dependencies are not only persistence. |

For the selected slices, the familiar mapping is: CLI handler ≈ controller,
application use case ≈ service, task-Markdown adapter ≈ repository adapter.
The additional ports are needed because `active` also depends on agent launch,
Git/worktree state, preflight, and handoff—dependencies that are not honest
repositories. If a later web board is a conventional Spring-style backend,
its controllers may simply be inbound adapters over these same use cases.

For this incremental extraction, existing policy stays where it is until a
named use case moves it with characterization tests. Do not manufacture a
"domain" wrapper around every existing helper. The application layer may call
a narrow adapter over established behavior while the policy remains unproven;
that adapter is a migration seam, not evidence that the legacy module is pure.

Only a composition root may construct a complete graph of concrete adapters.
The existing command modules may retain small, injected compatibility seams
during migration, but application services and their unit tests receive port
implementations explicitly. Application/domain modules must not import Ink,
React, HTTP frameworks, SQLite, `node:fs`, Git runners, Forgejo clients,
`node:child_process`, or terminal-rendering modules except as port type
definitions. An automated import-boundary test enforces this rule.

### Contract rules

The contracts are shared vocabulary, not a one-size-fits-all public protocol.
They are internal repository boundaries; ADR 0044 states that Parallix is not
currently an SDK.

**Commands.** A command request names a use case, validated input, caller
capabilities, and an optional cancellation signal. It returns one terminal
outcome: `completed`, `rejected`, `failed`, or `cancelled`, plus a typed value
or error and any durable evidence known at that point. The command owns
validation and policy before calling a mutation port. The CLI alone maps that
outcome to its existing text and exit code, so command-specific compatibility
is retained rather than flattened.

**Queries and projections.** Queries return immutable, source-labelled
projections. A projection may combine task, Git, review, and local telemetry
facts, but it identifies staleness or unavailable sources rather than
inventing a lifecycle state. It is view data: neither a mutable client store
nor a write model. `stats-backfill` must retain its current distinction between
the computed report and `--apply`.

Review is an ordered command conversation, not the mutable phase/disposition
snapshot used by the current file harness. A reviewer approves with an optional
comment or requests changes with findings. The implementer submits a complete
fixed/disputed resolution or requests human intervention. `PARKED` and
`BLOCKED` are legacy adapter inputs for that same intervention result; a
standalone reviewer comment is view/event data rather than a state command.

Each review round records a local review-conversation identity and exact commit
revision. An optional review surface contributes its key, opaque pull-request
ID, optional URL, and source/target branches; review without that surface
records local source and target branches. Forgejo is a local Docker-hosted
projection of this conversation, not a remote-service boundary. Approval and
integration promotion must name the same revision, not merely the same branch
or PR.
Reviewer assignment is accepted only from the user-configured `review`
eligibility policy. The application selects the next eligible reviewer after an
implementer resolution; neither the implementer nor the domain invents a
built-in fallback family. The explicit review step is required: neither a
general default policy nor legacy Claude/Codex defaults may be substituted when
it is absent or empty. Forgejo may adapt its PR response into these contracts
but is neither named nor required by the model.

Persistence ports are owned by the application layer, not the domain. The
domain model neither imports nor implements `MissionStore`; Markdown/Git and
the ADR 0044 database adapter can satisfy the same port without adding storage
concepts to `Mission`. Persistence authority remains owned by ADR 0044 rather
than being decided indirectly through the model.

A task adapter returns a typed unavailable/conflict result instead of a
partially valid mission. For the current Git topology, the committed integration
base owns lifecycle status and assignment, while an open mission worktree may
provide newer mission content. A committed `done` task remains unclosed while
that worktree exists. Only successful integration-base closeout plus worktree
removal permits the adapter to return a closed mission. PR-provider state is
absent from this materialization contract: Forgejo is an optional view surface,
and Parallix operates without it. An uncommitted working-tree move is likewise
not closure authority.

**Progress.** A use case may publish ordered, best-effort progress records
with an operation identifier, phase, timestamp, message, and terminal
outcome. Progress supports CLI streaming and future UI attention, but has no
replay or authority guarantee. On reconnect or uncertainty, a client
re-queries a projection and examines durable task/Git evidence. No client may
mark a task complete merely because it saw an agent or progress event.

**Failures.** Application errors distinguish at least validation,
authorization/capability, conflict or stale state, unavailable dependency,
execution failure, and cancellation. They carry a safe operator message and a
machine-readable kind; diagnostic causes remain adapter-local unless safe to
expose. The mapping must preserve the current `active` non-zero agent status
and existing CLI output/exit behavior. Failure categories are not permission
to auto-repair: ADR 0048's human-only classifications remain in force.

**Cancellation.** Cancellation is cooperative and only takes effect at
declared safe boundaries. Before an external action starts it can reject or
cancel. After an agent has launched or an authoritative transition has been
committed, the result must report the durable partial state and direct the
caller to re-query; it must never claim a rollback it has not performed. Each
extracted use case must state its safe boundaries in tests.

**Capabilities and authorization.** Interfaces request named capabilities;
the application checks them before mutation ports are called. This creates the
same future control point for CLI, TUI, and web transport. It does not claim
that the current local CLI has multi-user authorization: a web transport needs
its own threat model and transport authentication decision. Buttons and
drag/drop never receive direct filesystem, Git, SQL, or subprocess authority.

### Authority and board intent

The future board may show repository identity, an attention queue; backlog,
refined, active, review, integrate, and shipped views; agent availability; WIP
and cycle-flow signals; guarded lifecycle actions; and a command/event log.
This records the intended operator experience only. It does not adopt the
linked artifact's component structure, in-memory state, direct mutation path,
or styling as product architecture.

Board actions—including drag/drop—submit application commands. They must show
the returned outcome and refresh on stale-state conflict; they cannot move a
card by editing a local store or task file. A command/event log is diagnostic
history, not the source of truth for lifecycle state.

During this migration, canonical task records remain the Markdown files in
`backlog/tasks/`, `backlog/completed/`, and `backlog/archive/`, with Git-owned
mission and review artifacts retaining their existing roles. This is a
compatibility constraint until the ADR 0044 database cutover, not a long-term
authority decision. Board availability does not trigger that cutover. The
gated database migration replaces the task and mission write paths as one unit;
dual-write is not an accepted steady state.

## Consequences

### Positive

- New interfaces share application requests and projections without treating
  CLI text, browser memory, or an event stream as workflow authority.
- The `active` lifecycle can be characterized as a policy-preserving use case,
  including its durable ordering and exact failure behavior, instead of being
  re-created in each UI.
- Explicit ports convert the repository's current ad hoc function injection
  into a stable unit-test seam and keep external operations mocked in unit
  tests.
- The boundary supports an eventual local board while leaving security,
  hosting, and the ADR 0044 persistence cutover to their gated implementation
  missions.

### Negative and accepted costs

- Commands require translation code at both edges: CLI parsing/rendering and
  application request/result mapping. This is intentional compatibility work,
  not incidental boilerplate.
- The first application modules coexist with legacy orchestration. Boundary
  enforcement must be scoped to new domain/application paths until migration
  expands; applying it to all of `lib/` now would be a misleading claim.
- Progress is deliberately weaker than durable state. Interfaces must handle
  reconnect, stale data, and incomplete operations rather than assuming a
  real-time event feed is exact.
- Capability checks establish a policy seam but do not substitute for web
  transport security or an authority migration decision.

### Reliability measurement

The primary outcome metric is `completed bug missions / all completed missions`.
The companion ratio is `100 * completed bug missions / completed non-bug
missions`, which keeps increases visible when the total number of completed
missions changes. Historical eligibility requires a unique task ID under
`backlog/completed/` with a creation date after the observation start. Both
metrics use the exact `bug` label and union labels across duplicate completed
copies; neither uses title keywords or an inferred severity. Tasks that have
not completed are absent from both numerator and denominator.

After the application boundary is integrated, report the same two values after
each cohort of 20 missions reaches the completed store. Cohort order comes from
the durable completion transition, not task creation time. Once a mission
enters a cohort it remains there even if later reopened or archived, and a
later-added `bug` label updates that cohort's numerator so an early non-bug
classification does not permanently hide an escaped defect. Also list which
bug missions touch the extracted
`stats-backfill` or `active` slices; the overall frequency alone cannot
attribute causation to this architecture.

The decision may claim faster delivery as soon as speed is measured, but it
must not claim improved reliability until a post-integration cohort has a lower
completed-mission bug frequency than the 30.2% baseline and the report discloses its task
count and mix. One cohort is an early signal, not proof of a durable trend.

## Implementation and verification gates

No implementation begins merely because this ADR exists. After this ADR is
integrated, a human must approve the proposed implementation breakdown.
Implementation then proceeds in bounded steps:

1. Preserve the baseline calculation above as a reproducible task-catalog
   query and record the integration date that starts post-change cohorts.
2. Characterize the selected CLI behavior first: `stats-backfill` text, JSON,
   skipped/apply behavior; and `active` success, usage and preflight failures,
   launch ordering/rollback, handoff failure, and non-zero agent status.
3. Introduce only the contracts, narrow ports, and composition root needed by
   those slices. Use mocked ports in unit tests; no test may contact real
   Forgejo, launch an agent, or run an expensive external CLI.
4. Delegate the existing CLI handlers while retaining parsing, text/JSON
   rendering, and exit-code mapping at the edge. `active` gains no JSON option
   as part of this work.
5. Add import-boundary and behavior-equivalence tests. Run
   `./scripts/verify-local.sh all` and, for changes under `lib/`, the required
   `./scripts/verify-local.sh static-analysis` gate.
6. Publish the bug/non-bug comparison after each 20-completed-mission post-integration
   cohort. Speed or throughput measurements are reported separately and never
   offset an increased completed-mission bug frequency.

Rollback restores the previous CLI wiring and removes the new boundary modules
as one revert. It must not rewrite task Markdown, mission/review Git
artifacts, lifecycle policy, authorization behavior, text/JSON schemas, or
exit codes. Any need to implement a UI server, perform the ADR 0044 database
cutover, or broaden command families stops this plan for the corresponding
implementation mission.

## Reconsideration triggers

Revisit this decision, rather than extending it silently, if any of the
following becomes true:

- a proposed client needs a task writer outside the established
  `transitionTask` authority path;
- durable operation recovery requires replayable events rather than a
  projection re-query;
- multi-user or remote web access requires an authorization and threat model;
- the selected slices reveal a lifecycle rule that cannot be expressed through
  narrow ports without changing behavior; or
- two post-integration completed-mission cohorts fail to improve bug frequency, or bugs in
  the extracted slices show that policy can still be bypassed through an
  interface or adapter; or
- the board needs task authorship, concurrent editing, or persistence beyond
  a read projection.

## See also

- `docs/adr/0037-ai-workflow-coordination-architecture.md`
- `docs/adr/0044-workflow-distribution-model.md`
- `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`
- `backlog/completed/task-2277 - Prove-ADR-0044-local-runtime-bundle-Ink-and-SQLite-feasibility.md`
- `backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md`
- `backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md`
- `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md`
- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
