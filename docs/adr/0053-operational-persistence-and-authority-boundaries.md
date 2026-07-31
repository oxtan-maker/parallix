# ADR 0053: Operational persistence and authority boundaries

Status: Accepted; cutover requires explicit migration and recovery gates
Date: 2026-07-29
Related: ADR 0043 (Git target resolution), ADR 0045 (branch model),
ADR 0051 (application and UI boundary)

## Context

Parallix needs durable answers to questions that cannot be reconstructed
reliably from task files, process presence, aggregate statistics, or a review
provider:

- which repository owns a mission;
- which lifecycle and closure state the mission is in;
- which agent work measurements and provider session marker belong to a mission;
- which review, checkpoint, and change-size facts belong to the mission; and
- which operator settings and operational events must survive a restart.

These are Parallix-owned operational facts. Source history, integration
ancestry, worktree presence, external task content, provider availability, and
credentials are facts owned by other systems.

The persistence decision must support atomic mission transitions, stale-write
rejection, a cross-repository operator board, backup and recovery, and one
authoritative writer per fact. It must not turn task frontmatter into the
operational aggregate, invent domain entities through table design, or treat a
database projection as proof of a Git or process fact.

## Storage topology

| Option | Atomic mission updates | Cross-repository queries | Repository movement | Operational cost | Decision |
|---|---|---|---|---|---|
| Git/Markdown remains the operational store | Weak: related facts span files and commits | Requires scanning repositories | Strong when files are committed | Merge conflicts, parsing ambiguity, and no transaction across lifecycle, checkpoint, and review updates | Rejected |
| One operator-local SQLite database | Strong: Mission and its recorded event can share a transaction | Direct | Requires explicit backup/export and repository rediscovery | One migration, locking, backup, and recovery boundary | **Accepted** |
| Repository-local mission databases plus an operator database | No atomic transaction across mission and operator telemetry | Requires opening and reconciling many databases | An untracked database does not move with Git; a tracked SQLite file does not merge safely | Two authority classes, locators, migration paths, and backup plans | Rejected |
| One database per worktree | Updates are isolated from sibling worktrees | Requires fan-out and reconciliation | Coupled to disposable runtime directories | Creates duplicate mission authorities | Rejected |
| Append-only event log as the sole store | Atomic append is simple | Direct after projection | Same as its storage location | Current state depends on complete replay, event versioning, and repair tooling | Rejected as the primary store; events remain supporting history |

## Decision

Use one SQLite database at:

```text
<PARALLIX_HOME>/parallix.db
```

The database is the sole write authority for Parallix-owned operational state
after each domain completes its explicit cutover. It is never created in a
target repository, worktree, package, or executable directory.

Persisted names and relationships follow the checked domain model:

```text
Mission (repositoryId: RepositoryId)
  ├── CheckpointData
  └── Review

MissionOutcome (missionId, repositoryId)
  └── AgentRunMeasurement

KnownRepository
SessionMarker
LaneTransitionEvent
AgentBlock
```

This ADR does not introduce `Attempt`, `RepositoryAlias`, `ImportRecord`,
`Process`, or `Worktree` as domain entities. Persistence tables and repository
ports may carry technical keys and metadata, but those do not create domain
concepts by naming convention.

Every boundary in `ADR0053_PERSISTENCE_INVENTORY` classified
`database-owned-domain-state` resolves, in checked code, to exactly one of a
named domain type with its invariant or an item on the explicit
technical-persistence-metadata list
(`src/application/persistence-domain-map.ts`), enumerated by
`test/persistence-domain-mapping.test.ts`. The consumers that justify each
concept are traced with `file:line` citations in
`src/application/consumer-domain-requirements.ts`.

Application use cases decide domain transitions. SQLite persists their result;
SQL does not decide lifecycle, approval, or closure. CLI, TUI, and web
interfaces use application ports and never execute lifecycle SQL directly.

