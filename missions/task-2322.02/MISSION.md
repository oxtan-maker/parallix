# Mission: Close checked-domain gaps before persistence schema expansion (task-2322.02)

## Goal
Prove, in checked TypeScript and fast tests, that the existing domain concepts (`Mission`, `CheckpointData`, `Review`, `MissionOutcome`, `AgentRunMeasurement`, `KnownRepository`, `SessionMarker`, `LaneTransitionEvent`, `AgentBlock`) can express every behavior the current launch, retry, failover, usage, review, and UI consumers require, map every `database-owned-domain-state` entry of `ADR0053_PERSISTENCE_INVENTORY` to a domain type and invariant or to declared technical persistence metadata, and settle the `Attempt` question by consumer evidence — introducing a checked `Attempt` model with domain tests and an ADR 0053 update only if a current consumer demands identity or lifecycle that no existing concept carries.

## Why Now
TASK-2322.01 landed the executable inventory (`src/platform/runtime/lib/core/durable-state-inventory.ts`) and the guardrails in `test/persistence-inventory-guardrail.test.ts`, and TASK-2322.03 is queued to add SQLite tables for the Mission aggregate. If the schema lands before the domain gaps are closed, the table shape becomes the de facto model: an `Attempt` row, a task catalog, or a worktree record can slip in as "convenient schema" and then acquire consumers. ADR 0053 currently excludes `Attempt` (`docs/adr/0053-operational-persistence-and-authority-boundaries.md:89`) on the grounds that no checked production type defines its identity or lifecycle; that exclusion must be re-tested against real consumers and then locked by a test, not by prose, before any persistence work begins.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: trace six consumer families to the domain information they read; map each database-owned inventory entry to a checked type or declared technical metadata; add domain and architecture tests that keep an implicit `Attempt` out of later persistence work; amend ADR 0053 and `src/domain/README.md` to match the decision reached.

## Scope
- Trace current launch, retry, failover, usage/statistics, review, and UI/board consumers to the domain information each one actually reads, citing checked source locations (for example `src/platform/runtime/lib/agents/launcher-selection.ts`, `src/platform/runtime/lib/commands/stats.ts`, `src/platform/runtime/lib/review/review-loop.ts`, `src/application/projections/mission-board.ts`, `src/platform/runtime/lib/tools/sessions.ts`).
- Map every `ADR0053_PERSISTENCE_INVENTORY` entry classified `database-owned-domain-state` to one checked domain type plus the invariant that governs it, or record it as technical persistence metadata (schema/migration/import identity, concurrency version, technical keys) that is explicitly not a domain entity.
- Express that mapping as checked TypeScript in `src/domain` and/or `src/application` (not documentation alone) so it can be asserted by tests.
- Decide `Attempt` from the CP 1 consumer evidence, and implement exactly one branch:
  - required → add an `Attempt` domain model with stable identity, invariants, and modeled relationships to `Mission`, `SessionMarker`, and `AgentRunMeasurement`, plus domain tests and an ADR 0053 amendment; or
  - not required → record which existing concepts satisfy each consumer and add an architecture/domain test that fails if persistence or adapter code introduces an Attempt-shaped record.
- Apply the same sequence (consumer need → checked type and invariants → domain tests → ADR 0053 decision) to any other domain extension the tracing shows is required.
- Update `docs/adr/0053-operational-persistence-and-authority-boundaries.md` and `src/domain/README.md` so the recorded `Attempt` decision and any new concept match the checked code.
- Update backlog tasks in 2322 wave with outcome of this mission (add reference to this mission outcome in relevants tasks)

