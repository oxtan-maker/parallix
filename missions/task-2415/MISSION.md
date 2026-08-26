# Mission: Fix repaired pre-review gate exiting the review round instead of continuing (task-2415)

## Goal

In `src/adapters/review/review-loop.ts`, when `rebaseBeforeReviewRound` reports a **gate-only** failure (typed `failure.kind === 'gate'`), the review loop correctly bounces to the implementer, the rebound kernel verifies the repair, and logs `Pre-review rebase gate repair verified for ${slug}; continuing this review round.` — yet the loop then exits immediately. The `else` paired with `if (rebaseResult.hookFailure)` runs for the original gate-only failure and calls `exit(1)`, abandoning the round before the reviewer is launched.

Make a successfully repaired typed gate failure continue to the reviewer launch in the same round. Preserve the existing hook-failure path and the failure-exit paths. Do not rerun the already-verified pre-review setup before the reviewer launch.

## Why Now

The review loop is the autonomous reviewer/implementer bounce engine (TASK-2377.02/03/04). A declared pre-review gate that fails, gets repaired, and re-verifies is supposed to resume the round — but the control-flow bug strands every such mission at the gate-repair log line with an unconditional `exit(1)`. This is a regression in the gate-bounce path: the repair succeeds, verification passes, and the round still dies. The backlog title records the exact symptom ("Repaired pre-review gate exits instead of continuing review round"). Until fixed, any gate that the implementer actually repairs still stops the review loop, which is the opposite of the intended self-healing behavior.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single mis-structured `if/else` in the pre-review rebase failure branch, isolated gate-bounce regression, regression lockable with one focused in-process unit test

## Scope
- Fix the failure branching in the `state.phase === 'reviewing'` pre-review rebase block of `src/adapters/review/review-loop.ts` so a verified gate-only repair does not fall through to the `else` that calls `exit(1)`.
- Author one focused regression test under `test/` that reproduces the gate-only repair path and locks the bug (red at the parent commit, green after the fix).
- Preserve, without change: the hook-failure recovery path (`if (rebaseResult.hookFailure)`), the stranded/unrepaired failure exits, the per-round relaunch cap (`DEFAULT_REBOUNDS_PER_ROUND`, `stopForRoundReboundCap`), and the `preReviewSetupVerified` short-circuit that skips re-running the declared gate.

## Out of Scope
- Do not alter task-2396's unit-suite concurrency fix or gate budgets.
- Do not touch the declared pre-review gate definition, `src/adapters/review/rebase.ts`, `src/adapters/review/review-gate-handling.ts`, or `scripts/verify-local.sh`.
- Do not change the hook-failure classification, the rebound kernel policy (`src/application/rebound-kernel.ts`), or the reviewer/implementer launch logic beyond the single branch fix.
- Do not add CLI flags, change backlog state names, or rework the review-loop classifier/dispatch architecture.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** A new regression test at `test/task-2415-pre-review-gate-repair-continues.test.ts` fails on the parent commit and passes after the mission. Red: for a `rebaseBeforeReviewRound` result of `{ ok: false, failure: { kind: 'gate', gate: {...}, operation: 'pre-push' } }` with `hookFailure` falsy, the loop calls `exit(1)` after logging the gate-repair continuation (the injected `exit` throws, or `reviewerLaunches` stays `0`).
- **SC2:** After the fix, the same gate-only repair path does not call `exit(1)` and launches the reviewer exactly once in the same round (`reviewerLaunches === 1`), and the logged output contains `continuing this review round.`
- **SC3:** The verified repair does not re-run the declared pre-review gate before the reviewer launch: `verifyPreReviewSetup`/`runPreReviewGate` is invoked only by the rebound kernel's verify (twice: rebase + gate), and the `if (!dryRun && !preReviewSetupVerified)` declared-gate block is skipped for the repaired round.
- **SC4:** The hook-failure recovery path is unchanged: a `failure.kind === 'hook'` result (or a truthy `rebaseResult.hookFailure`) still bounces, re-verifies, and continues; an unrepaired hook failure still calls `exit(1)`.
- **SC5:** Unrepaired gate failures retain their stop behavior: when the rebound kernel reports `!bounced`, the loop still calls `exit(1)` with the `stranded mission` diagnostic.
- **SC6:** The existing gate-bounce regression in `test/task-2353-rebounce-reproduction.test.ts` ("declared pre-review gate rebounces, replays, and resumes the review loop") remains green, including its `reviewerLaunches === 1` assertion.
- **SC7:** `./scripts/verify-local.sh all` passes on the final execution tree.