## Domain decisions

| Domain concern | Database role | Rejected alternative | Tradeoff |
|---|---|---|---|
| `RepositoryId` and `KnownRepository` | **Authoritative for the `RepositoryId` referenced by Mission; cache-only for repository-selector entries and observed paths.** | Invent a richer Repository aggregate or `RepositoryAlias` entity in the schema. | Uses the identity the domain already exposes without pretending that path discovery has domain rules it does not have. |
| External tasks and planning documents | **Excluded as aggregates.** Store only an optional external reference and the mission metadata accepted into Parallix. | Import the complete task catalog and make task rows operational authority. | Keeps Backlog or another customer system independent, but Parallix cannot reconstruct external task content when that source is unavailable. |
| `Mission` identity and descriptive fields | **Authoritative.** Persist `id`, `repositoryId`, `title`, and `labels`; an external task reference is adapter metadata, not a Task entity. | Re-read mutable task frontmatter on every operation. | Mission behavior is stable after intake, but later external edits require an explicit application command or import policy. |
| `Mission.status`, `rawStatus`, `assignee`, and `closedAt` | **Authoritative.** Persist the existing lifecycle fields and explicit closure with optimistic concurrency metadata at the repository boundary. | Infer state from task placement, branch names, process absence, or statistics. | Enables atomic and stale-safe transitions without adding lifecycle concepts not present in `Mission`. |
| `CheckpointData` and `GoalCheckRow` | **Authoritative as nested Mission data.** Persist the checked structure and replacement order. Large source documents may remain referenced artifacts. | Treat checkpoint filenames or Git history as the only current model. | Gives the application a queryable current checkpoint while preserving large evidence outside the database. |
| `Review`, `ReviewRound`, findings, resolutions, interventions, and reviewed revisions | **Authoritative as nested Mission data.** | Let Forgejo, another provider, or mutable review JSON own the conversation. | Review works without a provider and approval stays tied to an exact revision; provider synchronization becomes projection work. |
| `AgentRunMeasurement` and `MissionOutcome` | **Authoritative measurement data, and the cut-over is done.** `<PARALLIX_HOME>/parallix.db` is the sole live authority, reached through `MeasurementStorePort` (`src/application/measurement-ports.ts`) and `SqliteMeasurementStore` (`src/adapters/sqlite/measurement-store.ts`); a measurement is keyed by `(repo, mission, stage, actor)`. `Measurement.unavailable` is preserved as SQL NULL instead of an invented zero, and `CompletedMissionStatistics` stays derived. `stats.csv` survives only as an explicit, operator-invoked, read-only import/analysis input (`px stats import-legacy --csv-file <path>`); no default run resolves, reads, or writes it, and an unavailable database fails the command rather than falling back. | Store a CSV-shaped statistics authority, keep a file fallback, or infer a launch identity from measurements. | Retains the dimensions the domain models, but cannot answer per-launch identity questions the model does not represent. |
| `SessionMarker` | **Authoritative for the last recorded resumability marker, not for provider availability.** | Keep the only session identity in a worktree file or invent an Attempt to own it. | Resume metadata survives worktree cleanup, while the provider still decides whether the session can resume. |
| `Attempt` | **Excluded.** The decision is now enforced rather than asserted: no checked production domain type defines its identity, lifecycle, or relationship to `AgentRunMeasurement` and `SessionMarker`, and no current launch, retry, failover, usage, review, or UI consumer requires durable per-launch identity. Retry/failover bookkeeping is process-local (`src/platform/runtime/lib/agents/agents.ts:198`), a launch leaves only a family-keyed `AgentBlock` and one replaceable `SessionMarker`, and measurements are grouped by `(repo, mission)` (`src/platform/runtime/lib/commands/stats.ts:437`). `test/domain-attempt-guard.test.ts` fails if any Attempt-shaped type, table, or record is declared under `src/domain`, `src/application`, or `src/adapters`. | Create attempt tables from the desired persistence shape first. | Avoids another schema-led domain model; failover history remains limited until the domain introduces and tests this concept. |
| Process liveness, PIDs, and worktrees | **Excluded as durable entities.** Observe them from the OS, Git, and filesystem. | Persist a Process or Worktree row and treat it as proof that the resource still exists. | Avoids stale infrastructure truth; restart recovery must re-observe external state. |
| `Mission.netEngineeringLines` and `CompletedMissionStatistics` | **NEL is authoritative Mission data; completed statistics are derived from `Mission` and `MissionOutcome`.** | Duplicate closure, implementer, labels, and NEL into an independent statistics authority. | Prevents reporting data from competing with the Mission aggregate; analytical queries may require joins or maintained projections. |
| Lane-transition events and operational history | **Authoritative for the event history itself, never for current Mission state.** Write events in the same transaction as the state change they describe. | Replay events as the lifecycle authority or write telemetry best-effort after the transition. | Produces reliable metrics without creating a second current-state model; event retention must be managed. |
| `AgentBlock` and operator preferences | **Authoritative.** They describe operator-owned durable choices. `AgentAvailability` and `AgentSelectionSnapshot` remain materialized observations, not stored truth. | Persist the entire selection snapshot or keep mutable JSON beside repositories. | Durable choices survive restart without freezing launcher availability or configuration observations. |
| Repository lists and board/read projections | **Cache only when materialized.** Rebuild them from authoritative rows and external observations. | Let a UI cache or denormalized board row accept lifecycle writes. | Fast reads remain possible without adding another mutation path. |
| Schema and import history | **Authoritative internal metadata.** Record migration IDs/checksums and idempotent import identities. | Infer migration/import completion from files or partial row presence. | Recovery and duplicate prevention become testable, with additional metadata and backup requirements. |
| Git commits, branches, ancestry, integration existence, and worktree presence | **Excluded.** Git and the filesystem remain authoritative; the database stores validated references such as an integration commit OID. | Copy Git topology into SQLite and trust the copy during transitions. | Preserves Git semantics and avoids stale topology, but transitions must observe Git before committing their resulting domain fact. |
| Workflow configuration, prompts, schemas, gates, and agent-selection policy | **Excluded.** Keep user-authored policy in repository files and built-ins in executable assets. | Copy configuration into mutable database rows. | Configuration remains reviewable and distributable; application reads must materialize it before pure policy runs. |
| Secrets and raw credentials | **Excluded.** Use environment, platform credential storage, or provider tooling. | Store credentials with operational records. | A database backup does not become a credential archive; credential setup remains a separate concern. |
| Logs, patches, captures, and large artifacts | **Reference only.** Keep content in the filesystem or owning tool. | Store unbounded blobs in the operational database. | Database backup and locking remain bounded, while artifact retention must be coordinated separately. |
| Permissions and operator-request workflows | **Excluded until they have real domain rules and consumers.** | Add tables because a future UI might need them. | Avoids speculative schema and policy; adding them later requires a deliberate domain decision. |

