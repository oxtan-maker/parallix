# Mission: Hide review-start poll/max-attempts plumbing at default verbosity (task-2481)

## Goal
Confirm that at default verbosity the review-start header printed by `startReviewLoop` in `src/adapters/review/review-loop.ts` contains no `Focus: … | Max attempts: …` or `Poll interval: … | Poll timeout: …` lines, and that `verbose: true` still prints both. Confirm the two tests that check this pass on the mission tree. Then close the follow-up. Change production code only if the gate turns out to be missing or broken on the mission's parent commit.

## Why Now
Task-2481 was filed on 2026-09-10 as a baseline-red follow-up. Task-2477 added the default-verbosity assertions, but the `if (verbose)` gate on the review-start header did not land with them. As a result, `test/task-1209-review-loop.test.ts` and `test/task-2477-review-presentation.test.ts` failed on `main`. The repair was later forced into `mission/task-2480` because that mission's pre-review verification gate failed closed. It then reached `main` in squash commit `7126d1058` ("mission/task-2480: task-2480"), which is an ancestor of this mission's parent commit. Task-2480 is now `done` in `backlog/completed/`. The task's own implementation notes say to close it once task-2480 merges and to reopen it only if the repair gets stripped. That condition is now met, so the remaining work is to verify with evidence and close the ticket. Leaving it open keeps a stale baseline-red ticket on the board.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is; expected diff is checkpoint evidence plus the backlog task update, with zero production lines unless the gate turns out to be missing on the parent commit
- Main drivers: `7126d1058` already contains the `if (verbose)` guard around both header lines in `startReviewLoop`; both target assertions already exist in `test/task-1209-review-loop.test.ts` and `test/task-2477-review-presentation.test.ts`; the work is verification and ticket closure

## Scope
- Check that `startReviewLoop` in `src/adapters/review/review-loop.ts` emits `Focus: ${focus} | Max attempts: ${maxAttempts}` and `Poll interval: …s | Poll timeout: …s | Verbose: on` only inside the `if (verbose)` block of the review-start header.
- Run `./scripts/verify-local.sh all` and confirm both named tests appear in the results as passing, not merely absent from the failure list (see [[default-suite-silently-drops-tests]] risk below).
- If, and only if, the guard is missing or the tests fail on the mission tree: restore the `if (verbose)` guard around those two `log(fmt.status('INFO', …))` calls in `startReviewLoop`. Do not touch any other code.
- Update the task-2481 backlog file: tick the acceptance criteria that have evidence and add an implementation note that cites `7126d1058` and the checkpoint Goal Check.

## Out of Scope
- Any change to other verbosity-gated output in `review-loop.ts`, such as `renderReviewVerdict`, the "Forgejo validation skipped" provider-plumbing lines, or "Persisted reviewer artifacts" logging.
- Changing the wording or format of the header lines (for example, dropping `| Verbose: on` or splitting `Focus` back out onto its own line).
- Rewriting or weakening the assertions in `test/task-1209-review-loop.test.ts` or `test/task-2477-review-presentation.test.ts`. The tests are the spec, and the source must satisfy them.
- Task-2477 presentation work beyond these two header lines, and any reopening of task-2480.
- Adding a new reproduction test. This task has no `bug` label, and the bug is already fixed at the parent commit, so a red→green test cannot be red.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The test "startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode" in `test/task-1209-review-loop.test.ts` passes on the final tree. This includes its `default output hides review plumbing` assertion.
- SC2: The test "verbose review start exposes poll/provider lines that default hides" in `test/task-2477-review-presentation.test.ts` passes on the final tree. This includes the `default off: poll/timeout/max-attempts lines absent`, `verbose on: poll lines present`, and `verbose on: max-attempts line present` assertions.
- SC3: In `src/adapters/review/review-loop.ts`, `startReviewLoop` has exactly one `log` call whose message contains `Max attempts` and exactly one whose message contains `Poll interval`. Both sit inside the same `if (verbose)` block, and no other `log`/`error` call in that function prints `Poll timeout` or `Max attempts` without a verbose guard.
- SC4: `./scripts/verify-local.sh all` exits 0 on the final tree with 0 failures. Its output lists both SC1 and SC2 test names as passing, so a silently dropped test file cannot satisfy this criterion.
- SC5: `git diff main -- test/task-1209-review-loop.test.ts test/task-2477-review-presentation.test.ts` is empty, meaning no assertion was weakened, skipped, or marked `.only`.
- SC6: Backlog task-2481 has acceptance criteria #1–#5 ticked, and its implementation notes cite commit `7126d1058` and this mission's checkpoint Goal Check.

