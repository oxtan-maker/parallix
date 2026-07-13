# Mission: Make review-state persistence atomic and fail closed (task-2220)

## Goal

Make `ReviewState.save()` and `writeReviewState()` report persistence failure as a hard error rather than silently returning success when `git commit` leaves `review-state.json` dirty. Achieve this by: (1) writing through the existing atomic-write mechanism (`writeFileAtomic`), (2) returning a structured result that distinguishes committed / unchanged / write-failed / add-failed / commit-failed-dirty, and (3) updating every lifecycle call site that requires a durable checkpoint to fail closed on persistence failure.

## Why Now

The current `save()` method always returns `true` even when the commit fails and the state file remains dirty (`lib/review/review-state.ts:302`). This means the review loop and review-command call sites cannot distinguish durable, Git-checkpointed review state from state that exists only in the current worktree. That weakens resumability: if the process crashes after a dirty write, the next launch may see stale or partial state and incorrectly advance the review loop, compounding agent retries and producing misleading review-state transitions.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-as
- Main drivers: structured return-type migration across ~7 call sites, atomic write plumbing, call-site fail-closed logic, and focused test coverage for 5 failure modes

## Scope
- Modify `ReviewState.save()` in `lib/review/review-state.ts:279-303` to: write via `writeFileAtomic`, distinguish outcomes, return structured result
- Modify `writeReviewState()` in `lib/review/review-state.ts:314-322` to delegate to the new structured `save()` and return the structured result
- Modify `resetReviewState()` in `lib/review/review-state.ts:331-353` to use atomic write for the deletion path and return structured result
- Migrate all callers in `lib/review/review-artifacts.ts`, `lib/review/review-commands.ts`, `lib/review/review-events.ts`, and `lib/review/review-loop.ts` from boolean returns to structured results, with fail-closed semantics for required checkpoints
- Add a regression reproduction test that proves the old behaviour (success on dirty state) before the fix
- Add focused unit tests covering: atomic write failure, add failure, dirty commit failure, clean no-op commit, successful commit
- Run `./scripts/verify-local.sh static-analysis`, focused review-state/review-loop tests, and the default verification suite

## Out of Scope
- Redesigning the review state machine or its phases
- Moving review state outside the mission worktree
- Adding remote persistence or a database
- Refactoring unrelated review-loop orchestration
- Modifying `readReviewState()` behaviour (read path is not affected)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `ReviewState.save()` returns a structured result with at least five outcome variants: `committed`, `unchanged`, `write-failed`, `add-failed`, `commit-failed-dirty`. The `committed` variant is returned only after `git commit` exits 0 or the commit exits non-zero AND a subsequent `git status --porcelain <state-path>` returns empty.
- SC2: `writeReviewState()` returns the same structured result type as `ReviewState.save()`. Every caller in `lib/review/review-artifacts.ts`, `lib/review/review-commands.ts`, `lib/review/review-events.ts`, and `lib/review/review-loop.ts` inspects the result and handles the `commit-failed-dirty` and `write-failed` outcomes.
- SC3: `ReviewState.save()` writes `review-state.json` through `writeFileAtomic` from `lib/core/storage.ts:157` (or an equivalent temp-file-plus-rename implementation inline), so interruption cannot leave partial JSON on disk.
- SC4: Lifecycle call sites that require durable checkpoints — specifically `recordVerdict` in `lib/review/review-artifacts.ts`, `submitReviewRound` in `lib/review/review-commands.ts`, and the state-persist calls in `lib/review/review-loop.ts` — throw or return a clear failure (non-zero exit or error return) when persistence outcome is `commit-failed-dirty` or `write-failed`, instead of continuing the review loop.
- SC5: Error output on persistence failure identifies the mission slug, state phase, round number (where available), the failed persistence stage (`write`, `add`, or `commit`), and the underlying Git/filesystem diagnostic message, without claiming the state was committed.
- SC6: Benign idempotency is preserved: when `git commit` exits non-zero because nothing changed (the committed JSON is identical to the previous HEAD), `save()` returns `unchanged` (success) rather than `commit-failed-dirty`.
- SC7: The public API migration is complete: every caller and test helper in the repository that previously expected a boolean return from `writeReviewState()` or `ReviewState.save()` has been migrated to the structured result. No boolean-returning signatures remain.
- SC8: Focused tests cover all five failure modes: atomic write failure (filesystem error), add failure (git add non-zero), dirty commit failure (commit non-zero + status shows modified), clean no-op commit (commit non-zero + status clean), and successful commit. Test file: `test/task-2220-repro.test.js` (reproduction) plus `test/review-state.test.js` and `test/review-state-class.test.js` (focused additions).
- SC9: `./scripts/verify-local.sh static-analysis` passes with zero errors. The focused test suite (`npm test -- test/review-state.test.js test/review-state-class.test.js test/task-2220-repro.test.js`) passes with zero failures. The default verification suite passes.

