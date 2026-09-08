# Mission: Cancel a mission from the TUI and web board (task-2466)

## Goal
Provide a confirmed `mission:cancel` operation that retires exactly one mission's lifecycle data from the current repository through the TUI, web board, and direct CLI command, while preserving recorded usage costs and leaving git cleanup to the operator.

## Why Now
An abandoned mission remains active in the operator database after its branch and worktree are removed, so it still occupies a board lane and emits as in-flight work. Operators currently need hand-written SQLite deletion steps to correct this state.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: destructive lifecycle cleanup must be scoped, transactional, confirmed, and reachable through the existing board-command path on all supported surfaces.

## Scope
- Add `mission:cancel` to the existing board-command vocabulary and integrated capabilities with a payload containing only a mission id.
- Implement one transactional cancellation use case that enables and verifies foreign keys, deletes the target mission's cascaded lifecycle rows plus target-scoped `session_markers` and `board_lane_events`, checks foreign keys before commit, and rolls back on failure.
- Preserve all `usage_statistics` rows, including those for the cancelled mission.
- Route the TUI, web-board, and direct CLI entry points through that one board command.
- Require an explicit cancellation confirmation on the TUI and web board that differs from ordinary lifecycle confirmation; dismissal performs no deletion.
- Print, but never execute, `git worktree remove <path> && git branch -D <branch>` for the cancelled mission.
- Add focused coverage for deletion scope, transaction rollback, foreign-key integrity, cost preservation, confirmations, advisory-only git cleanup, and immediate board-projection removal.
- Update durable user-facing documentation for the cancellation action, preserved usage statistics, and operator-owned git cleanup.

## Out of Scope
- Bulk, filtered, cross-repository, or cancel-all-stale operations.
- Undo, soft deletion, tombstones, archive records, or a `cancelled` lane/status.
- Schema migrations or changes to `MissionStatus`, the `missions` status constraint, or board-lane status vocabulary.
- Deleting the backlog task, mission directory, git branch, worktree, remote branch, or Forgejo pull request.
- A generic purge engine, cascade framework, or new dependency.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `mission:cancel` is a `BoardCommandKind`, appears in `INTEGRATED_CAPABILITIES`, accepts only the target mission id, and is the sole database path used by the TUI, web board, and CLI.
- Cancelling a fixture mission removes rows for its id from `missions`, `mission_labels`, `mission_checkpoints`, `mission_checkpoint_goal_checks`, `mission_reviews`, `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`, `mission_review_stage_launches`, `mission_review_events`, `mission_external_task_refs`, `session_markers`, and `board_lane_events`.
- A fixture containing three missions proves cancellation leaves the two non-target missions' rows unchanged in every lifecycle table named in the preceding criterion.
- Cancellation preserves the cancelled mission's `usage_statistics` row count and summed `cost_usd`.
- The cancel transaction verifies `PRAGMA foreign_keys = ON`, commits only when `PRAGMA foreign_key_check` has zero rows, and an induced mid-transaction failure leaves the database unchanged.
- TUI and web cancellation each require their distinct explicit confirmation; dismissing either confirmation leaves all target lifecycle rows present.
- The TUI, web board, and CLI projections remove the cancelled mission without restart; the cleanup output contains that mission's worktree path and branch in `git worktree remove <path> && git branch -D <branch>`, and tests prove no git-mutating command is invoked.
- User documentation states how to cancel from both boards, that `usage_statistics` remains, and that the operator performs branch and worktree removal.

## Risks and Assumptions
- The schema inventory in the backlog task is complete; discovery of another mission-scoped table requires operator direction before implementation.
- Existing cascade rules cover the listed dependent lifecycle tables; only `session_markers` and `board_lane_events` require explicit target-scoped deletion.
- The established board-command controller, confirmation components, and CLI dispatch can carry one shared command without a new abstraction.
- Deletion is irreversible; confirmation behavior and transaction tests are release-critical.

## Checkpoints
- CP 1: Trace the existing board-command, CLI, TUI, web, database schema, and board-projection flows; confirm the full mission-scoped table inventory and record the selected one-command implementation path.
- CP 2: Add the transactional `mission:cancel` use case and focused database tests for target-only deletion, cascades, preserved `usage_statistics`, foreign-key checks, and rollback on an induced failure.
- CP 3: Wire the direct CLI, TUI, and web-board actions to the shared command; add distinct destructive confirmations, advisory cleanup output, and surface/projection tests.
- CP 4: Update cancellation documentation and run the required repository gates; capture final criterion evidence in the checkpoint Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable, verifiable forms Parallix recognizes today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with the exact header `| Criterion | Evidence | Status |` and at least one evidence row for every success criterion.
- Evidence using an exact test name, an existing test file path, an existing ADR reference, or a recognized repository command/path; for example, `test/domain-mission.test.ts`, `ADR 0039`, or `./scripts/verify-local.sh all`.
- Raw `stat`/`ls` output or generic prose only as supplemental context: alone they are insufficient and must be paired with an accepted reference above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not add a schema migration, a `cancelled` status/lane, undo capability, soft-delete storage, or bulk cancellation.
- Do not let a surface issue SQL or reach the database outside `mission:cancel`; payload data must be only the mission id.
- Do not delete or mutate git worktrees, branches, remote branches, Forgejo pull requests, backlog task files, or mission directories.
- Do not delete `usage_statistics` or issue a delete whose predicate is broader than the target mission id.
- Keep review findings confined to cancellation-path defects: deletion scope, orphan lifecycle rows, cost loss, confirmation bypass, database-path bypass, or partial commit.

## Stop Rules
- Stop and request operator direction if implementation requires a schema migration or a new `MissionStatus` or board-lane value.
- Stop and request operator direction if any mission-scoped table is discovered outside the contract's deletion inventory.
- Stop and request operator direction if the three surfaces cannot share `mission:cancel` without a new general abstraction.
- Stop and request operator direction if preserving `usage_statistics` conflicts with referential-integrity checks.
- Do not expand this mission beyond its Scope or Restricted Areas.