## Risks and Assumptions
- **Risk:** The `else` at the end of the `if (!rebaseResult.ok)` block is also the catch-all for an unclassified failure kind. Over-broadly removing it could hide a genuine "unknown failure" strand. Mitigation: guard the exit with the same condition the loop already tracks — only skip the exit when the gate or hook branch already verified the repair (`preReviewSetupVerified === true`), so an unclassified/unrepaired failure still exits.
- **Risk:** Overfitting the regression to one specific gate area. Assumption: the fix keys off `failure.kind === 'gate'` and `preReviewSetupVerified`, not on a specific gate `area` string.
- **Assumption:** `preReviewSetupVerified` is the single, authoritative flag that the pre-review setup was already verified this round, so the `if (!dryRun && !preReviewSetupVerified)` declared-gate block is the correct place to confirm SC3's no-rerun guarantee.
- **Assumption:** The parent commit is the current mission branch HEAD (`5901586ce`), where the bug is present.

## Checkpoints
- CP 1: Author the failing reproduction test (red → green) that locks the bug. File: `test/task-2415-pre-review-gate-repair-continues.test.ts` (in-process, injected dependencies, no live forgejo). Reproduction scenario: call `startReviewLoop` with `rebaseBeforeReviewRoundFn` returning a gate-only failure `{ ok: false, failure: { kind: 'gate', gate: { area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1, stdout: 'gate diagnostic', stderr: '', error: 'gate failed' }, operation: 'pre-push' } }` and `hookFailure` falsy on the first call, then `{ ok: true, sharedFileConflicts: false, hookFailure: false }` on the second call (after the implementer repair); `runPreReviewGateFn` returns `ok:false` on the first invocation and `ok:true` thereafter. Inject `exit: (() => { throw new Error('unexpected exit'); })` and count reviewer launches. Red assertion on the parent commit: the injected `exit` throws (or `reviewerLaunches` stays `0`) after the `continuing this review round.` log, proving the loop abandons the round. Green assertion after the fix: no `exit` is thrown, `reviewerLaunches === 1`, and the logs contain `continuing this review round.`.
- CP 2: Apply the minimal branch fix in `src/adapters/review/review-loop.ts` (lines ~583–634): make the final `else` that calls `exit(1)` conditional on the repair not already being verified (e.g. `else if (!preReviewSetupVerified)`), so a verified gate-only repair falls through to the reviewer launch while an unclassified/unrepaired failure still exits. Preserve the hook-failure branch and the stranded-failure exits.
- CP 3: Run the focused regression suite and confirm the hook-failure and stranded-failure paths still behave (`test/task-2415-pre-review-gate-repair-continues.test.ts` green, `test/task-2353-rebounce-reproduction.test.ts` green).
- CP 4: Run `./scripts/verify-local.sh all`, capture the results, and prepare handoff evidence with a `## Goal Check` table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` ``, or `` `px review task-2415 --verify` ``
  2. **Test names** — must match a test name in the repo, e.g. `"declared pre-review gate rebounces, replays, and resumes the review loop"` (the task-2353 regression) or the new task-2415 regression test name.
  3. **Test file paths** — e.g., `test/task-2415-pre-review-gate-repair-continues.test.ts` (must be an existing test file) and `test/task-2353-rebounce-reproduction.test.ts`.
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`).
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above.
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: raw `stat`/`ls` output or a sentence like "the test passes" is NOT sufficient evidence. Pair any shell output with one of the accepted references above — for example, paste the `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` `` result alongside the exact test name, or cite the test file path and the ADR.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the gate-exit bug | `test/task-2415-pre-review-gate-repair-continues.test.ts`, `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"` | PASS |
| Repaired gate no longer calls exit(1) and launches reviewer | `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` `` | PASS |
| Existing gate-bounce regression still green | `test/task-2353-rebounce-reproduction.test.ts`, `"declared pre-review gate rebounces, replays, and resumes the review loop"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/adapters/review/rebase.ts`, `src/adapters/review/review-gate-handling.ts`, `src/application/rebound-kernel.ts`, `src/adapters/agents/agents.ts`, or `src/application/handoff-command-use-case.ts` beyond what the single branch fix requires.
- Do not change `config/integration-pipelines.json`, `scripts/verify-local.sh`, or the declared pre-review gate definition/budgets.
- Do not alter task-2396's unit-suite concurrency fix or the `DEFAULT_REBOUNDS_PER_ROUND` per-round relaunch cap semantics.
- Do not modify the hook-failure classification in `review-gate-handling.ts` or the `hookFailureReason`/`gateFailureReason` outputs.
- Do not edit the backlog `assignee` field or move/rename the backlog task file.

## Stop Rules
- Stop if locking the bug deterministically requires live end-to-end gate execution or a real forgejo review instead of injected in-process dependencies.
- Stop if the minimal fix cannot be expressed as a single guarded branch without also changing the hook-failure path, the per-round relaunch cap, or the declared-gate definition.
- Stop if the parent commit's `./scripts/verify-local.sh all` is already red for reasons unrelated to this mission; capture the blocker and do not force the mission through the gate.
- Stop if preserving both the repaired-gate-continues path and the unclassified-failure-exits path simultaneously requires a broader classifier redesign; document that blocker instead of shipping a partial regression.

Reproduction-Test: test/task-2415-pre-review-gate-repair-continues.test.ts
