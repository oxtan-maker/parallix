---
event_type: reviewer_findings
timestamp: 2026-06-23T05:09:47.314Z
round: 2
phase: reviewing
actor: claude
slug: task-1335
---

# Review Findings — task-1335 (attempt 2, focus: all)

Mission: Harden parallix self-hosting publish path so broken trees cannot reach `main`.
Reviewed: `git diff main..HEAD` on branch `mission/task-1335`.
Verification: `px review task-1335 --verify` → **FAILED** (reviewer gate failed; `npm test` red).

## Verdict: request-changes

The hardening feature work (exact-tree proof + publish-path enforcement) is substantially
implemented and wired, but the mission's own central, falsifiable requirement is violated:
the repo is **not** at a green `npm test` baseline. This branch *introduces* test regressions
relative to its base — i.e. it is itself the broken-tree-reaching-main failure mode the mission
exists to prevent.

---

## BLOCKER 1 — `npm test` is red; CP-2 / Success Criteria #2 & #7 / Gate unmet

`npm test` on the branch tip fails consistently across repeated runs:

```
ℹ tests 1619
ℹ pass 1594
ℹ fail 3        (+ 1 flaky: SC1-Fix post-relaunch poll)
```

Consistent failures (3):
1. `test/review-identity.test.js:109` — `submitReviewRound falls back to review-state identity when FORGEJO_USER is missing`
2. `test/review-identity.test.js:131` — `submitReviewRound ignores FORGEJO_USER and uses review-state identity`
3. `test/task-1079-review-blocked-fallback.test.js:94` — `startReviewLoop still rejects with a clear error when the explicit reviewer is blocked and no fallback path exists`

Flaky (failed 1 of 3 runs): `SC1-Fix: Post-relaunch poll uses updated sinceIso, not stale state.startedAt`.

These are **regressions introduced by this branch**, not pre-existing breakage:
- On `main` (fa67880) the full suite is green: `tests 1625 / pass 1603 / fail 0`.
- The same three tests pass on `main`: `tests 9 / pass 9 / fail 0`.

Mission Success Criterion #2 requires `npm test` to pass; #7 requires returning to a green
baseline *before* publish-path hardening is considered complete; the Gate `- [ ] npm test` is
unchecked-in-fact. CP-2.md claims the baseline was repaired and is green — that claim is false
against the current tree.

### Root causes of the regressions

- **#1/#2 (review-identity):** `submitReviewRound` now performs a backlog task transition and
  emits `[WARN] Could not transition backlog task <slug> to approved.` via `console.error` when
  the (test-stub) task is missing. The tests assert `errors.length === 0`; they now see 1.
  Reproduced directly:
  ```
  [WARN] Could not transition backlog task task-test-identity-fail to approved.
  ```
  The new backlog-transition side effect writes to stderr on a non-fatal condition, breaking the
  identity tests. Either the warning should not go to `console.error` on a benign/missing-task
  path, or the new behavior must be covered/adjusted so existing contracts hold.

- **#3 (task-1079):** the blocked-reviewer error wording changed. The test expects an error
  containing `Unsupported reviewer: "codex"` AND `launcher is not available`; the code now emits
  `Unsupported reviewer: "codex" (blocked or unsupported).` plus
  `No runnable reviewer route for implementer "qwen".` The reworded/rerouted error path in
  `lib/review/review-loop.js` dropped the contract the existing test pins.

All three originate in this branch's changes to `lib/review/review-loop.js`,
`lib/review/review-commands.js`, and `lib/tools/forgejo.js`.

---

## BLOCKER 2 — Branch is not rebased onto current `main`; diff is polluted (workflow inconsistency)

Reported, not fixed, per the review contract.

- `main` = `fa67880`, but `git merge-base main HEAD` = `b6d8121`. The branch was cut from the
  older (red) base and never rebased.
- `main` has since advanced with task-1324, task-1327, task-1332 integrations and task-1336.
  Because the branch predates those, `git diff main..HEAD` shows their mission dirs and
  `docs/use-cases.md` (105 lines) as **deletions** — these are rebase artifacts, not intended
  changes. This makes the published diff misleading for review and risks reverting integrated
  work if merged as-is.
- The mission "Why Now" asserts `main` is currently red on the disposition regression, but the
  current `main` (fa67880) is green. The premise is stale relative to repo state; the branch
  should be rebased and re-verified against the live baseline before resubmission.

---

## What is in good shape (not blocking)

- **Exact-tree proof mechanism** is implemented coherently in `lib/core/verification.js`:
  - `captureVerifiedTreeProof` (`:69-114`) records rootDir, area, command, commit SHA, tree SHA,
    verifiedAt; runs the configured gate and fails closed on non-zero exit (`:84-89`); re-reads
    tree state after the gate and rejects if the tree moved mid-publish (`:91-98`).
  - `assertVerifiedTreeProof` (`:116-132`) rejects a proof from a different checkout
    (`:124-126`) or a different commit/tree (`:127-129`) — the stale/borrowed-proof guard.
- **Both publish paths are wired** to capture + assert the proof:
  - `lib/commands/integrate.js:685-699`, `:1276-1299`
  - `lib/tools/forgejo.js:429-441`, `:739-753`
- **Regression coverage exists** for the proof in `test/forgejo.test.js`,
  `test/integrate.test.js`, `test/task-1039-integrate.test.js`, `test/task-1049-force-push.test.js`.
  (These were not separately confirmed to pass in isolation because the suite as a whole is red;
  the green-baseline requirement gates acceptance regardless.)

---

## FINDING 3 — CP-5 Goal Check table does not cite the required test evidence

The review contract requires the final checkpoint's Goal Check table to cite real evidence
including **test names**. `missions/task-1335/CP-5.md:34-41` has a 3-row Goal Check table that
cites only source `file:line`, no test names, and does not map to the falsifiable success
criteria that demand regression tests (SC #5 broken-tree-blocked, SC #6 exact-tree binding).
With the suite red, the checkpoint also cannot truthfully claim the gate passes.

---

## Required to clear review

1. Restore green `npm test` at the branch tip (fix the 3 regressions above; investigate the
   flaky `SC1-Fix` poll test).
2. Rebase `mission/task-1335` onto current `main` (fa67880) so the diff reflects only intended
   changes and re-run `px review --verify` against the live baseline.
3. Update CP-2/CP-5 claims to match reality and add a Goal Check table citing the proof
   regression test names.

---
`[workflow-round:2, workflow-phase:reviewing]`