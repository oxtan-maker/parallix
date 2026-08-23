# Mission: Restore runtime export of `snapshotWorktreeTopology` (task-2407)

## Goal
Make the real handoff/integrate runtime load `snapshotWorktreeTopology` successfully while retaining the existing NEL-capture and board-projection behavior.

## Why Now
The real integrate/handoff flow currently stops at step 1.7 before it can capture Net Engineering Lines. Dry-run and isolated imports miss this production module-graph failure, so missions cannot complete the normal handoff path reliably.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a circular ESM import makes a declared worktree export unavailable once the CLI composition graph is loaded; the focused regression test and a minimal dependency-direction correction are expected to be contained.

## Scope
- Add a focused runtime regression test at `test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` that loads the CLI-relevant module graph and exercises the handoff NEL-capture import path.
- Correct the import/dependency arrangement involving `src/adapters/git/worktree.ts`, `src/composition/board-projection.ts`, and their CLI composition path so `snapshotWorktreeTopology` is available as a named runtime export.
- Retain the existing `captureNelAtHandoff` behavior and the board worktree-amplification projection behavior.

## Out of Scope
- Changing NEL calculation, bucket thresholds, handoff policy, or integrate workflow semantics.
- Refactoring unrelated CLI composition modules or replacing the worktree adapter API.
- Documentation changes unless the repair changes a supported user-facing workflow behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The focused regression test `test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` fails on the mission parent commit because the CLI-relevant runtime module graph cannot provide `snapshotWorktreeTopology`, then passes after the repair.
- Loading the handoff path that reaches `captureNelAtHandoff` resolves `snapshotWorktreeTopology` as a callable named export without the ESM named-export error.
- Existing board projection worktree-amplification coverage continues to pass, demonstrating that the board projection retains its topology behavior.
- `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: a superficial dynamic-import workaround could hide the circular dependency while leaving another CLI load path broken. Mitigation: the regression test must load the production-relevant graph, not import `worktree.ts` in isolation.
- Risk: changing composition dependencies could alter board projection behavior. Mitigation: retain and run `test/board-readers.worktree-amplification.test.ts` coverage.
- Assumption: the reported cycle through `board-projection.ts`, `production-capabilities.ts`, and `status-adapter.ts` is the relevant runtime-only path.

## Checkpoints
- CP 1: Author the failing reproduction before any fix: create `test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` to load the CLI-relevant handoff/NEL-capture graph and assert that `snapshotWorktreeTopology` is a callable named export. On the mission parent commit this assertion must fail with the missing named-export condition (red); after the repair it must pass (green).

Reproduction-Test: test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts

- CP 2: Trace every caller and import edge for `snapshotWorktreeTopology`, then make the smallest dependency-direction change that removes the runtime ESM cycle while preserving adapter ownership.
- CP 3: Run the focused regression and board-projection coverage, then run the repository verification gate and record the final goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead every evidence row with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed, but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` and at least one evidence row for every success criterion.
- Do not use raw `stat`/`ls` output or generic prose alone as evidence; if included, pair it with an accepted reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change NEL domain rules in `src/domain/net-engineering-lines.ts` unless tracing proves they are part of the runtime export cycle.
- Do not alter mission lifecycle policy, backlog state transitions, or integration gate definitions.
- Do not add a dynamic-import fallback that bypasses a still-cyclic static module graph.

## Stop Rules
- Stop and report if the red reproduction cannot be made to fail against the mission parent commit without mocking the production-relevant module graph.
- Stop and request direction if the smallest cycle-breaking repair requires changing NEL semantics, handoff policy, or more than the worktree/board-projection/CLI composition boundary.
- Stop and report if `./scripts/verify-local.sh all` exposes an unrelated existing failure that cannot be distinguished from this mission.
