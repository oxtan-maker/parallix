# ADR 0053: Operational persistence and authority boundaries

Status: Accepted
Date: 2026-07-29
Last updated: 2026-09-16
Related: ADR 0037 (workflow coordination), ADR 0043 (Git target resolution),
ADR 0045 (branch model), ADR 0048 (fail-closed harness),
ADR 0051 (application and UI boundary)

## Context

Parallix needs durable answers to operational questions that cannot reliably be
reconstructed from task files, branch names, process presence, aggregate
statistics, generated Markdown, or a review provider:

* which repository owns a mission;
* which lifecycle and closure state the mission is in;
* what execution context an agent requires to continue the mission;
* which checkpoint and Goal Check evidence has been recorded;
* which review rounds, findings, resolutions, and decisions belong to the mission;
* which measurements and session markers belong to it; and
* which operator choices and operational events must survive restart.

These are Parallix-owned operational facts.

Other facts have existing external authorities:

* Git owns commits, trees, branches, ancestry, and repository history;
* the operating system owns current process liveness;
* external task systems own their source task material;
* providers own their external resources;
* credential systems own secrets.

ADR 0053 originally moved Parallix-owned operational authority from repository
files into one SQLite database. That solved the authority and transaction problem,
but the resulting implementation retained a large number of generated file
projections.

In particular, Mission and review state can be authoritative in SQLite while
still causing `MISSION.md`, `CP-*.md`, review-event Markdown, task files, and
other workflow material to accumulate in the target repository.

That distinction is technically consistent — one copy can be authoritative and
another a projection — but operationally it retains much of the cost of the
file-backed architecture:

* the repository becomes dominated by records of workflow execution rather than
  the product;
* humans and agents have to distinguish authoritative content from generated
  views;
* agents spend context discovering which workflow files matter;
* every mission creates Git churn unrelated to the delivered product;
* generated projections create synchronization and retention questions even
  when production never reads them; and
* a fresh reader cannot understand the current architecture or product without
  filtering large amounts of historical workflow metadata.

Agents still require this information. The requirement is therefore not to
remove mission context or evidence, but to separate **persistence** from
**presentation**.

The persistence decision must support:

1. one authority for each operational fact;
2. atomic mission transitions;
3. stale-write rejection;
4. rich read/write context for agents and humans;
5. compact target repositories;
6. explicit backup and recovery;
7. external authorities remaining authoritative for their own facts; and
8. no speculative domain entities created only because a storage schema makes
   them convenient.

## Storage topology considered

| Option                                                                                                                                              | Atomic operational updates                 | Agent/human readability                                 | Repository footprint                | Authority clarity                                                 | Operational cost                                           | Decision               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------- |
| Git/Markdown remains the operational store                                                                                                          | Weak: related facts span files and commits | High for individual files, poor for whole-state queries | High and grows with every mission   | Weak: file layout becomes domain protocol                         | Parsing, merge conflicts, scans and Git churn              | Reject                 |
| SQLite authority plus routinely committed Markdown/JSON projections                                                                                 | Strong in SQLite                           | High                                                    | Still high and continuously growing | Better than Git authority, but two durable representations remain | Projection generation, retention and synchronization cost  | Reject as steady state |
| Store all runtime facts, Git state, logs, artifacts and secrets in SQLite                                                                           | Strong locally                             | Requires application tooling                            | Low repository footprint            | Poor: database copies facts owned elsewhere                       | Unbounded DB, stale external truth, credential risk        | Reject                 |
| Repository-local or worktree-local databases                                                                                                        | Strong inside one DB                       | Good                                                    | Low                                 | Weak across repos/worktrees                                       | Multiple authorities, reconciliation and backup complexity | Reject                 |
| **One operator-local SQLite database for bounded Parallix-owned state, with application-owned projections and external references for other facts** | **Strong**                                 | **High through deterministic context/export surfaces**  | **Low**                             | **Explicit authority per fact**                                   | Backup/recovery plus context/query tooling                 | **Accept**             |

