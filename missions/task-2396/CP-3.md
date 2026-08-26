# Checkpoint 3 — Existing flows preserved on re-draft

## Work done

Confirmed the base-branch correction does not alter the two existing re-draft
flows the mission must preserve (Success Criteria #4):

- **New mission branch creation** — `ensureMissionBranch` still creates from
  `baseBranch || getPrimaryBranch()`. A new mission from `main` has a falsy
  `recordedBase`, so it branches from `main`. This path is unchanged by the
  checkpoint-2 writer fix (that fix only touches `ensureMissionBaseBranchRecorded`).
  Covered by `test/draft.test.ts`, `"ensureMissionBranch creates branch from main when absent"`
  and `"ensureMissionBranch skips creation when branch already exists"`.
- **Existing-mission worktree reuse** — added
  `test/draft.test.ts`, `"runDraftCommand reuses the existing mission branch and clears the stale base on a primary re-draft"`.
  It seeds an existing mission with `Base-Branch: friday-08-21`, re-runs draft
  from `main`, and asserts the pre-existing `mission/task-reuse` branch is
  reused (ensured once, not rebuilt off the stale base) while the recorded base
  is corrected to `main`. This distinguishes reuse from the base correction.

The non-primary re-draft path (CP-2 green case) is covered by
`"runDraftCommand records a non-primary launch branch over a previous base on re-draft"`.

Full draft suite: `npx tsx test/run-default-tests.ts test/draft.test.ts` →
73 tests, 0 failures.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| New mission branch creation retains prior behavior (branches from primary) | `test/draft.test.ts`, `"ensureMissionBranch creates branch from main when absent"` | PASS |
| Existing-mission worktree reuse retains prior behavior while base is corrected | `test/draft.test.ts`, `"runDraftCommand reuses the existing mission branch and clears the stale base on a primary re-draft"` | PASS |
| Non-primary re-draft records the new launch branch | `test/draft.test.ts`, `"runDraftCommand records a non-primary launch branch over a previous base on re-draft"` | PASS |
| Full draft suite green with the fix | `npx tsx test/run-default-tests.ts test/draft.test.ts` → 73 pass, 0 fail | PASS |

Next action: Run the required gate `./scripts/verify-local.sh all` and write the final checkpoint (CP-4).
