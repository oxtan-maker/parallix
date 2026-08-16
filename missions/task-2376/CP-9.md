# CP-9 — Contradiction/dead-code sweep

## Summary

Searched all patterns from backlog task contradiction sweep. Results:

| Pattern | Status |
|---|---|
| `requireStatus(mission, ['review', 'integration']` | Gone — CP-5 changed to `['integration']` only |
| `type: 'submit-for-review'` | Present in handoff, board-event, mission-workflow, integrate — all correct |
| `type: 'approve'` | Present in review, mission-workflow, review-state, integrate — all correct |
| `type: 'integrate'` | Present in mission-integration-service, mission-workflow — correct |
| `decidedAt` | Used correctly in review domain, review-state approve wiring, backlog adapter |
| `new Date().toISOString()` | One usage in mission-integration-service for `occurredAt` fallback — correct |
| `deriveFixRoundsFromTaskText` | Deleted (CP-6) |
| `deriveFixRoundsFromReviewStateHistory` | Deleted (CP-6) |
| `deriveFinalImplementerFromBranchHistory` | Deleted (CP-6) |
| `deriveImplementerAndFixRoundsFromPrComments` | Deleted (CP-6) |
| `branch-history` source | Deleted (CP-6) |
| `pr-comments` source | Deleted (CP-6) |
| `backlog-fallback` source | Deleted (CP-6) |
| `unknown-fallback` source | Deleted (CP-6), replaced by `missing-authority` |
| `MissionStore?` (optional) | Not found — `deriveImplementerAndFixRounds` accepts optional param but missing store yields `missing-authority` |

No contradictions found. All patterns classified and consistent with mission invariants.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No `requireStatus(['review', 'integration'])` | `grep -rn "requireStatus.*review.*integration" src/` — 0 matches | PASS |
| Obsolete inference functions deleted | `grep -rn "deriveFixRoundsFromTaskText\|deriveFixRoundsFromReviewStateHistory\|deriveFinalImplementerFromBranchHistory\|deriveImplementerAndFixRoundsFromPrComments" src/` — 0 matches | PASS |
| Obsolete source strings deleted | `grep -rn "branch-history\|pr-comments\|backlog-fallback\|unknown-fallback" src/` — 0 matches | PASS |
| New `missing-authority` source present | `src/adapters/cli/commands/stats.ts:391` | PASS |
| Type check clean | `npx tsc --project tsconfig.test.json --noEmit` | PASS |

Next action: CP-10 — full verification.