The accepted option is the only one that simultaneously keeps mission context
rich, avoids turning the product repository into an operational ledger, and
preserves Git/OS/provider authority where those systems already own the truth.

## Decision

Use one SQLite database at:

```text
<PARALLIX_HOME>/parallix.db
```

as the sole durable authority for **bounded Parallix-owned operational state**.

The database is never stored inside a target repository or disposable worktree.

Application/domain contracts define the concepts being persisted. SQL schema
does not introduce a domain concept merely because a table would be useful.

Application use cases decide transitions. Persistence records their result.
Interfaces, adapters, and agents do not acquire lifecycle authority by directly
mutating SQL.

### Core persistence rule

A fact does not remain repository-backed merely because a human or agent
benefits from reading it as Markdown.

**Presentation format and persistence format are separate concerns.**

Likewise:

**Rebuildable does not mean routinely materialized.**

A projection of authoritative state is normally rendered when needed rather
than committed to the target repository.

## Authority boundaries

| Concern                                                                          | Authority                                                                  | Repository/file role                                                                                    | Trade-off                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `RepositoryId` and `KnownRepository`, Mission identity, title, labels, assignee, lifecycle and closure | SQLite-backed Mission state                                                | None required for normal operation                                                                      | Mission history requires Parallix backup/export rather than plain Git clone    |
| Mission execution context                                                        | SQLite-backed Mission state                                                | May be rendered as Markdown/JSON on demand                                                              | Requires a bounded representation rather than arbitrary mission documents      |
| `CheckpointData` and `GoalCheckRow`                                              | SQLite-backed Mission state                                                | Legacy `CP-*.md` may be explicit import/export only                                                     | Agents cannot rely on `cat CP-1.md`; they use the application context surface  |
| `Review`, rounds, findings, resolutions, disposition, phase and review events    | SQLite-backed Mission state                                                | Temporary agent artifacts may transport data; committed review-event exports are not normal persistence | Review history no longer appears automatically in Git                          |
| `Mission.netEngineeringLines`, `MissionOutcome` and `AgentRunMeasurement`                 | SQLite                                                                     | Explicit analysis/export only                                                                           | Analytical tooling uses queries/exports instead of canonical CSV files         |
| `SessionMarker`, `AgentBlock`, durable operator preferences                      | SQLite                                                                     | None required                                                                                           | Provider/runtime availability must still be observed separately                |
| Reusable verification proof (the trust marker that lets a later command skip a gate) | SQLite                                                                 | None; today's per-identity proof file is a migration target                                             | Proof loss costs a gate re-run, so no export or backup beyond the database is required |
| `LaneTransitionEvent` and operational history                                   | SQLite supporting history                                                  | None required                                                                                           | Event retention becomes a DB policy                                            |
| Git commits, trees, refs, ancestry and worktrees                                 | Git/filesystem                                                             | Git remains authoritative                                                                               | Commands must observe Git before persisting resulting Mission facts            |
| Process liveness and PIDs                                                        | OS/runtime                                                                 | None                                                                                                    | Restart recovery re-observes reality instead of trusting stale rows            |
| External task source material                                                    | Owning task provider                                                       | Repository files are valid only when that provider intentionally uses files                             | Parallix cannot reconstruct arbitrary external task content from Mission state |
| Parallix-local task catalog, if a local provider is selected                     | Task-provider persistence behind the task-source port; SQLite is permitted | No requirement for `backlog/tasks` or `backlog/completed`                                               | Task-source state remains separate from Mission lifecycle semantics            |
| Workflow configuration, prompts, schemas, checked policy                         | Versioned repository/package content                                       | Git is appropriate authority                                                                            | Configuration changes travel with the product                                  |
| Secrets and credentials                                                          | Environment/platform/provider tooling                                      | Never normal repository or operational-DB state                                                         | Separate credential setup remains necessary                                    |
| Logs, patches, captures, transcripts and other unbounded artifacts               | Filesystem/artifact store/owning tool                                      | Reference from SQLite where needed                                                                      | Artifact retention must be managed separately                                  |
| Board views, Markdown, JSON, CSV and other projections                           | Derived from authoritative state                                           | On demand or explicit export only                                                                       | Rebuilding views requires working application/query tooling                    |

