# Mission: Bound SQLite backup retention (task-2530)

## Goal
Prevent irreversible SQLite migrations from accumulating an unbounded number of
`<database-path>.bak.*` sidecar files while preserving recovery from the newest
backup.

## Why Now
Parallel mission and integration runs create temporary Parallix homes under
`/tmp`. Their SQLite backup sidecars currently remain forever; the reported
machine accumulated 28,703 files (about 5.9 GB), causing `ENOSPC` during a
later database copy and breaking integration work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one shared `backup()` chokepoint, existing newest-backup
  recovery behavior, and a bounded filesystem regression test.

## Scope
- Add a failing regression test under `test/` before changing production code.
- Bound retention of `<database-path>.bak.*` files created by
  `SqliteDatabaseAdapter.backup()` after a new snapshot is written.
- Keep a named retention-count constant so the cap can be adjusted without
  changing the pruning algorithm.
- Verify `recoverFromBackup()` continues selecting and restoring the newest
  retained backup.

## Out of Scope
- Reclaiming whole per-run `/tmp/px-*` or `/tmp/task-*` homes.
- Changing migration ordering, backup filename format, or SQLite migration
  semantics beyond backup retention.
- Introducing background cleanup, scheduled jobs, or a configurable runtime
  setting for the retention count.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2530-backup-retention-repro.test.ts` creates
  more backups than the production retention cap through irreversible
  migrations and fails on the mission parent commit because the matching
  `.bak.*` count exceeds that cap.
- After the fix, that regression test passes and the matching `.bak.*` count is
  at most the production retention cap.
- The newest retained backup is the backup selected by recovery, demonstrated
  by an assertion in `test/task-2530-backup-retention-repro.test.ts`.
- The retention policy applies in `SqliteDatabaseAdapter.backup()`, the shared
  path used for irreversible migrations, rather than being added to one
  migration caller.
- `./scripts/verify-local.sh static-analysis` and
  `./scripts/verify-local.sh all` exit successfully with no `.only` or
  unannotated `.skip` introduced.

## Risks and Assumptions
- Assumption: `recoverFromBackup()` only needs the newest valid snapshot, as
  described by the existing backlog analysis.
- Risk: timestamp-based names can share a millisecond; pruning must order files
  deterministically without deleting the snapshot just written.
- Risk: filesystem cleanup errors could hide a successful backup; preserve a
  usable newest backup and make failure behavior consistent with the adapter's
  existing error handling.

## Checkpoints
- CP 1: Add `test/task-2530-backup-retention-repro.test.ts` before production
  changes. It must open a test database, run enough irreversible migrations to
  exceed the intended retention cap, and assert that matching `.bak.*` files do
  not exceed the cap and that recovery uses the newest backup. The count
  assertion must be red on the mission parent commit and green after the fix.

Reproduction-Test: test/task-2530-backup-retention-repro.test.ts

- CP 2: Implement bounded pruning in `SqliteDatabaseAdapter.backup()` after it
  creates a snapshot, retaining the configured newest backups only. Keep the
  recovery selection behavior intact.
- CP 3: Run the required static analysis and full local verification, then
  record the regression-test and gate evidence in checkpoint documentation.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: use exact test names,
  `test/task-2530-backup-retention-repro.test.ts`, `ADR 0039`, or a recognized
  repository command or path such as
  `npm test`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`.
  File:line references are accepted parenthetically when needed but discouraged
  because line numbers rot.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`.
- One row for every success criterion using the durable evidence above.
- A concise summary of work done.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output
  with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter migration definitions, database schema, backup filename format,
  or workflow temp-home lifecycle code unless the retention fix cannot preserve
  current recovery behavior.
- Do not delete arbitrary `/tmp` paths; pruning may target only sidecars that
  match the active database path's `.bak.*` naming pattern.

## Stop Rules
- Stop and escalate if recovery requires more than the configured retained
  backups, if the regression cannot reliably create distinct backups, or if the
  fix requires a schema migration or changes to migration ordering.
- Stop and escalate if the proposed pruning can delete a non-backup file or the
  newest valid backup.