## Out of Scope
- Any SQLite schema, table, migration, checksum, backup, or repository adapter (owned by TASK-2322.03 and later).
- Legacy import, byte-faithful compatibility reading, dual-write, or shadow-write behavior (TASK-2322.04).
- Switching any production command, authority, or read path from file-backed storage to a database (TASK-2322.05 through TASK-2322.12).
- File-format compatibility logic, task-file repair, normalization, or mutation of source task frontmatter.
- Changing agent-launch, failover, or review runtime behavior; this mission models what those consumers need, it does not alter what they do.
- Real Forgejo calls, real agent launches, or expensive CLI subprocesses in unit tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every `ADR0053_PERSISTENCE_INVENTORY` entry whose `classification` is `database-owned-domain-state` resolves, in checked code, to exactly one of: a named domain type in `src/domain` with a stated invariant, or an entry on an explicit technical-persistence-metadata list; a test enumerates the inventory and fails when an entry resolves to neither or to both.
- A checked consumer-requirement mapping covers all six consumer families — launch, retry, failover, usage/statistics, review, and UI/board — and for each names the domain concept(s) it reads among `Mission`, `CheckpointData`, `Review`, `MissionOutcome`, `AgentRunMeasurement`, `KnownRepository`, `SessionMarker`, `LaneTransitionEvent`, and `AgentBlock`; a test fails if a family is missing or names a concept that does not exist in `src/domain`.
- Every consumer entry in that mapping cites a `file:line` location in checked production source, and a test asserts each cited file exists (following the pattern of `"SC6: inventory fileLocation references resolve to existing files"` in `test/persistence-inventory-guardrail.test.ts`).
- The `Attempt` decision is implemented in exactly one branch and is provable: either `src/domain` exports an `Attempt` type with stable identity, at least one rejected-invalid-state invariant, and modeled links to `Mission`, `SessionMarker`, and `AgentRunMeasurement`, covered by domain tests; or no `Attempt` type exists and a test asserts that no file under `src/domain`, `src/application`, or `src/adapters` declares an Attempt-shaped identifier, table, or record type.
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md` states the same `Attempt` outcome as the checked code (the row at line 89 is amended if and only if `Attempt` is introduced), and `src/domain/README.md` no longer contains an Attempt statement that contradicts `src/domain`.
- Any domain extension added by this mission (including `Attempt`, if introduced) has: a named current consumer in the CP 1 mapping, a checked type in `src/domain`, at least one invariant test that rejects an invalid state, and an ADR 0053 decision line.
- The diff adds no file under `src/adapters/sqlite`, no `CREATE TABLE`/`ALTER TABLE`/`INSERT`/migration SQL, no legacy import or file-format compatibility code path, and no change to which storage a production command reads or writes; a reviewer can confirm this from `git diff --stat` plus the absence of SQL literals in changed files.
- `./scripts/verify-local.sh all` passes on the final tree and every new test runs without contacting Forgejo, launching an agent, or spawning an expensive CLI subprocess.

## Risks and Assumptions
- Risk: consumer tracing surfaces a genuine per-launch identity need (retry/failover history) that forces the `Attempt` branch, expanding the mission beyond a Medium NEL. Mitigation: CP 1 ends with an explicit branch decision and a documented consumer citation before any type is written; if the evidence is ambiguous, stop rather than guess.
- Risk: the opposite failure — declaring "no gap" to keep the mission small, leaving TASK-2322.03 to invent a table. Mitigation: the not-required branch must ship a test that actively blocks Attempt-shaped persistence, not merely a prose claim.
- Risk: an Attempt-blocking architecture test matches innocuous identifiers (for example a local variable named `attempts` in a retry loop) and turns into noise. Mitigation: scope the check to declared types, table names, and exported identifiers under the three named directories, and include a fixture test proving the guard rejects a real Attempt record declaration and accepts existing code.
- Assumption: `ADR0053_PERSISTENCE_INVENTORY` from TASK-2322.01 is complete and current for this worktree; this mission consumes it and does not re-derive the boundary list.
- Assumption: ADR 0053 and ADR 0051 remain governing; `src/domain/README.md` yields to the ADR where they differ, as stated at `src/domain/README.md:11`.
- Assumption: existing test seams allow the new domain and architecture tests to run purely from checked source and static file inspection, with no runtime service dependency.

## Checkpoints
- CP 1: Trace consumers to domain information. Produce the checked consumer-requirement mapping for launch, retry, failover, usage/statistics, review, and UI/board, each with `file:line` citations into production source and the domain concepts it reads. End the checkpoint with an explicit, evidence-backed statement of whether per-launch identity or lifecycle is required — that is, which `Attempt` branch CP 3 will implement.
- CP 2: Close the inventory-to-domain mapping. For every `database-owned-domain-state` entry in `ADR0053_PERSISTENCE_INVENTORY`, resolve it to a checked domain type plus invariant or to the explicit technical-persistence-metadata list, and add the enumerating test that fails on an unresolved, doubly-resolved, or unknown-type entry.
- CP 3: Implement the decided branch and lock it. Either add the `Attempt` domain model with identity, invariants, relationships, and domain tests, or add the architecture test that blocks Attempt-shaped types, tables, and records under `src/domain`, `src/application`, and `src/adapters` with a rejecting fixture case. Apply the same sequence to any other extension CP 1 justified, amend `docs/adr/0053-operational-persistence-and-authority-boundaries.md` and `src/domain/README.md` to match the code, and run `./scripts/verify-local.sh all`.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited Markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/domain/usage.ts:82` (must point to an existing file and line)
  2. **Test names** — e.g., `"SC1: ADR 0053 inventory covers all 15 durable-state concepts"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/persistence-inventory-guardrail.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/domain-mission.test.ts` ``, `` `git diff --stat` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; if shell output is included, pair it with a file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above. "The mapping is complete" or a bare directory listing does not satisfy a criterion.
- For CP 1 specifically: state the `Attempt` branch decision on its own line and back it with at least one consumer `file:line` citation.
- For CP 3 specifically: cite the ADR line that records the `Attempt` outcome and the test name that locks it.
- A concrete `Next action:` line at the bottom that names the remaining mapping, domain type, test, ADR edit, or verification step.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/sqlite` and any migration or schema asset: no file may be added or modified by this mission.
- `src/platform/runtime/lib/core/durable-state-inventory.ts` is an input from TASK-2322.01; edit it only to correct a demonstrably wrong entry, never to make a new mapping pass.
- Production command modules (`src/platform/runtime/lib/commands/`) and the review loop: read-only for tracing; no behavior change to launch, retry, failover, review, or statistics execution.
- Source task files under `backlog/tasks/` other than this mission's own task file: read-only inputs, with no repair, normalization, or mutation code path introduced.
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md` is amended in place per the ADR standard (current active decisions only) — do not add a superseding ADR or an accreted change log.
- Unit tests under `test/` must mock Forgejo, agents, Git, and expensive CLI dependencies and must not contact real services.

## Stop Rules
- Stop and request direction if consumer tracing shows per-launch identity is required but the identity, lifecycle, or relationship rules for `Attempt` cannot be pinned down from checked source without inventing behavior.
- Stop and request direction if closing a mapping gap would require adding a table, migration, adapter, import path, or command cutover — that work belongs to TASK-2322.03 and later.
- Stop and request direction if an inventory entry classified `database-owned-domain-state` matches neither a domain type nor technical persistence metadata, since that indicates the ADR 0053 classification itself is wrong.
- Stop and request direction if a checked domain concept would have to change meaning or lose an existing invariant to satisfy a consumer.
- Stop and request direction if the required tests cannot run without real Forgejo, real agents, or expensive external commands.
- Stop and request direction if the `Attempt` branch decision from CP 1 must be reversed during CP 3, rather than silently switching branches.