### Mission execution context

Mission context is operational state, not merely documentation.

Parallix persists the bounded information required for a new agent to understand
and execute the mission, including where applicable:

* goal;
* relevant context / why the mission exists;
* scope and constraints;
* refinement and sizing signals;
* declared mission-specific gates;
* checkpoint evidence;
* outstanding review findings and previous resolutions; and
* other bounded execution facts with demonstrated workflow consumers.

The model should represent these concepts directly.

The accepted design is **not** to move the contents of `MISSION.md` into one
opaque `mission_markdown` database column. That would preserve the file
architecture while merely changing its storage medium.

When an agent starts, the application assembles the relevant Mission data with
other current authorities such as Git observations, repository policy,
verification information, and external task context. It may render the result
as Markdown for the agent without writing or committing a `MISSION.md`.

### Checkpoint evidence

`CheckpointData` and `GoalCheckRow` are durable Mission evidence.

The existence or committedness of `CP-N.md` is not the authority for that
evidence.

A file may still be used:

* as an explicit legacy import;
* as a caller-requested export; or
* as temporary subprocess transport.

Normal checkpoint recording goes through the Mission application boundary and
persists the checked structure.

### Review evidence

Review state and review events are durable Mission data.

The current pattern:

```text
SQLite write
    -> render review event Markdown
    -> git add
    -> git commit
```

is not part of the steady-state architecture.

Agents that need prior review discussion receive it from the application-owned
context projection. Humans receive it through CLI/TUI/web/query/export surfaces.

Single-use agent artifacts may remain temporary transport where the agent runner
requires files.

### Trust markers

A marker whose presence grants trust is operational state, not a by-product.

The reusable verification proof is bounded Parallix-owned state: its identity is
a digest of the gate command, the tracked-input fingerprint, the toolchain, and
the verified commit and tree, and integration refuses to publish without a
matching proof. It belongs in the database on the same terms as any other
operational fact. Its fail-closed semantics do not change with the store: a
missing, malformed, or mismatched proof blocks publication.

Evidence that work happened is likewise a database fact. The presence of a
mission or checkpoint file is not proof of work — an agent can create a file
without doing the work it describes (ADR 0048, failure class 1). Recorded
checkpoint evidence is the trust anchor, and a lifecycle command must not
manufacture a workflow file in order to satisfy its own presence check.

Provider trust configuration (per-project agent trust levels and equivalent
runtime settings) stays with the provider. It is operator configuration, not
Parallix operational state.

### Agent transport

A file produced because an external agent process communicates through files is
not automatically durable state.

The normal transport lifecycle is:

1. create the temporary artifact outside the target repository;
2. let the agent read or write it;
3. consume it through an application boundary;
4. validate it;
5. persist the bounded resulting domain state; and
6. remove the temporary artifact when no longer required.

This preserves agent ergonomics without creating a second workflow database in
Git.

### Large artifacts

SQLite is not an unbounded blob store.

Large or naturally external material remains outside the database, including:

* full command output retained for diagnosis;
* patches;
* captures;
* long transcripts;
* large verification proofs; and
* build output.

Parallix may persist a bounded locator, digest, exact Git identity, or other
reference required to associate the artifact with Mission state.

### Generated repository metadata

Normal lifecycle execution must not create Git-tracked workflow metadata simply
because a mission occurred.

Derived documentation should not be committed merely because it can be useful
to read. In particular, indexes, inventories, status summaries, workflow
ledgers, and generated history views should exist only when a concrete consumer
requires the materialized file rather than the canonical source.

This applies to the ADR set itself: Git provides historical revisions. The ADRs
describe the current accepted architecture; a generated ADR index is unnecessary.

## Transaction and authority rules

