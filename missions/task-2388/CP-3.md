# CP-3: Board fingerprint covers recovered session state (task-2388)

## Summary
Updated `src/application/projections/board-subscription.ts` so `boardFingerprint`
represents the recovery state that must make the open board repaint:
- each card's `liveSession` (recovered OS-process session) is now in the digest,
- `metrics.unattributedRunningSessions` is now in the digest.

With these included, a start/stop/attribution change that only shifts recovered
session state now produces a distinct fingerprint and triggers `onChange`
(SC4 / AC #4). All other fingerprint inputs are unchanged.

Added focused coverage in `test/task-2373-refresh-performance.test.ts`
("SC6: a recovery-only state change ... repaints the board") that drives the
subscription across two projections differing only in
`unattributedRunningSessions` and asserts a second repaint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 liveSession in fingerprint | `test/task-2388-repro.test.ts` "SC4: a liveSession change repaints the board" | PASS |
| SC4 unattributed in fingerprint | `test/task-2388-repro.test.ts` "SC4: an unattributedRunningSessions change repaints the board"; `test/task-2373-refresh-performance.test.ts` "SC6: a recovery-only state change (unattributed running sessions) repaints the board" | PASS |
| Subscription repaint on recovery change | `node --test test/task-2373-refresh-performance.test.ts` → 3 pass | PASS |

## Next action
Run CP-4: run the focused regression test, complete final Goal Check evidence,
and run `./scripts/verify-local.sh static-analysis` and `all`.
