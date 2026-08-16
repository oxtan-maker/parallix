# Mission: Run pre-review rebase in-process with typed gate and hook evidence (task-2377.02)

## Goal
Make the pre-review rebase step (`rebaseBeforeReviewRound` in `src/adapters/review/rebase.ts`) call the existing `RebaseWorkflowPort` in-process instead of spawning a nested `px rebase <slug> --push` CLI subprocess, and make it return **typed** failure evidence (which git operation failed, gate area/command/exit code/stdout/stderr, hook identity) instead of a text blob that the parent re-classifies with its own regex. After this mission, a push-time verification-gate failure whose output happens to contain the words `pre-push` (any full unit-suite run does) is reported as a gate failure — never as a Git hook failure — and only one process consumes the hook-retry budget.

## Why Now
This is the exact failure chain behind the task-2369.13 incident: a flaky unit gate was misclassified as a Git hook failure, so the implementer was "relaunched" against the wrong prompt with no evidence of a fix. Two defects cause it, both rooted in the subprocess boundary:

1. **Misclassification.** The parent captures the child's combined stdout/stderr and runs `HOOK_FAILURE_RE` (`src/adapters/review/rebase.ts`) over it. Gate output containing hook-like words wins the regex, so a gate failure gets the hook failure class, the hook budget, and the hook fix prompt.
2. **Split-brain budget.** The nested CLI runs its own `handleHookFailureAutoBounce` off the same persisted retry counter the parent reads. Two processes spend one budget without either observing the other, so the parent's bounce-vs-strand decision is nondeterministic.

TASK-2377.03's rebound kernel consumes a structured `reason` value. This mission produces the typed pre-review failure input that kernel needs, so it must land before 2377.03 can migrate this path. It also removes the misleading `Hook rebounce available in CLI rebase command` log, which described a rebounce that had already happened inside the subprocess.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one typed result contract plus in-process wiring in `src/adapters/review/rebase.ts`; consumer updates in `src/adapters/review/review-loop.ts` and the handoff rebase port typing; rewrite of the subprocess-shaped tests in `test/task-1107-repro.test.ts` (tsx-entrypoint / compiled-CLI / combined-output cases) and `test/review.test.ts`. Escalation risk toward Large: `runRebaseWorkflow` in `src/application/rebase-workflow.ts` signals every outcome through `port.exit()` and returns `void`, so surfacing a typed result may require an exit-capturing seam across roughly fifteen exit sites.

## Scope
- Replace the `spawnSync`-based nested `px rebase <slug> --push` invocation in `rebaseBeforeReviewRound` with an in-process call through `RebaseWorkflowPort` / `runRebaseWorkflow` (`src/application/ports/rebase-workflow.ts`, `src/application/rebase-workflow.ts`, `src/adapters/rebase/rebase-workflow-adapter.ts`).
- Introduce a typed pre-review rebase result: a discriminated failure describing the failing git operation (`commit` / `rebase` / `push`), and for a verification-gate failure the area, command, exit code, stdout and stderr; for a hook failure, the hook identity from the failing git operation.
- Delete `HOOK_FAILURE_RE` from `src/adapters/review/rebase.ts` and every use of it (both the `commitSafeMissionArtifacts` path and the post-subprocess path); hook identity comes from the typed result.
- Propagate the typed result through `rebaseBeforeReviewRound`'s return value to `src/adapters/review/review-loop.ts` and to `HandoffRebasePort` in `src/application/ports/handoff-workflow.ts`, keeping `ok` / `sharedFileConflicts` for existing consumers.
- Remove the `Hook rebounce available in CLI rebase command` message and ensure the pre-review path no longer triggers a second in-child hook bounce (single budget consumer).
- Update the tests that encode the subprocess shape (tsx entrypoint selection, compiled `px.mjs` selection, combined-output classification) to the in-process contract, and add the AC#2/AC#3 regression coverage.
- Update docs describing the pre-review rebase as a nested CLI call, if any exist under `docs/`.