Reproduction-Test: test/task-2220-repro.test.js

## Risks and Assumptions
- **Risk:** Structured return type breaks test helpers that mock `writeReviewStateFn` with `(slug, state) => {}` (void/boolean). Mitigation: every mock must be audited; the migration plan enumerates each file.
- **Risk:** `writeFileAtomic` uses `fs.renameSync` which is atomic on Linux/macOS but not guaranteed on Windows. Mitigation: the codebase runs on Linux CI; the temp-file-plus-rename pattern is acceptable.
- **Assumption:** The shared `writeFileAtomic` in `lib/core/storage.ts:157` is suitable for the review-state write path (same filesystem, same inode).
- **Assumption:** The `git` function in `lib/core/git.ts` returns `{ status, stdout, stderr }` shape consistently across all call sites.
- **Assumption:** `git status --porcelain <path>` correctly reports dirty status for the review-state file when commit fails mid-stage.

## Checkpoints
- CP 1: Author the red-to-green reproduction test (`test/task-2220-repro.test.js`) that proves `ReviewState.save()` / `writeReviewState()` returns success when `git commit` fails and `review-state.json` remains dirty. The test creates a temp mission directory, injects a gitFn that makes commit return non-zero and status show the file modified, asserts that the OLD behaviour returns `true` (or equivalent success), and verifies the dirty file exists. This test must fail on the parent commit (red) and pass once the fix lands (green), confirming the new structured result reports `commit-failed-dirty` instead of success.
- CP 2: Implement atomic write in `ReviewState.save()` using `writeFileAtomic` from `lib/core/storage.ts`. Replace the direct `fs.writeFileSync` call with the atomic variant. Implement structured return type with the five outcome variants. Update `writeReviewState()` to return the structured result.
- CP 3: Migrate all call sites in `lib/review/review-artifacts.ts`, `lib/review/review-commands.ts`, `lib/review/review-events.ts`, and `lib/review/review-loop.ts` from boolean to structured result. Implement fail-closed logic for required checkpoints. Update error output to include mission slug, phase, round, failed stage, and diagnostic.
- CP 4: Add focused unit tests for all five failure modes in `test/review-state.test.js` and `test/review-state-class.test.js`. Verify `resetReviewState()` migration. Run `./scripts/verify-local.sh static-analysis` and the full test suite.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/review/review-state.ts:285` (must point to an existing file and line)
  2. **Test names** — e.g., `"ReviewState save returns commit-failed-dirty when git commit fails and file remains dirty"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2220-repro.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0037` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/review-state.test.js` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `git -C worktree status --porcelain review-state.json` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test fails before fix | `test/task-2220-repro.test.js`, `"writeReviewState does not report success when commit fails and state path remains dirty"` | PASS |
| Atomic write replaces direct fs.writeFileSync | `lib/review/review-state.ts:285` | PASS |
| Structured result distinguishes 5 outcomes | `lib/review/review-state.ts:279` | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `npm test -- test/review-state.test.js test/review-state-class.test.js test/task-2220-repro.test.js`

## Restricted Areas
- `lib/review/review.ts` — do not modify the review state machine, phase transitions, or orchestration logic; only modify persistence behaviour
- `lib/core/git.ts` — do not modify the git abstraction layer; use it as-is
- Files under `lib/agents/` — this mission does not touch agent launchers or agent-specific code
- `lib/review/review-prompts.ts` — do not modify prompt templates

## Stop Rules
- Stop immediately if `./scripts/verify-local.sh static-analysis` produces any error on changed files; fix before proceeding to the next checkpoint
- Stop if the structured return type migration introduces a runtime type error at any call site; audit the specific file before continuing
- Stop if `git status --porcelain` returns unexpected output that would cause false-positive `unchanged` classification; investigate the git invocation before merging
- Do not proceed past CP 2 until the reproduction test in `test/task-2220-repro.test.js` turns green (passes)
- Do not introduce any `.only` or unannotated `.skip` in test files
- Do not modify the `assignee` field in the backlog task; the workflow records ownership itself
