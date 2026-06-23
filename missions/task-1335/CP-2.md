# CP-2: Baseline and verification source captured

## Summary

Confirmed the verification source of truth this mission is binding to, and captured the branch's
current gate snapshot so the later checkpoints do not overclaim.

- The standalone verification command still comes from `workflow.config.json` through
  `resolveVerificationAdapter()` / `runVerificationGate()`.
  Evidence: `lib/core/verification.js:14-23`, `:35-50`.
- The new proof helpers execute that configured command against the publish checkout, not an
  unrelated worktree.
  Evidence: `lib/core/verification.js:69-113`.
- The mission's required persisted-disposition cases are explicitly covered in
  `test/review.test.js` for `PUSHBACK_ALL`, `BLOCKED`, `PARKED`, and `CHANGES_MADE`,
  and the backlog-task transition contract is covered separately in
  `submitReviewRound()` / `consumeArtifacts()` tests.
  Evidence: `test/review.test.js`, `test/review-commands-supplemental.test.js`,
  `test/task-1209-consume-artifacts.test.js`.

### Gate snapshot taken while writing checkpoints

- `node --test test/integrate.test.js test/forgejo.test.js test/task-1039-integrate.test.js`
  passed: **117/117**.
- `node --test test/review.test.js` passed: **114/114** after restoring the no-PR guidance,
  fixing-phase resume, and provider-backed backlog-transition paths.
- `node --test test/review-commands-supplemental.test.js test/task-1209-consume-artifacts.test.js`
  passed: **39/39**.
- `npm test` passed from the repo root on **3 consecutive runs**:
  **1606 pass, 0 fail, 22 skipped** each run.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| Verification source of truth identified from repo config | Done | `lib/core/verification.js:14-23`, `:35-50` |
| Proof execution shown to use the configured gate against the publish checkout | Done | `lib/core/verification.js:76-88` |
| Required persisted dispositions and backlog transitions have deterministic coverage on this branch | Done | `test/review.test.js`, `test/review-commands-supplemental.test.js`, `test/task-1209-consume-artifacts.test.js` |
| Current branch gate state recorded honestly | Done | targeted tests: `integrate/forgejo/task-1039`: 117/117 pass; `test/review.test.js`: 114/114 pass; review-command/task-1209 targeted suite: 39/39 pass; `npm test`: 1606 pass / 0 fail / 22 skipped on 3 consecutive runs |

## Next action

Document the proof object itself and the exact fail-closed checks now injected into each publish
path.