## Out of Scope
- The rebound kernel itself and the ADR-0048 classification table consolidation (TASK-2377.03).
- The standalone `px rebase` command's own behavior, its `--push` semantics, and its internal hook-bounce path (migrated by TASK-2377.05).
- The second copied hook regex in `src/adapters/review/review-gate-handling.ts` (owned by TASK-2377.03).
- Dual retry persistence (`review-state.json` metadata counters, SQLite `mission_reviews` columns) and per-failure budget semantics (TASK-2377.04).
- Handoff-time checkpoint/gate relaunch, integrate squash bounce, launcher family failover.
- The SC20 shutdown/PTY race (TASK-2377.01).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `src/adapters/review/rebase.ts` contains no `child_process` / `spawnSync` import and no `px rebase` argv construction; the pre-review rebase reaches the rebase workflow through `RebaseWorkflowPort`. A test asserts the module source has no `spawnSync` usage and that an injected port seam is invoked exactly once per pre-review rebase.
2. The identifier `HOOK_FAILURE_RE` does not appear in `src/adapters/review/rebase.ts`, and no regex in that file matches `pre-commit`, `pre-push`, or `post-commit`.
3. A regression test drives a push-time verification-gate failure whose captured output contains the literal string `pre-push` and asserts the returned result classifies it as a gate failure carrying a non-empty area, a non-empty command string, and a numeric non-zero exit code — and asserts `hookFailure` is `false`.
4. A regression test drives a genuine hook failure on a git operation during the pre-review rebase and asserts the result reports `hookFailure: true` with the hook identity (`pre-commit` or `pre-push`) and the hook output preserved.
5. The pre-review rebase consumes the hook-retry budget in exactly one process: a test asserts that a single pre-review rebase hook failure invokes the hook-bounce seam at most once.
6. The string `Hook rebounce available in CLI rebase command` appears nowhere under `src/`.
7. `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, and `test/rebase-use-case.test.ts` pass with no edits to their assertions about standalone `px rebase` behavior.
8. `test/task-1268-pre-review-gate-per-round.test.ts`, `test/task-2353-rebounce-reproduction.test.ts`, `test/task-1104-call-order.test.ts`, `test/task-1107-repro.test.ts`, and `test/review.test.ts` pass. Any assertion changed in `test/task-1107-repro.test.ts` or `test/review.test.ts` is one that asserted the subprocess shape (tsx/`px.mjs` entrypoint selection or combined-output regex classification), and each such change is listed by test name in the final checkpoint.
9. `./scripts/verify-local.sh all` passes on the final tree with zero failing tests.

## Risks and Assumptions
- **`runRebaseWorkflow` signals through `port.exit()`.** It returns `void` and calls `port.exit(0|1)` at roughly fifteen sites. Assumption: the mission adds an exit-capturing seam (or a thin result-returning wrapper) rather than rewriting all control flow; the standalone CLI keeps calling the real `process.exit`.
- **In-process side effects.** The nested CLI ran in its own process; running the same workflow in-process shares `process.cwd()`, module-level caches, and any `process.exit` path with the review loop. Risk: an unintended real `process.exit` from the review-loop process. Mitigated by criterion 1's seam test plus the review-loop suites.
- **Hidden coupling to captured text.** Downstream consumers may read `hookOutput` as free text. Assumption: the typed result keeps the raw output fields so existing prompt builders keep working while classification moves to the discriminant.
- **Gate/hook overlap is real.** A pre-push hook that runs the verification gate is genuinely both a hook invocation and a gate run; the mission's rule is that the failure class follows the inner failing check (verification gate → gate failure), not the enclosing hook name.
- Assumption: no consumer outside `src/adapters/review/review-loop.ts`, `src/adapters/cli/commands/handoff.ts`, and `src/application/handoff-command-use-case.ts` calls `rebaseBeforeReviewRound`.

## Checkpoints
- CP 1: Typed result contract and in-process wiring. Define the pre-review rebase result type (discriminated failing operation; gate evidence with area, command, exit code, stdout, stderr; hook evidence with hook identity and output), add the port/result seam that lets `runRebaseWorkflow` be driven in-process without a real `process.exit`, and replace the `spawnSync` call in `rebaseBeforeReviewRound`. Covers criteria 1 and part of 3/4.
- CP 2: Delete the parent-side regex and move classification onto typed evidence. Remove `HOOK_FAILURE_RE` and its two call sites, drop the `Hook rebounce available in CLI rebase command` log, ensure a single hook-bounce consumer, and propagate the typed result to `src/adapters/review/review-loop.ts` and `HandoffRebasePort`. Covers criteria 2, 5, 6.
- CP 3: Regression coverage, suite green, docs. Add the gate-with-`pre-push`-text test and the genuine-hook-failure test, migrate the subprocess-shaped tests in `test/task-1107-repro.test.ts` and `test/review.test.ts` to the in-process contract (listing each changed assertion by test name), update any doc describing the nested CLI call, and run the gate. Covers criteria 3, 4, 7, 8, 9.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section with exactly that heading
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- One row per Success Criterion in scope for that checkpoint, each citing durable, verifiable evidence. For this mission, prefer:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-1107-repro.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `git grep -n "spawnSync" src/adapters/review/rebase.ts` `` (show the empty result)
  2. **Test names** — e.g., `"rebaseBeforeReviewRound invokes the TypeScript entrypoint through tsx in a source checkout"` for a migrated assertion, or the new gate-misclassification test's exact name (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-1107-repro.test.ts`, `test/task-1268-pre-review-gate-per-round.test.ts`, `test/task-2353-rebounce-reproduction.test.ts` (must exist)
  4. **ADR references** — e.g., `ADR 0048` for the fail-closed classification rule (must correspond to a file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers rot; prefer citing the file plus the symbol (`src/adapters/review/rebase.ts`, `rebaseBeforeReviewRound`) instead
- Weak-agent failure mode, called out explicitly: raw `stat` or `ls` output, a bare "done", or generic prose ("verified the classification is correct") is **not** sufficient evidence on its own. Shell output may appear only when paired with one of the accepted references above — e.g., a `git grep` transcript together with the file path and symbol it proves, or a test-run tail together with the exact test name that produced it.
- For criteria 2 and 6 (deletions), cite the search command and its empty output plus the file path — an assertion that "the regex is gone" without a command is not accepted.
- For criterion 8, list each changed assertion by its exact test name and state what it asserted before.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| No subprocess spawn on the pre-review path | `src/adapters/review/rebase.ts`, `` `git grep -n "spawnSync" src/adapters/review/rebase.ts` `` (no matches) | PASS |
| Gate failure containing `pre-push` is not a hook failure | `test/task-1107-repro.test.ts`, `"pre-review gate failure with pre-push in output classifies as gate failure"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/application/rebase-workflow.ts` — additive result/exit seam only; do not change the standalone `px rebase` command's decisions, output, or hook-bounce behavior (TASK-2377.05 owns that migration).
- `src/adapters/review/review-gate-handling.ts` — leave the copied hook regex there untouched; TASK-2377.03 removes it.
- `src/domain/review.ts`, SQLite `mission_reviews` retry columns, and `review-state.json` metadata counters — TASK-2377.04 owns retry persistence.
- `src/application/hook-failure-workflow.ts` — `classifyHookFailure` and `MAX_HOOK_RETRY` stay as they are; consolidation belongs to TASK-2377.03.
- `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, `test/rebase-use-case.test.ts` — must pass unmodified.
- Do not touch the board/TUI, integrate, or launcher paths.

## Stop Rules
- Stop and report if making the pre-review rebase in-process requires changing an observable decision of the standalone `px rebase` command (its exit codes, its logged outcomes, or its hook-bounce behavior) — that is TASK-2377.05's scope.
- Stop and report if the typed result cannot be produced without persisting or reading a retry counter — budget rework is TASK-2377.04.
- Stop if removing `HOOK_FAILURE_RE` would require reintroducing an equivalent regex anywhere under `src/` on this path; a renamed or relocated copy of the same classifier is a failure of this mission, not a workaround.
- Stop if `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, or `test/rebase-use-case.test.ts` need assertion edits to pass.
- Stop if `./scripts/verify-local.sh all` reports a failure that also reproduces at the mission's parent commit — record it as pre-existing baseline red and do not patch production code to green it.
- Stop if the change would grow past the Medium NEL bucket because `runRebaseWorkflow`'s exit sites need a full control-flow rewrite; report the measured size and ask before continuing.
