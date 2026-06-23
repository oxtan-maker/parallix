---
event_type: reviewer_findings
timestamp: 2026-06-23T05:37:57.065Z
round: 4
phase: reviewing
actor: claude
slug: task-1335
---

# Review Findings — task-1335 (attempt 4, focus: all)

Mission: Harden parallix self-hosting publish path so broken trees cannot reach `main`.
Branch: `mission/task-1335` (rebased: `merge-base == main == fa67880`).
`px review task-1335 --verify`: **PASS** (Reviewer gate passed; verification complete; exit 0).

## Verdict: request-changes (single minor documentation fix; all functional criteria pass)

Both blockers from attempt 3 are fully resolved and every mission success criterion is now met
and proven by passing tests. The only remaining issue is one inaccurate evidence cell in a
checkpoint Goal Check table — a small but real "box checked with wrong evidence" item that this
review is explicitly tasked to catch. Once corrected this is an approve.

---

## Prior blockers — both RESOLVED

### Attempt-3 Blocker 1 (flaky `npm test` gate) — FIXED
- `test/task-1221-stale-blocked-relaunch.test.js` SC1-Fix: **0/10** failures isolated (was 5/10).
- Full suite (`npm test`): **6/6** green runs (was red 2/5).
- Principled fix: new `strictlyLaterIso()` helper guarantees strict monotonicity —
  `lib/review/review-loop.js:9-15` (`new Date(Math.max(nowMs, earlierMs + 1)).toISOString()`),
  applied at `lib/review/review-loop.js:303` in place of the racy `new Date().toISOString()`.
- `px review --verify` now passes deterministically.

### Attempt-3 Blocker 2 (SC #5 unproven + fabricated CP-5 citation) — FIXED
- Real failing-gate regression test added:
  `test/forgejo.test.js:156` — `standalone createPr refuses to publish when the configured
  verification gate fails`. It drives `captureVerifiedTreeProofFn` → `{ ok:false, error:
  'verification gate failed ... exit code 1' }` and asserts `result.ok === false`, no Forgejo API
  call, and **no `git push`** (i.e. `main` not updated). This is exactly SC #5.
- The `console.error` → `log` regression that broke the identity tests is fixed:
  `lib/review/review-commands.js` now routes the transition WARN through `log` (line ~50), and the
  `review-identity` / `task-1079` tests pass.
- CP-5's Goal Check now cites that real test name (and the two SC #6 tests). All three cited test
  names were verified to exist:
  - `finalizeVariantACloseout rejects a stale verification proof before pushing main closeout` →
    `test/integrate.test.js:1060`
  - `createPr rejects a verification proof from a different checkout before syncing primary
    baseline` → `test/forgejo.test.js:102`
  - `standalone createPr refuses to publish when the configured verification gate fails` →
    `test/forgejo.test.js:156`

---

## FINDING (minor, must-fix) — CP-1 Goal Check cites an inaccurate changed-file set

`missions/task-1335/CP-1.md:34` (Goal Check, "Distinguish code paths updated by this mission
branch from untouched surfaces") states:

> `git diff --name-only main...HEAD` shows only `integrate.js`, `forgejo.js`, `verification.js`,
> tests, and mission docs

This is factually wrong. The actual changed `lib/` files are:
```
lib/commands/integrate.js
lib/core/verification.js
lib/review/review-commands.js   <-- omitted from CP-1
lib/review/review-loop.js       <-- omitted from CP-1
lib/tools/forgejo.js
```
The cell omits `lib/review/review-loop.js` and `lib/review/review-commands.js` (the
disposition-fix / reviewer-resolution surface). The substantive SC #1 deliverable — the
enumeration of the three publish paths (`CP-1.md:8-18`) — is correct and complete; only this
"distinguish changed vs untouched" evidence cell is inaccurate. Fix the sentence to reflect the
real file list. No code change required.

---

## OBSERVATION (not blocking) — sizable reviewer-resolution refactor in review-loop.js

`lib/review/review-loop.js` carries a large change (+160/-100), much of it a rewrite of
reviewer-selection / fallback logic, alongside the disposition-persistence fix the mission
requires. Mission "Out of Scope" warns against "broad refactors of the review system unrelated to
the currently failing disposition persistence regression." This is judged **in-scope / acceptable**
because disposition polling and persistence live in this same function and the prior failing
baseline (task-1079 blocked-reviewer + disposition tests) exercised exactly this code; the change
is fully covered by the green suite (`review.test.js` 116/116; `task-1079` passes). Flagged for
awareness, not as a defect.

---

## Success criteria assessment
| # | Criterion | Status |
|---|---|---|
| 1 | Enumerate all publish paths; distinguish px integrate | Met (CP-1:8-18); minor file-list inaccuracy at CP-1:34 |
| 2 | `npm test` passes after disposition fix (PUSHBACK_ALL/BLOCKED/PARKED/CHANGES_MADE) | Met — deterministic green; `test/review.test.js` 116/116 covers all four |
| 3 | Each publish path runs repo-owned exact-tree gate; aborts on non-zero | Met — `verification.js:69-132`; `integrate.js:685-699,1272-1295`; `forgejo.js:429-441,739-753` |
| 4 | Reject stale/borrowed proof | Met — `verification.js:124-129` + tests |
| 5 | Regression: broken (failing) tree blocked from `main` | Met — `test/forgejo.test.js:156` |
| 6 | Regression: exact-tree binding (proof not reusable across trees) | Met — `test/forgejo.test.js:102`, `test/integrate.test.js:1060` |
| 7 | Notes: squash provenance loss + new audit boundary | Met — `CP-5.md` |

## Required to clear review
1. Correct the inaccurate file-list claim in `missions/task-1335/CP-1.md:34` to include
   `lib/review/review-loop.js` and `lib/review/review-commands.js`. (Documentation only.)

---
`[workflow-round:4, workflow-phase:reviewing]`