## Transaction and authority rules

1. One application transaction updates every database-owned fact affected by a
   command. A Mission transition and its `LaneTransitionEvent` commit together.
2. Mission writes require the expected version or lifecycle. A stale caller
   receives an explicit conflict and changes nothing.
3. Git, filesystem, OS, and provider prerequisites are observed before the
   database transaction. Their references are recorded, but the database does
   not replace those external facts.
4. Current Mission state is read from Mission rows, not reconstructed from
   events, usage, task files, UI caches, or provider projections.
5. Database unavailability or corruption fails closed for database-owned
   mutations. Parallix does not silently write a compatibility file instead.
6. Imports validate all records before committing, are atomic and idempotent,
   record source identity and digest, preserve newer canonical state, and report
   ambiguity rather than manufacturing domain entities or closure.
7. Migrations are ordered and checksum-protected. Multi-statement changes are
   transactional. Backup, restore, interruption, concurrency, and export/import
   behavior are release gates.

## Cutover

Existing file-backed domains remain compatibility authorities until their
named migration gate passes. A domain cuts over all reads and writes together.
There is no steady-state dual-write or fallback writer.

`Mission` intake, activation, checkpoint evidence, and NEL recording run through
checked application use cases over one Mission repository port
(`src/application/mission-intake-service.ts`,
`src/application/mission-lifecycle-service.ts`,
`src/application/mission-checkpoint-service.ts`,
`src/application/mission-handoff-service.ts`). Production selects exactly one
implementation of that port — the compatibility store over the task document,
`CP-N.md` evidence, and `nel-record.json`
(`src/adapters/backlog/compatibility-mission-store.ts`) — and the SQLite Mission
adapter is exercised only by isolated test fixtures until the Mission gate
passes. Accepted external material is carried as one `ExternalTaskRef` value
(`src/domain/external-task.ts`), and generated evidence is carried as
`ArtifactReference` locators (`src/domain/net-engineering-lines.ts`), which
reject inlined content.

