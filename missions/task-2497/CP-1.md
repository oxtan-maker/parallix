# CP-1 — Red TASK-2492 reproduction

Added a focused recovery-path reproduction for an active mission whose payload
is already contained in `main`. The pre-fix assertion fails with `action =
none`, establishing the missing detection path before implementation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2492 active/active containment regression is locked before the fix | `test/task-2446-repro.test.ts`, `"TASK-2492: an active mission already on main is refused, not re-reviewed"` | PASS (red precondition observed) |
| Pre-fix recovery does not recognize the landed payload | `npm test -- test/task-2446-repro.test.ts` reports expected `none` versus `refused-integrated` | PASS (red precondition observed) |

Next action: add authoritative branch-to-main containment detection to the recovery command seam, then make this reproduction green.
