# CP-2 — Revision-aware recovery that invalidates the stale approval

## Summary

The bypass lived at one point: `routeIntegrationGateFailure` reported the
merge-permitting `fixed` route whenever the identical gate set re-ran green
after an implementer repair, without asking whether the repair changed the
mission diff the reviewer had approved. `src/application/integrate/gates.ts`
merges on exactly that route, so a repaired revision landed under an approval
given to the revision before it.

### Production change

- `src/adapters/cli/commands/integrate-gate-rebound.ts`
  - Captures the mission tree once *before* the implementer relaunch (the
    revision the approval was given to) and once after a `fixed` outcome (the
    revision that would land). The comparison uses the existing
    `captureFinalIntegrationTree` seam, so it is a truthful observation of the
    worktree, not an inference about approval validity. An unreadable tree on
    either side counts as changed: "unchanged" is the claim that has to be
    proven.
  - Adds the `revision-changed` route. `gates.ts` already aborts before the
    merge for every non-`fixed` route, so no landing-path change was needed —
    the existing abort is the merge boundary.
  - Adds `standingApprovalHolders`, `invalidateApprovedPrReview`, and
    `staleApprovalSummary`. Retraction posts a `request-changes` review as each
    login that actually holds a standing approval (the repo default user and/or
    the configured reviewer). It is per-reviewer because approval is:
    `getLatestReviewDecision` keeps a login's approval standing until that same
    login posts a later formal decision, so a third party's verdict would leave
    the approval intact. A login whose token is missing, or a post the provider
    rejects, is reported as a failure — the merge is refused either way, and an
    unretractable approval is never silently treated as cleared.
  - The route names both revisions and tells the operator to run
    `px review <slug> --start` for the repaired revision.
- `src/application/integrate/gates.ts` — forwards `context.branch`,
  `context.approval`, and `context.configuredReviewer` to the route.
- `src/application/integrate/context.ts` — exposes `configuredReviewer`, the
  login already derived from the recorded review round for the TASK-2420
  approval lookup. It was computed in place and discarded; retraction needs the
  same login, and deriving it anywhere else would risk retracting as an account
  that never approved.
- `docs/agents.md` — new section "An integration-gate repair cannot land under
  the old approval", documenting the durable invariant, both retry outcomes, and
  the fail-closed behaviour when an approval cannot be retracted.

### What deliberately did not change

Gate selection, gate execution, the integration-error evidence handed to the
implementer, the persisted rebound budget, the base-branch reproduction probe
and its no-mutation guarantee (TASK-2507), and the pre-landing lane guard
(TASK-2517). No review state is synthesized: the `request-changes` posted is a
real provider decision by the account that granted the approval, and the
mission's own re-entry into review goes through the ordinary `px review` path.

### Subsequent-run behaviour

Once the approval is retracted, a later `px integrate` finds no authoritative
provider approval and hits the existing recovery guard in
`src/application/integrate/recovery.ts` — "has a stored approval without the
required provider approval" — which aborts. The changed revision therefore
cannot land on the prior approval in this run or any later one.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The reproduction test is red before the fix and green after | `test/task-2528-repro.test.ts`; `npm test` — 2651 pass, 0 fail, including `"TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval"` | Green |
| The approved PR is invalidated before any subsequent integration can land the changed revision | `invalidateApprovedPrReview` / `standingApprovalHolders` in `src/adapters/cli/commands/integrate-gate-rebound.ts`; asserted by `"TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval"` in `test/task-2528-repro.test.ts` | Done |
| The changed revision routes to review and requires a fresh approval before landing | The `revision-changed` route is non-`fixed`, and `src/application/integrate/gates.ts` aborts before merge for every non-`fixed` route — pinned by `"TASK-2492: a non-fixed route aborts before merge (IntegrationAbort → exit 1)"` in `test/task-2492-integrate-gate-bounce.test.ts`; the later-run refusal is the existing guard in `src/application/integrate/recovery.ts` | Done |
| An unchanged post-error retry still lands on its existing approval | `"TASK-2528: an unchanged retry after the same integration error still lands on its existing approval"` in `test/task-2528-repro.test.ts`; also `"TASK-2492: a mission regression inside budget bounces once, re-runs the gates, and reports fixed"` in `test/task-2492-integration-gate-rebound.test.ts` still reports `fixed` | Done |
| Gate execution, evidence capture, bounded rebounds, and the pre-landing guard are not weakened | `test/task-2492-integration-gate-rebound.test.ts`, `test/task-2507-mainline-gate-mutation-repro.test.ts`, `test/task-2504-repro.test.ts`, and `test/task-2517-integrate-rebound-landing-guard.test.ts` all pass unchanged under `npm test` | Done |
| Lint and static analysis clean on every changed file | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | Pass |
| Docs reflect the user-facing behaviour change | `docs/agents.md`, section "An integration-gate repair cannot land under the old approval"; `./scripts/verify-local.sh docs` passes | Pass |
| `./scripts/verify-local.sh all` succeeds on the completed mission tree | Runs in CP-3 | Pending |

Next action: run `./scripts/verify-local.sh all` on the committed tree and
record the result in CP-3.