`AgentBlock` has passed that gate: `agent_blocklist` is its runtime authority.
Legacy `agents.local.json` block entries are accepted only by the explicit
dry-run/import command path; static agent policy and launcher discovery remain
file-backed inputs, and a checked-repository failure is surfaced to the caller.

After Mission cutover, external task material remains an intake source and
reference, not a lifecycle mirror. Generated Markdown, JSON, CSV, provider, and
board views are rebuildable projections.

Cutover may be staged by domain dependency:

1. `RepositoryId` references and `KnownRepository` cache migration;
2. `Mission` with `CheckpointData`, `Review`, NEL, concurrency metadata, and
   closure;
3. `AgentRunMeasurement`, `MissionOutcome`, `SessionMarker`, and `AgentBlock`;
4. transactional `LaneTransitionEvent` history and derived read projections.

## Consequences

Positive:

- Mission closure and event recording can be atomic.
- Cross-repository CLI and board queries use one database boundary.
- External task systems, Git, providers, and Parallix each retain one explicit
  authority.
- Worktree cleanup and checkout movement do not erase operational history.

Costs:

- The operator database is critical state and requires tested backup, export,
  restore, corruption recovery, and concurrency behavior.
- Mission history does not automatically travel to another machine; moving it
  requires an explicit Parallix backup or export.
- Per-launch failover history remains unavailable until a checked domain model
  introduces it; persistence is not allowed to fill that gap by inventing an
  `Attempt` table, and `test/domain-attempt-guard.test.ts` blocks that route.
  The one durable per-launch value in the tree — the review-loop stage-launch
  fingerprint — is recorded as an idempotency key on the
  technical-persistence-metadata list, not as an entity.
- A single local database is not a multi-user coordination service.

## Reconsideration triggers

Revisit this decision if Parallix becomes multi-user or remotely coordinated,
if one operator database cannot meet measured concurrency or recovery needs, or
if mission state must travel through ordinary Git clone/pull without an
explicit Parallix export. Introducing a checked `Attempt` domain model also
requires revisiting the measurement and session-marker rows in this ADR.

## References

- `src/domain/mission.ts`
- `src/domain/external-task.ts`
- `src/domain/net-engineering-lines.ts`
- `src/domain/review.ts`
- `src/domain/checkpoint.ts`
- `src/domain/usage.ts`
- `src/domain/session.ts`
- `src/domain/board-event.ts`
- `src/domain/agents.ts`
- `src/application/domain-ports.ts`
- `src/adapters/backlog/compatibility-mission-store.ts`
- `src/application/consumer-domain-requirements.ts`
- `src/application/persistence-domain-map.ts`
- `docs/adr/0051-ui-neutral-application-boundary.md`
