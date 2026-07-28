---
id: TASK-2322
title: recover agent slop alinging with domain design
status: backlog
assignee: [codex]
created_date: '2026-07-28 14:19'
labels: []
dependencies: []
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
# Mission: Implement mission-centric SQLite persistence from the accepted domain design

## Goal

Implement durable Parallix operational state around the domain relationship `Repository → Mission → Attempt`.

Persist mission lifecycle, explicit mission closure, current and completing attempts, attempt history, agent identity, termination information, and usage through application services backed by SQLite.

Preserve the current Backlog.md task-file behaviour (or customer extranal inpput) as an external planning and intake adapter. Do not make task Markdown records, a task catalog, or a serialization model the Parallix operational aggregate.

## Why Now

The previous task-catalog cutover direction (2315, 2316) conflated Backlog task metadata with Parallix mission execution state.

Parallix needs to answer these independently:

* What lifecycle state is the mission in?
* Is the mission explicitly closed?
* Which attempt is working on it now?
* Which attempt ultimately completed it?
* Which earlier attempts ended or failed over?
* What agent, provider, model, session, usage, and termination result belong to each attempt?
* What should the UI show as active now, independently of the mission lifecycle value?

The persistence model must express those concepts directly rather than infer them from task-file fields or aggregate CSV rows.

## Domain Contract

### Repository

A repository is the stable owner of missions.

Persist:

* stable generated repository ID;
* optional display name;
* creation timestamp.

Repository locations may be represented by aliases that map filesystem paths to the stable repository ID.

Do not persist worktrees as domain entities. Worktree paths remain runtime and Git implementation details.

### Mission

A mission belongs to one repository.

Persist at minimum:

* mission ID or slug;
* repository ID;
* optional external task reference;
* lifecycle;
* opened timestamp;
* closed timestamp;
* current implementer attempt ID;
* completing attempt ID;
* integration commit OID;
* optimistic version or equivalent stale-transition protection.

The valid lifecycle values are:

```text
backlog → draft → active → review → integrate → done
```

Mission lifecycle and live execution state are separate concepts.

A mission in `active` may temporarily have no running process. A running reviewer attempt does not change the mission into an implementer state. UI attention indicators must be derived from mission and attempt data rather than persisted as additional mission lifecycle values.

### Attempt

An attempt belongs to one mission and has a stable identity that is never reused.

Persist at minimum:

* attempt ID;
* mission ID;
* sequence number;
* role: implementer or reviewer;
* agent family;
* provider;
* model when known;
* external session identifier when known;
* attempt status;
* started timestamp;
* ended timestamp;
* last observed activity or heartbeat timestamp;
* termination reason;
* exit code when available.

Failover creates a new attempt. It never edits the identity or usage of the preceding attempt.

### Attempt Usage

Usage belongs to an attempt rather than directly to a mission or task.

Persist the structured telemetry Parallix actually has, without inventing values for providers that do not expose it.

### Supporting Operator State

The implementation may persist the already designed operator-owned state required by the workflow, including:

* timed agent blocks;
* operator preferences;
* completed import records.

Do not introduce permissions, operator-request workflows, persistent process entities, or worktree entities.

## Application Services

Domain mutations must be expressed as application use cases, such as:

* create or import mission;
* transition mission lifecycle;
* start attempt;
* record attempt activity;
* end attempt;
* fail over implementer;
* record attempt usage;
* select completing attempt;
* close mission after integration.

CLI commands and runtime tools call these application services. They must not execute lifecycle SQL directly.

SQLite repositories persist the resulting state; SQLite does not independently decide or perform domain transitions.

A lifecycle transition must validate the expected current lifecycle or mission version. A stale caller must receive an explicit conflict rather than overwrite newer state.

## Failover Invariant

When an implementer fails over from Claude to Codex, one atomic application operation must:

1. end the Claude attempt with its actual termination reason;
2. preserve all Claude usage and session history;
3. create a new Codex implementer attempt;
4. point `Mission.current_implementer_attempt_id` to the Codex attempt.

The Claude attempt remains queryable and immutable except for any final telemetry that legitimately arrives after termination.

## Closure Invariant

Transitioning a mission to `done` must record explicit closure.

The completing attempt may differ from earlier implementer attempts.

The system must not infer closure solely from a task status, the presence of partial usage rows, a checkpoint, or the absence of a running process.

## Import

Provide an explicit, one-time import use case for legacy operational data.

The import must:

* validate all source records before committing;
* run atomically;
* record source identity and a content hash or equivalent import key;
* be idempotent;
* preserve attempt history where the source contains enough information;
* report ambiguous records instead of manufacturing certainty;
* leave no partial imported state when validation or persistence fails.

Do not trigger a full legacy import from `px draft` or another routine lifecycle command.

Do not overwrite existing canonical mission or attempt state by rerunning an import.

Task Markdown may supply an optional task reference or initial descriptive metadata, but it must not become the Mission or Attempt aggregate.

## Read Model

Provide a query/read model sufficient for the terminal UI to show separately:

* mission lifecycle;
* whether the mission is closed;
* current implementer;
* current attempt status and last activity;
* current reviewer when applicable;
* previous failed or ended attempts;
* blocking or attention-requiring conditions derived from persisted facts.

Flags such as `agent_stuck`, `gate_failed`, `waiting_human`, and `review_blocking` (these are examples check the real ones in repo) are derived projections unless a later domain decision establishes them as durable facts.

## Scope

