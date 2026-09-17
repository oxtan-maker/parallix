# CP-3 — Unchanged-retry coverage and final verification

## Summary

Extended `test/task-2528-repro.test.ts` from two tests to five, so both
post-error retry paths and the retraction mechanism itself are pinned, and ran
the repository verification gate on the committed tree.

### Coverage added

- `TASK-2528: only the logins holding a standing approval are retracted` —
  `standingApprovalHolders` over the four shapes that matter: both the repo
  default user and the configured reviewer approved, reviewer only, default user
  only, and an unreadable approval (which names no holder rather than guessing
  one). This is the guard against over-invalidation at the account level, the
  mirror of the unchanged-retry guard at the revision level.
- `TASK-2528: the approval is retracted as the approving login, not the integrating one` —
  exactly one `request-changes` per standing approval, posted as the login whose
  approval it retracts, with both revisions named in the body.
- `TASK-2528: an approval that cannot be retracted is reported and still refuses the merge` —
  a missing token is an error, never a silent skip, and the `revision-changed`
  route (the non-`fixed` route the caller refuses to merge on) is returned even
  when the retraction itself fails. Fail-closed in both directions: an approval
  that cannot be cleared is neither treated as cleared nor as still valid.

The unchanged-retry path keeps its original test,
`TASK-2528: an unchanged retry after the same integration error still lands on its existing approval`,
which drives the whole recovery with an implementer relaunch that leaves the
mission tree alone and asserts the route stays `fixed` with nothing retracted.

`graphify update .` was run after the code change, as the repository's agent
instructions require.

### Non-regression

No integration gate, gate selection, evidence-capture, bounded-rebound,
base-branch-probe, or pre-landing-guard behaviour was modified in this mission;
their existing suites pass unchanged inside the same run.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A regression test red at the mission parent commit passes after the implementation | `test/task-2528-repro.test.ts`, test `"TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval"` — documented red in `missions/task-2528/CP-1.md` (`actual: 'fixed'`, `operator: 'notStrictEqual'`), green under `./scripts/verify-local.sh all` | Pass |
| An integration error followed by a mission-diff change invalidates the approved PR before any subsequent integration can land it | `invalidateApprovedPrReview` and `standingApprovalHolders` in `src/adapters/cli/commands/integrate-gate-rebound.ts`; tests `"TASK-2528: the approval is retracted as the approving login, not the integrating one"` and `"TASK-2528: only the logins holding a standing approval are retracted"` in `test/task-2528-repro.test.ts` | Pass |
| The changed revision routes to review and needs a fresh approval before integration may land it | The `revision-changed` route is non-`fixed`; `src/application/integrate/gates.ts` aborts before merge for every non-`fixed` route, pinned by `"TASK-2492: a non-fixed route aborts before merge (IntegrationAbort → exit 1)"` in `test/task-2492-integrate-gate-bounce.test.ts`. A later run is refused by the existing stored-approval-without-provider-approval guard in `src/application/integrate/recovery.ts` | Pass |
| An unchanged post-error retry remains eligible to land without a new review round | `"TASK-2528: an unchanged retry after the same integration error still lands on its existing approval"` in `test/task-2528-repro.test.ts`; `"TASK-2492: a mission regression inside budget bounces once, re-runs the gates, and reports fixed"` in `test/task-2492-integration-gate-rebound.test.ts` still reports `fixed` | Pass |
| Targeted coverage exercises both retry paths without weakening gate execution, evidence capture, bounded rebounds, or the pre-landing guard | `test/task-2528-repro.test.ts` (5 tests, both paths); `test/task-2492-integration-gate-rebound.test.ts`, `test/task-2507-mainline-gate-mutation-repro.test.ts`, `test/task-2504-repro.test.ts`, `test/task-2517-integrate-rebound-landing-guard.test.ts` all pass unchanged | Pass |
| `./scripts/verify-local.sh all` succeeds on the completed mission tree | `./scripts/verify-local.sh all` — exit 0, 2654 tests, 0 fail | Pass |
| Lint and static analysis clean on every changed file | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | Pass |
| No focused or unannotated skipped tests introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage reports no violations | Pass |
| Docs reflect the user-facing behaviour change | `docs/agents.md`, section "An integration-gate repair cannot land under the old approval"; `./scripts/verify-local.sh docs` passes | Pass |

Next action: hand off to review — `px review task-2528 --start` — so the
integration-gate recovery change is reviewed on the revision that would land.
