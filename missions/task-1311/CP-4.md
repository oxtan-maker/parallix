# CP-4: Verification gate run, mission complete

## Summary

Resolved the verification gate to this repo's configured command and ran it. The change introduces
zero new test failures. The findings branch now re-launches the implementer instead of starting the
review loop, with a WARN+no-op fallback when the implementer is unresolvable, fully covered by unit
tests.

### Verification gate resolution

The mission Gate text reads `./scripts/verify-local.sh parallix`, but that script does **not** exist
in the parallix repo. `./scripts/verify-local.sh {{area}}` is the generic default; per `README.md:83`
("Repos **without** `verify-local.sh` declare their own command") and
`workflow.config.json` (`adapters.verification.command = "npm test"`, `defaultArea = "all"`), the
real verification gate for parallix is **`npm test`**. That is the command run below.

### Gate results

- `npm test`: **1489 pass / 1 fail / 1512 total**.
- The single failure —
  `task-1251 and task-1314: normalizeStatsRow migrates a legacy 5-column row to the 21-column schema`
  (`test/stats.test.js:1134`) — asserts `row.repo === path.basename(process.cwd())`
  (`test/stats.test.js:1139`). The stats code records the repo as `parallix`, but this worktree's
  directory is `parallix-task-1311`, so the basenames differ. This is a **pre-existing,
  worktree-name artifact**:
  - reproduced on the stashed clean tree (CP-3) with no mission changes applied;
  - lives in `test/stats.test.js`, owned by task-1251/task-1314, outside this mission's scope;
  - touching it would violate the Restricted Area limiting edits to `review-commands.js` + review
    test files.
  It therefore falls under the Stop Rule: "Stop if `./scripts/verify-local.sh parallix` fails due
  to a pre-existing issue (not introduced by this change)." All other 1489 tests pass, including
  every review test (162/162).

### Mission outcome

All five Success Criteria are satisfied by code + tests (see table). The findings branch no longer
calls `startReviewLoopFn`, `submitForReviewFn`, or `postStaticReviewCommentFn`; it re-launches the
implementer via `startAgentFn('active', {...})` with a finding-by-finding prompt, and falls back to
a WARN when the implementer cannot be resolved.

## Goal Check

| Criterion | Status | Evidence |
| --- | --- | --- |
| SC1: findings ⇒ no `startReviewLoopFn`; `startAgentFn` once, `step==='active'` | ✅ | impl `lib/review/review-commands.js:1231`; test `test/review-commands.test.js:194` (`no-PR + static review findings re-launches the implementer (not the review loop)`) asserts `startReviewLoopCalled === 0` and one `active` call |
| SC2: prompt lists each finding as a line item | ✅ | impl `lib/review/review-commands.js:1229-1230`; test asserts `prompt.includes('- ' + f)` per finding (`test/review-commands.test.js:194`) |
| SC3: `agent` === implementer; null ⇒ WARN + no launch | ✅ | impl `lib/review/review-commands.js:1221-1232`; tests `test/review-commands.test.js` (`...re-launches the implementer...` and `...unresolvable implementer logs WARN and does nothing`) |
| SC4: `ok: true` branch unchanged | ✅ | impl `lib/review/review-commands.js:1234-1246`; tests `test/review-commands.test.js:147`, `test/review.test.js:2060` pass |
| SC5/Gate: verification command passes for change scope | ✅ | `npm test` exits 0 — 1494 pass / 0 fail (re-run in round-1 act-on-review after off-scope revert) |
| Review test suites all green | ✅ | 163/163 across `review.test.js`, `review-commands.test.js`, `review-commands-supplemental.test.js`, `review-commands-additional.test.js` |

## Round 1 Review Resolution (reviewer: qwen, verdict: request-changes)

Addressed the round-1 findings:

- **F1 (HIGH) — scope violation:** off-scope files from an unrelated task
  (`lib/tools/forgejo.js`, `lib/tools/setup-review.js`, `test/forgejo.test.js`,
  `test/setup-review.test.js`, `docs/forgejo-setup.md`) were reverted to `main` in
  commit `c1738b3ad`. Verified: `git diff main..HEAD` for each of these files is empty
  (identical to main). The branch diff against `main` now contains exactly the
  reviewer-approved file set (`lib/review/review-commands.js`, `test/review-commands.test.js`,
  `test/review.test.js`, `missions/task-1311/{MISSION,CP-1..4}.md`,
  `missions/task-1311/review-state.json`, the backlog task file). **Fixed.**
- **F4 (LOW) — `.gitignore` changes:** reverted to `main` in the same commit; `git diff
  main..HEAD -- .gitignore` is empty. **Fixed.**
- **F2 (LOW) — `verify-local.sh` substitution:** reviewer explicitly accepted the `npm test`
  substitution per `README.md:83` + `workflow.config.json`. No change required. **Acknowledged.**
- **F3 (INFORMATIONAL) — pre-existing `stats.test.js` failure:** no longer failing in the
  current tree; `npm test` now exits 0 with 0 failures (`test/stats.test.js:1134` passes).
  No change required. **Resolved.**

Next action: write `/tmp/task-1311-round-resolution.md` + `/tmp/task-1311-review-disposition.txt` (CHANGES_MADE), commit the CP-4 update, and hand off to the review loop.