1. One application operation updates all database-owned facts that must change
   atomically.
2. Mission writes use optimistic concurrency or an equivalent expected-state
   check so stale callers change nothing.
3. Git, filesystem, OS, and provider prerequisites are observed from their own
   authorities before dependent Mission state is committed.
4. Current Mission state is not reconstructed from events, task-file placement,
   generated artifacts, branch names, or UI caches.
5. Database-owned mutations fail closed when the database is unavailable or
   corrupt.
6. There is no steady-state fallback writer to Markdown, JSON, or CSV.
7. Imports are explicit, validated, atomic, idempotent and one-way into current
   authority.
8. Migrations are ordered and checksum-protected, with backup, restore and
   interruption behavior tested.
9. Agents and interfaces do not receive direct SQL authority.
10. Persistence is not allowed to invent domain entities. In particular,
    `Attempt` remains excluded until the domain has actual identity, lifecycle,
    invariants, and consumers for it.

### Excluded concepts

This ADR does not introduce `Attempt` or any other entity whose only
justification is that a table would be convenient.

| Concept | Decision | Rejected alternative | Consequence |
| --- | --- | --- | --- |
| `Attempt` | **Excluded.** No checked production domain type defines its identity, lifecycle, or relationship to `AgentRunMeasurement` and `SessionMarker`, and no launch, retry, failover, usage, review, or UI consumer requires durable per-launch identity. The exclusion is enforced, not asserted: `test/domain-attempt-guard.test.ts` fails if an Attempt-shaped type, table, or record appears under `src/domain`, `src/application`, or `src/adapters`. | Create attempt tables from the desired persistence shape first. | Avoids a schema-led domain model; failover history stays limited until the domain earns the concept. |

## Legacy and migration boundary

Legacy mission and backlog files may be read through explicit migration/import
paths while their concepts are being cut over.

Once a concept is cut over, normal runtime behavior no longer reads or writes
the retired file representation.

A fresh DB-native mission should be able to proceed through:

```text
intake -> refinement -> execution -> checkpoint -> handoff
       -> review -> integration -> closure
```

without requiring a `missions/<slug>` directory or generated workflow files in
the target repository.

Historical files already committed do not need Git-history rewriting to satisfy
this decision. Removing them from the current tree makes the current product
compact while Git retains their historical revisions.

## Consequences

### Positive

* The target repository describes the product rather than the accumulated
  execution history of Parallix.
* Humans and agents query one current representation instead of scanning and
  reconciling workflow files.
* Mission, checkpoint and review updates stop producing unrelated Git churn.
* Rich evidence remains available without turning every piece of evidence into
  repository metadata.
* Markdown remains available as a presentation format.
* Operational state can be queried transactionally across repositories.
* External systems retain explicit authority over their own facts.

### Negative

* A plain Git clone no longer contains complete operational Mission history.
* Humans and agents depend on Parallix query/context/export capabilities for
  database-owned state.
* `<PARALLIX_HOME>/parallix.db` is critical operator state and requires tested
  backup, restore, migration and corruption-recovery behavior.
* Moving active operational history to another machine requires an explicit
  Parallix backup/export or a future shared coordination service.
* Mission execution context requires a bounded model rather than arbitrary
  Markdown.
* Large referenced artifacts need a retention policy separate from DB backup.
* One local SQLite database remains unsuitable as a multi-user coordination
  service.

## Reconsideration triggers

Revisit this decision if:

* Parallix becomes multi-user or remotely coordinated;
* one operator database cannsot meet measured concurrency or recovery needs;
* active operational state must travel through ordinary Git clone/pull as a
  product requirement;
* a current external fact acquires first-class Parallix domain semantics; or
* measured usage shows that an on-demand projection cannot satisfy a concrete
  consumer without durable materialization.

## References

* ADR 0037: AI workflow coordination architecture
* ADR 0048: Fail-closed harness defense against agent hallucinations
* ADR 0051: UI-neutral application boundary and retained workflow authority
