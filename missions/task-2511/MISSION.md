# Mission: Define a defensible database migration for repository noise (task-2511)

## Goal
Produce an evidence-backed proposal and ADR updates that decide which Parallix-created repository and worktree artifacts should move to the operator-local database, which must remain files or external facts, and how a later migration can preserve lifecycle, recovery, review, checkpoint, and auditability guarantees.

## Why Now
Mission metadata and agent-facing artifacts have accumulated into a material share of the repository footprint. ADR 0053 already establishes SQLite authority boundaries, but the remaining file footprint and the rationale for retaining each file have not been assessed as one migration decision. A bounded investigation is needed before any destructive or cross-cutting persistence work begins.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: inventory every current Parallix-owned on-disk artifact; reconcile the inventory with ADR 0053 authority classifications; make an explicit migration, retention, export, backup, recovery, and compatibility recommendation without changing runtime behavior.

## Scope
- Inspect the trust marker and every Parallix-created or Parallix-consumed repository/worktree artifact involved in mission intake, lifecycle state, checkpoints, review events, agent/session recovery, verification evidence, and generated operational metadata.
- Classify each artifact as database-authoritative, file-retained configuration or source artifact, external-system fact, generated/rebuildable export, temporary transport, or removable legacy footprint; identify its writer, reader, retention purpose, and proposed post-migration authority.
- Author `missions/task-2511/persistence-footprint-inventory.md` and `missions/task-2511/persistence-footprint-proposal.md`; the proposal specifies the target authority, data ownership, migration order, compatibility/removal boundaries, export/retention policy, backup/recovery implications, and validation gates for each artifact proposed to move.
- Update the relevant ADR 0053 persistence/authority documents (and add an ADR only if the investigation establishes a new durable decision) so the accepted boundaries, exceptions, and deferred decisions match the proposal.
- Record follow-up implementation missions as explicit, independently executable work items; no follow-up may rely on unrecorded investigation knowledge.

## Out of Scope
- Implementing SQLite schema changes, migrations, adapters, commands, filesystem-reader/writer changes, or removal of any artifact.
- Changing agent trust configuration, lifecycle behavior, review behavior, checkpoint behavior, backup tooling, or existing mission artifacts.
- Migrating external backlog content, Git topology, credentials, user-authored configuration, source documents, patches, logs, or unbounded large artifacts into SQLite.
- Bulk-editing, deleting, relocating, or rewriting existing mission, review, checkpoint, or backlog files.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `missions/task-2511/persistence-footprint-inventory.md` inventories every discovered Parallix-created or Parallix-consumed artifact in the stated mission/lifecycle/review/checkpoint/session/verification scope, and each row identifies its path pattern, writer, reader, current purpose, authority classification, and keep/move/export/remove recommendation.
- SC2: `missions/task-2511/persistence-footprint-proposal.md` explicitly resolves the trust marker and every artifact recommended for database migration with its target database owner, migration order, compatibility or deletion boundary, and the recovery/backup/export consequence; artifacts retained outside the database have a stated rationale.
- SC3: ADR 0053 persistence and operational-authority documentation agrees with the proposal on the database/file/external/generated boundary, preserves its stated exclusions, and names any new or changed decision without claiming that implementation has occurred.
- SC4: The proposal identifies discrete follow-up implementation missions for schema/data migration, read/write cutover, compatibility cleanup, and regression/operational verification where those stages are needed; each follow-up has a scoped outcome and dependency order.
- SC5: The investigation changes only the proposal, ADR documentation, this mission’s checkpoint records, and the backlog task metadata; no production source, test, configuration, database schema, or existing historical artifact is altered.
- SC6: `./scripts/verify-local.sh all` succeeds on the final investigation documentation tree.

## Risks and Assumptions
- Risk: treating a generated export or external fact as operational authority could create a second source of truth. Mitigation: classify every reader and writer and reconcile each recommendation with ADR 0053 before proposing a cutover.
- Risk: moving evidence-heavy or Git-reviewable material into SQLite could impair auditability, portability, or recovery. Assumption: the proposal may retain durable source artifacts and database references/exports where the database is not the appropriate content store.
- Risk: legacy readers can make a partial cutover silently unsafe. Assumption: the investigation can identify a migration order and explicit compatibility-removal condition, but implementation and validation belong to follow-up missions.
- Assumption: “trust marker” refers to the persisted or generated marker that influences agent/workflow trust, not a request to change trust policy during this mission.

## Checkpoints
- CP 1: Build the artifact and trust-marker inventory: enumerate the scoped path patterns, readers, writers, lifecycle purpose, and ADR 0053 classification; record unresolved ownership questions explicitly.
- CP 2: Write the migration proposal: decide keep/move/export/remove recommendations, target database ownership, sequencing, compatibility removal conditions, backup/recovery implications, and follow-up mission boundaries.
- CP 3: Update the ADR 0053 persistence/authority decision documents to reflect accepted recommendations, cross-check the proposal against the inventory, run the repository gate, and record final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a short work summary, then the exact heading `## Goal Check` followed by this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Provide at least one row for every success criterion. Lead with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use `ADR 0053`, `missions/task-2511/persistence-footprint-proposal.md`, `missions/task-2511/persistence-footprint-inventory.md`, and `./scripts/verify-local.sh all` where applicable. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot. Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with an accepted reference above. End with a concrete `Next action:` line.


## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Production source, tests, schemas, migrations, runtime configuration, and workflow configuration are read-only.
- Existing artifacts under `missions/`, `backlog/`, review-event directories, and checkpoint directories are read-only except this mission’s own contract/checkpoints and the task-2511 backlog task labels.
- Do not modify the backlog task `assignee` field or transition its status.
- Do not create a database, invoke lifecycle/review/integration commands, or start a review, execute, or integrate phase.

## Stop Rules
- Stop and request direction if the trust marker cannot be identified from durable repository evidence or its owner cannot be classified under ADR 0053 without changing product behavior.
- Stop and request direction if the proposed database target would require persisting credentials, external backlog content, Git/worktree facts as authoritative state, or unbounded artifact content.
- Stop and request direction if complete artifact inventory requires editing source, tests, configuration, schemas, or historical mission/backlog/review/checkpoint files.
- Stop and report if `./scripts/verify-local.sh all` fails for a pre-existing or unrelated condition after confirming the documentation-only change does not touch the failing area.
