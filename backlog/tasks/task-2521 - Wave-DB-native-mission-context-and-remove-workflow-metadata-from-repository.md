---
id: TASK-2521
title: 'Wave: DB-native mission context and remove workflow metadata from repository'
status: backlog
assignee: []
created_date: '2026-09-16 09:09'
labels:
  - architecture
  - persistence
  - workflow
  - migration
  - trust-model
dependencies:
  - TASK-2511
references:
  - docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md
  - docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md
  - docs/adr/0037-ai-workflow-coordination-architecture.md
  - docs/adr/0047-per-mission-change-size-budget.md
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
priority: high
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wave: complete the ADR 0053 persistence cutover so normal Parallix operation no longer uses the target repository as a workflow database.

The end state is deliberately stronger than "SQLite is authoritative while Markdown is still generated":

* bounded Parallix-owned Mission context and evidence live behind the application/persistence boundary defined by ADR 0053;
* agents and humans can read all context required to execute/review/recover a Mission without scanning `missions/**`, `backlog/**`, review-event files, or other generated workflow metadata;
* agents write checkpoint/review/other bounded evidence through supported application commands/contracts rather than by creating durable workflow files;
* temporary files remain allowed where an agent process requires file transport, but they are consumed and are not committed as workflow state;
* Parallix self-hosting no longer requires repository-backed Backlog task files;
* legacy repository metadata is migrated only after it can be proven that its required information has a supported destination;
* `missions/**`, old Backlog task artifacts, and other retired workflow metadata are removed from the current repository tree only after an explicit migration audit reaches zero unresolved items;
* Git history is NOT rewritten. Git already preserves the historical files.

This is an implementation wave. It must leave Parallix able to execute new Missions end-to-end with essentially zero Git-tracked workflow metadata generated merely because a Mission occurred.

The wave is split into eight Missions, tracked as subtasks of this task (Mission 1 = `.01` … Mission 8 = `.08`). Each subtask carries its own work and acceptance criteria.

### Non-negotiable architectural constraints (apply to every Mission)

1. **ADR 0053 owns persistence decisions.** Do not introduce a new persistence architecture in another ADR or duplicate ADR 0053 rules in unrelated code/docs.
2. **Do not move Markdown into SQLite as blobs.** `MISSION.md`, checkpoint files, task files, review events, etc. must be decomposed into the bounded domain/application facts actually consumed. A `mission_markdown`, `checkpoint_markdown`, `task_markdown`, or equivalent blob used as the new authority is a failed implementation.
3. **Do not invent domain concepts from desired tables.** Existing domain semantics drive schema. If implementation appears to require a new first-class domain entity or lifecycle concept not supported by the current ADR/domain model, STOP the mission for human architectural review rather than inventing one.
4. **No steady-state dual write.** After a concept cuts over, normal runtime must not write both SQLite state and a repository compatibility file.
5. **No silent fallback to files.** DB failure for DB-owned state fails closed; it must not recreate `MISSION.md`, `CP-*.md`, review JSON, task files, or similar fallback authority.
6. **No direct SQL as the agent API.** Agents use application/CLI contracts.
7. **Agent readability is mandatory.** Removing files must never mean removing context. A fresh agent must be able to discover how to obtain goal, scope, constraints, gates, checkpoint evidence, review findings/resolutions, relevant predecessor context, and current workflow state.
8. **The harness must not manufacture semantic evidence.** Do not preserve or recreate the auto-generated-placeholder-checkpoint pattern simply to satisfy a gate.
9. **No derived repository-document proliferation.** Do not add migration indexes, ADR indexes, manifests, status summaries, generated inventories, "current state" Markdown files, or similar unless there is a concrete runtime consumer that cannot consume the canonical source. Prefer executable checks and CLI output.
10. **Destructive cleanup comes last.** No bulk deletion of `missions/**`, Backlog task files, or historical workflow metadata until the migration/audit mission proves that every retained fact has either been imported, deliberately classified as external/product-owned, or explicitly shown to be obsolete.
11. **Unknown means STOP.** An unrecognized legacy file, parser ambiguity, duplicate disagreement, missing consumer mapping, or unexplained runtime file dependency blocks cleanup. It is not permission for an agent to guess.
12. **Do not weaken trust gates to make the migration pass.** File-presence gates may be replaced by structured-evidence gates; verification, exact-tree, review, lifecycle, and fail-closed semantics remain.
13. **Do not rewrite Git history.** Cleanup removes obsolete files from the current tree. Historical commits remain the archive.
14. **Keep task-source and Mission semantics separate.** A SQLite-backed local task provider may use the same physical DB as Mission state, but a task catalog must not silently become part of the Mission aggregate merely to make migration convenient.
15. **Do not refactor unrelated architecture.** If a clean cutover is blocked by unrelated structural debt, create/identify the blocker and stop rather than broadening this wave into a general rewrite.

### Mandatory agent-slop checks for every Mission in this wave

Before handoff, each implementation Mission MUST answer with concrete evidence:

