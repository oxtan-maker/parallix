# Mission: Reconcile external Backlog lifecycle updates into SQLite (task-2440)

## Goal

Ensure lifecycle changes made through the external Backlog.md and MCP write paths are reconciled into the repository-scoped SQLite Mission aggregate, so the board reads the same lane that the external task now declares.

## Why Now

The board is backed by the SQLite Mission aggregate while users and agents can change lifecycle state through external Backlog.md tooling. When those paths do not update the aggregate, a task can show one lifecycle state in its backlog file and a stale lane on the board, making the board unreliable for planning and execution.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one shared external-write reconciliation point, repository-scoped Mission persistence, and a focused board-read regression test

## Scope

- Trace every supported external lifecycle write initiated through Backlog.md or the Backlog MCP path to the shared persistence boundary.
- Reconcile the matching repository-scoped SQLite Mission aggregate after a successful external lifecycle update, using the task identity and resulting lifecycle state from that write.
- Preserve the existing external write result and error behavior; reconciliation must not create a second task or alter unrelated Missions.
- Add `test/task-2440-repro.test.ts`, covering an external lifecycle update followed by a board read in the same repository scope.

## Out of Scope

- Redesigning backlog lifecycle states, board lanes, or their user-facing labels.
- Rebuilding, migrating, or backfilling all existing SQLite Mission records.
- Changing lifecycle updates performed by the normal mission workflow unless they share the external-write reconciliation boundary.
- Changes to unrelated board projections, current-work reconciliation, review, or integration flows.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A test in `test/task-2440-repro.test.ts` performs a supported external lifecycle write for one task and then reads the board for the same repository scope.
- SC2: Before the fix, that test demonstrates the defect: the external task lifecycle state changes while the matching board card remains in its prior SQLite-backed lane.
- SC3: After the fix, the same external lifecycle write updates the SQLite Mission aggregate for the matching task, and the subsequent board read returns that card in the lane corresponding to the new lifecycle state.
- SC4: The reconciliation changes only the Mission matching the externally updated task; another Mission in the same repository retains its lifecycle state and board lane.
- SC5: The external write's established success result and failure behavior remain unchanged when SQLite reconciliation succeeds or is not applicable.
- SC6: `node --test test/task-2440-repro.test.ts` passes after the fix.
- SC7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- Risk: Backlog.md and MCP writes may reach lifecycle persistence through different adapters. Assumption: they converge at a shared write or task-update boundary; if they do not, enumerate and cover each supported path without duplicating persistence logic.
- Risk: A task identifier can be valid externally but not resolve to a repository-scoped Mission. Assumption: this is an expected no-op reconciliation case and must not create a new Mission record.
- Risk: Reconciliation can overwrite a newer aggregate state if it uses stale input. Assumption: the write path exposes the committed lifecycle state; reconcile only from that successful result.

## Checkpoints

- CP 1: Author the failing reproduction test before any fix: `test/task-2440-repro.test.ts`. In a temporary repository scope, create two persisted Missions, perform a supported external Backlog.md or MCP lifecycle update on one task, then read the board. Assert that the updated task's board card remains in its old lane at the mission parent commit (red); the same assertion must observe the new lane after reconciliation is implemented (green). Assert that the second task remains unchanged.

- CP 2: Trace the Backlog.md and MCP lifecycle write paths to their common persistence boundary. Add the smallest reconciliation there so a successful external update applies the resulting lifecycle state to the matching repository-scoped SQLite Mission aggregate, without changing existing write responses.

- CP 3: Complete the regression coverage in `test/task-2440-repro.test.ts`, including the unchanged sibling Mission and the post-update board read. Run the focused test and the required repository gate.

Reproduction-Test: test/task-2440-repro.test.ts

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include a summary of work done, the exact heading `## Goal Check`, and a 3-column pipe-delimited table with exactly `| Criterion | Evidence | Status |` as its header.

Use at least one durable, verifiable reference for every success criterion, preferring exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with one of the accepted references above. End every checkpoint document with a non-generic `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| External lifecycle write updates its board card | `test/task-2440-repro.test.ts`, `node --test test/task-2440-repro.test.ts` | PASS |
| Unrelated Mission remains unchanged | `test/task-2440-repro.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not change the lifecycle-state vocabulary, board-lane mapping, or board presentation solely for this defect.
- Do not add a SQLite migration, bulk repair, polling loop, or background reconciler; reconcile synchronously at the successful external lifecycle write boundary.
- Do not modify unrelated current-work, review, or integration lifecycle flows.
- Do not access a real Forgejo instance from the regression test; use fast mocked dependencies and temporary local state only.

## Stop Rules

- Stop and report if Backlog.md and MCP lifecycle writes do not share a safe persistence boundary and covering all paths requires a lifecycle architecture redesign; do not introduce parallel reconciliation implementations without a new contract.
- Stop and report if the external write result does not identify a task or committed lifecycle state needed to match the repository-scoped Mission; do not infer identity from display text.
- Stop and report if reconciliation would require a schema migration, historical backfill, or changes to board lane semantics.
- Do not weaken the red-first reproduction assertion or replace it with a direct SQLite unit test that skips the external write followed by board read scenario.