* Define the Mission and Attempt domain types and invariants.
* Add ports for mission, attempt, usage, repository, alias, and import persistence.
* Implement SQLite adapters behind those ports.
* Add application services for lifecycle, attempt start/end, failover, usage, and closure.
* Add explicit atomic import of existing operational records.
* Wire the existing CLI workflow through the application services without changing documented command behaviour.
* Add a minimal UI-oriented read model proving lifecycle and live attempt state can be queried separately.

## Out of Scope

* Replacing Backlog.md task authority.
* Creating a canonical SQLite task catalog.
* Moving a Markdown parser or serializer into the domain layer.
* Reverse-export or bidirectional synchronization of task files.
* Persisting worktrees.
* Modelling permissions or operator requests.
* Reworking Forgejo, review publication, checkpoint formats, or integration gates.
* TUI interaction fixes unrelated to the new model.
* Repairing unrelated Backlog records.
* General build-system changes not required by the added source files.

## Success Criteria

### SC1: Domain shape

Production domain code contains explicit Repository, Mission, and Attempt concepts.

No production domain type treats Markdown frontmatter, task-file sections, or task serialization as the Mission or Attempt model.

### SC2: Mission lifecycle

Automated tests demonstrate every supported transition in:

```text
backlog → draft → active → review → integrate (or whatever its called in the domain) → done
```

Invalid and stale transitions fail without changing persisted state.

The transition is performed through an application service and one atomic persistence operation.

### SC3: Implementer failover

An automated test starts a Claude implementer attempt, records usage, ends it because of a usage limit, starts a Codex attempt, and verifies:

* both attempts remain stored;
* Claude usage remains attached to the Claude attempt;
* the Claude termination reason remains stored;
* the mission points to Codex as the current implementer;
* no task assignee or scalar implementer field is used as attempt history.

### SC4: Explicit closure

An automated integration test completes and integrates a mission and verifies that `done`, and meta data are stored consistently.

A negative test proves that a partially delivered or interrupted mission is not considered closed merely because no process is running or a task file says `done`.

### SC5: Lifecycle versus live execution

A query test demonstrates that mission lifecycle and attempt execution status are independently available.

At minimum, it covers:

* an `active` mission with a running implementer;
* an `active` mission between attempts;
* a `review` mission with a running reviewer;
* a closed `done` mission with no running attempt.
* 
* (and/or updates better assertions on existing e2e tests with mocked agent)

### SC6: Stable repository identity

A repository receives a stable generated ID.

Registering another path alias for the same main repository resolves to that ID without creating a second repository.

No worktree table or persistent worktree record is introduced.

### SC7: Atomic import

Tests demonstrate that the legacy import:

* commits all valid records or none;
* records a completed import identity;
* is idempotent;
* does not run as part of routine `px draft`;
* does not overwrite newer mission or attempt state;
* reports records whose closure or attempt ownership cannot be established.

### SC8: Compatibility and scope

Existing documented `px draft`, `px active`, `px review`, and `px integrate` behaviour remains covered by characterization or lifecycle tests.

Only output modes that actually exist in the documented command contracts are tested.

The final diff contains no unrelated task repairs, task renumbering, TUI fixes, or task-catalog authority changes.

## Checkpoints

### CP 1: Reconfirm the domain boundary

* Reconcile this mission with the accepted domain-design ADR.
* Add domain types and invariant tests before SQLite implementation.
* Record the exact existing CLI call sites that will invoke the application services.
* Stop if the ADR currently identifies TaskRecord or task catalog as the operational aggregate; correct the ADR first.

### CP 2: Persistence ports and adapters

* Add Repository, RepositoryAlias, Mission, Attempt, AttemptUsage, and ImportRecord ports.
* Implement SQLite adapters.
* Prove repository identity and mission/attempt round trips.
* Do not wire CLI commands yet.

### CP 3: Application services

* Implement lifecycle transitions.
* Implement attempt start, activity, end, and failover.
* Implement usage recording.
* Implement explicit mission closure.
* Prove transactionality and stale-transition rejection.

### CP 4: Import and read model

* Implement the explicit one-time import.
* Add atomicity and idempotency tests.
* Add the lifecycle-plus-live-attempt query model.
* Preserve ambiguity rather than inferring unsupported history.

### CP 5: Workflow wiring and verification

* Route the existing lifecycle commands through the application services.
* Run the existing workflow and integration tests.
* Verify that task-file behaviour has not been cut over or redesigned.
* Record evidence for every success criterion.

## Restricted Areas

* Do not introduce `task_catalog` as the workflow aggregate.
* Do not put `assignee` or scalar `implementer` fields on a task row and use them as execution truth.
* Do not infer mission closure from status alone.
* Do not overwrite an attempt during failover.
* Do not persist permissions, operator requests, or worktrees.
* Do not execute lifecycle SQL outside SQLite adapters.
* Do not silently fall back to another authority after a persistence error.
* Do not trigger legacy import from ordinary lifecycle commands.
* Do not broaden the mission to unrelated defects or build changes.

## Stop Rules

* Stop if the accepted ADR and this mission disagree about the Mission and Attempt aggregate boundary.
* Stop if a prerequisite is not present on the mission parent commit.
* Stop if existing code requires task-catalog authority changes to complete this mission; split that into a separate design decision.
* Stop if an import cannot be atomic or idempotent.
* Stop if preserving an existing command requires inventing an undocumented output mode or changing unrelated workflows.
* Stop when an unrelated failing gate is encountered; record it and create a separate defect rather than repairing it inside this mission.

## Gates

* [ ] Domain and application-service tests
* [ ] SQLite adapter and import tests
* [ ] Existing mission lifecycle tests
* [ ] `./scripts/verify-local.sh static-analysis`
* [ ] `./scripts/verify-local.sh all`
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