* What existing consumer required every new persisted field?
* Which existing file read/write paths were removed?
* Did the Mission introduce any new durable file? If yes, why is it canonical rather than a derived projection?
* Did the Mission introduce any new domain type/table? If yes, show the existing domain concept/invariant that justifies it.
* Is there any dual-write, fallback writer, TODO compatibility path, or "temporary" repository projection remaining?
* Can the behavior be exercised without `missions/<slug>`?
* Did any trust check become weaker, or was a file-presence check replaced by an equivalent/stronger semantic check?
* Do `px --help` and relevant command help expose the supported path an agent should use instead of filesystem archaeology?

A Mission that cannot answer those questions with code/test/command evidence is not ready for integration.

### Dependency / execution order

```text
Mission 1 (.01) Architecture lock + executable file-consumer guardrails
        |
Mission 2 (.02) DB-native Mission execution context + evidence contracts
        |
   +----+-----------------------------+
Mission 3 (.03) Agent context/API     Mission 4 (.04) SQLite local task provider
+ prompts/help                        + legacy task import (needs only .01)
   +----+-----------------------------+
        |
Mission 5 (.05) Remove normal runtime workflow-file reads/writes
        |
Mission 6 (.06) Legacy migration + zero-unresolved audit
        |
  HARD STOP / GO GATE
        |
Mission 7 (.07) Delete retired metadata from current repo tree
        |
Mission 8 (.08) Dogfood file-free workflow + recovery proof
```

Mission 7 MUST NOT start until Mission 6 reports zero unresolved legacy material and zero unexplained normal-runtime readers/writers of the paths being removed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The landed ADRs are re-read before implementation; any material mismatch with this wave stops for human architectural review instead of being guessed around.
- [ ] #2 ADR 0053 is the sole architectural owner of persistence decisions; no new persistence ADR or competing authority model is introduced.
- [ ] #3 Bounded Mission execution context needed by agents is queryable from authoritative state without `MISSION.md`.
- [ ] #4 Checkpoint/Goal Check evidence is recordable/queryable without `CP-*.md`.
- [ ] #5 Agent prompts and `px --help` make the supported context/evidence workflow discoverable to a fresh agent with only a Mission slug.
- [ ] #6 Agents do not receive direct SQL authority and are not expected to know DB schema.
- [ ] #7 Parallix self-hosting uses a non-repository local task provider; task-source semantics remain separate from Mission semantics.
- [ ] #8 Legacy Backlog/Mission metadata migration is explicit, dry-runnable, idempotent, conflict-detecting and produces a machine-testable zero-unresolved result before deletion.
- [ ] #9 No opaque Markdown/document blobs are introduced as the new authority for old workflow files.
- [ ] #10 No steady-state dual-write or silent file fallback remains for concepts cut over to SQLite.
- [ ] #11 Normal execute → checkpoint → handoff → review → integration → closure works with no `missions/<slug>` directory.
- [ ] #12 File-shaped trust checks are replaced by equivalent/stronger semantic checks; missing evidence is not fabricated by the harness.
- [ ] #13 Automatic review-event/CP/MISSION/task-status projection commits are removed from normal lifecycle execution.
- [ ] #14 Historical `missions/**` workflow metadata and Parallix-local Backlog task artifacts are removed from the current repo tree only after the zero-unresolved audit passes.
- [ ] #15 Unexpected/unclassified legacy material causes cleanup to STOP rather than being ignored or deleted.
- [ ] #16 Git history is not rewritten.
- [ ] #17 Architecture tests prevent reintroduction of normal-runtime repository workflow-metadata writers/readers.
- [ ] #18 Representative dogfood scenarios prove fresh-agent context, review-loop continuity, restart recovery, missing-evidence fail-closed behavior, and zero workflow-only Git files.
- [ ] #19 No new index/inventory/status-summary documentation files are introduced merely to describe state that can be derived from canonical sources.
- [ ] #20 Full required verification gates pass on the final tree with exact-tree/captured proof per the current trust model.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Full unit/integration/static-analysis gates pass for the final tree
- [ ] #2 No focused or unannotated skipped tests were introduced
- [ ] #3 Every Mission in this wave records real Goal Check evidence; no synthetic evidence is accepted
- [ ] #4 Every new persisted field can be traced to an existing consumer/domain requirement
- [ ] #5 Every removed repository persistence path has a tested supported replacement or a proven-obsolete classification
- [ ] #6 Migration backup/restore and idempotency are proven before destructive cleanup
- [ ] #7 `px --help` and relevant command help accurately describe the DB-native agent workflow
- [ ] #8 Runtime agent prompts contain no stale instruction to use retired workflow files as authority
- [ ] #9 A fresh checkout plus restored `<PARALLIX_HOME>` state can inspect/recover active Mission context without historical workflow files from the repository
- [ ] #10 Final self-hosting proof creates zero Git-tracked workflow metadata solely because Missions were executed
<!-- DOD:END -->