## Risks and Assumptions
- Assumption: `7126d1058` (the task-2480 squash) is an ancestor of the mission parent and contains the verbose guard. This was confirmed while drafting with `git merge-base --is-ancestor 7126d1058 HEAD`. If a later rebase onto `main` drops the guard, the fallback source edit in Scope applies.
- Risk: the default `./scripts/verify-local.sh all` run can report `fail 0` while whole test files never execute, and totals vary from run to run. Mitigation: SC4 requires both test names to appear as passing in the output, not just a zero failure count.
- Risk: a concurrent mission could land another edit to the review-start header in `startReviewLoop`, such as more task-2477 presentation work. Mitigation: re-read the header block after any rebase before signing off SC3.
- Assumption: no user-facing docs describe these header lines, so there is no docs change. If `docs/` mentions `Poll interval` in review-start output, update that sentence only.

## Checkpoints
- CP 1: Verify and close. Run `git merge-base --is-ancestor 7126d1058 HEAD` and read the review-start header block in `startReviewLoop` to settle SC3. Run `./scripts/verify-local.sh all` and capture the pass lines for both named tests (SC1, SC2, SC4). Run the `git diff main -- …` from SC5. Only if SC1–SC3 fail, apply the minimal `if (verbose)` guard restoration and rerun the gate. Then update the task-2481 backlog file (SC6) and write `CP-1.md` with the Goal Check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done, stating explicitly whether any production line in `src/adapters/review/review-loop.ts` changed. The expected answer is no, because the guard arrived with `7126d1058`.
- A `## Goal Check` section. Use that exact heading.
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`, with one row each for SC1–SC6.
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths**, for example `` `./scripts/verify-local.sh all` ``, `` `git merge-base --is-ancestor 7126d1058 HEAD` ``, `` `git diff main -- test/task-1209-review-loop.test.ts test/task-2477-review-presentation.test.ts` ``, or `src/adapters/review/review-loop.ts`
  2. **Test names**, which must match exactly: `"startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode"` and `"verbose review start exposes poll/provider lines that default hides"`
  3. **Test file paths**: `test/task-1209-review-loop.test.ts`, `test/task-2477-review-presentation.test.ts`
  4. **ADR references**, for example `ADR 0039` for the falsifiability rule, which must correspond to an existing file under `docs/adr/`
  5. **File:line references**, which are accepted but discouraged because line numbers rot. Prefer citing `startReviewLoop` in `src/adapters/review/review-loop.ts` by symbol.
- Raw `stat`/`ls`/`grep` output or generic prose such as "tests pass" or "guard is present" is NOT enough evidence on its own. Every shell excerpt must be paired with one of the accepted references above, for example a pasted `ok` line naming the test together with the `./scripts/verify-local.sh all` command that produced it.
- A non-generic `Next action:` line at the bottom, for example `Next action: hand off task-2481 for review; no source diff, close on approval`.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 default output hides plumbing | `test/task-1209-review-loop.test.ts`, `"startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode"` passing in `./scripts/verify-local.sh all` | PASS |
| SC2 verbose shows, default hides | `test/task-2477-review-presentation.test.ts`, `"verbose review start exposes poll/provider lines that default hides"` | PASS |
| SC5 assertions untouched | `git diff main -- test/task-1209-review-loop.test.ts test/task-2477-review-presentation.test.ts` (empty) | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- `test/task-1209-review-loop.test.ts` and `test/task-2477-review-presentation.test.ts`: read-only. Do not edit, skip, or loosen any assertion.
- `src/adapters/review/review-loop.ts`: only the two review-start header `log` calls and their `if (verbose)` guard may change, and only if SC3 fails.
- Every other file under `src/` and `prompts/`, `scripts/verify-local.sh`, `docs/adr/`, and the task-2477 and task-2480 backlog files.
- The backlog `assignee` field of task-2481.

## Stop Rules
- Stop and report if `7126d1058` is not an ancestor of the mission tree and restoring the guard would require more than the two header `log` calls in `startReviewLoop`.
- Stop and report if SC1 or SC2 still fail with the verbose guard present. That means the failure has a different cause than this ticket describes, so escalate as a new task instead of widening scope.
- Stop and report if `./scripts/verify-local.sh all` fails on tests unrelated to review-start output. Record the failing test names and do not repair them in this mission.
- Stop once SC1–SC6 all have PASS evidence in `CP-1.md`, without adding refactors or more verbosity demotions.
