# CP 2 — Display-aligned normalization at the refresh seam

## Summary of work done

Traced `boardFingerprint` (src/application/projections/board-subscription.ts), the `AgentStrip` countdown formatter (src/interfaces/tui/agent-strip.tsx), and all callers (the `subscribeToBoardProjection` tick path with production callers `src/interfaces/tui/ui-command.ts` (Ink board) and `src/interfaces/web/host.ts` (web invalidation driver), plus `test/task-2388-repro.test.ts` and `test/task-2373-refresh-performance.test.ts`). Implemented the smallest display-aligned normalization:

> Correction (review round 1, finding F1): this trace originally listed only the tick path and the two test files, missing the `src/interfaces/web/host.ts` production caller. That omission is how the display-aligned comparison first reached the web board's change detector. The repair scopes the comparison to the Ink subscription: `displayedCountdown` is an opt-in `BoardSubscriptionOptions` flag that only `src/interfaces/tui/ui-command.ts` sets; the web host keeps the default raw comparison and `src/interfaces/web/` was not touched (a Restricted Area of this mission).

- New pure shared formatter `formatCountdown` in `src/application/projections/agent-countdown.ts` — byte-identical logic to the previous `AgentStrip`-local formatter, including the `∞` and zero cases. No Ink/React/process imports; application-layer module.
- `src/interfaces/tui/agent-strip.tsx` now imports that formatter instead of its private copy, so rendered countdown and fingerprint normalization share one implementation (the mission's risk mitigation: same formatting semantics on both sides).
- `boardFingerprint` in `src/application/projections/board-subscription.ts` now compares, per agent, exactly what `AgentStrip` renders: `family`, `available`, the *displayed* countdown text (or `null` where the strip renders none — the strip's own guard: available agents and `blockedForMs <= 0`), `reason`, and `runningSessions`. Raw `blockedForMs` no longer moves the fingerprint. All non-countdown fingerprint fields (cards with status/lane/gate/agent/review facts/blockingReason/currentWork/liveSession, attention queue kinds, repositoryId, unattributedRunningSessions, sourceFacts) are unchanged.
- `subscribeToBoardProjection` is untouched in behavior: the projection builder is still invoked on every timer callback; only publish-eligibility changed.
- No polling-interval change, no skipped builds, no watcher/bus/cache, no new dependency, no layer-boundary change (TUI→application import direction already existed).
- Test file adjusted so the mounted Ink assertions run before `unmount()` (a debug-mode unmount writes its own final frame and would pollute the content-frame count).

Red/green flip verified by stashing the `src/` fix and re-running: at the parent state all 3 repro tests fail (`2 !== 1` on the notification count); with the fix all 3 pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: same-label blocked countdown → one notification, one mounted Ink frame | `test/task-2442-repro.test.ts`, `SC1: a same-label blocked countdown emits one notification and no second mounted Ink frame`, `SC1: a raw blockedForMs change that renders the same countdown does not re-publish` — pass with fix; fail at parent (`2 !== 1`) | PASS |
| SC2: every scheduled tick still invokes the projection builder | `test/task-2442-repro.test.ts`, `SC2: every scheduled tick invokes the projection builder even when the fingerprint is unchanged` (5 fake ticks → 5 builds) | PASS |
| One display-normalization rule shared by renderer and fingerprint | `src/application/projections/agent-countdown.ts` (`formatCountdown`); `src/interfaces/tui/agent-strip.tsx` imports it | PASS |
| Fingerprint preserves all non-countdown displayed fields | `boardFingerprint` in `src/application/projections/board-subscription.ts`; `test/task-2388-repro.test.ts` (`SC4: a liveSession change repaints the board`, `SC4: an unattributedRunningSessions change repaints the board`) still pass | PASS |
| No polling/build-skip/watcher/cache/dependency introduced | `src/application/projections/board-subscription.ts` tick loop unchanged (builder call on every timer callback); diff limited to the three seam files above | PASS |
| Adjacent suites unaffected | `npx tsx --test test/agent-strip.test.ts test/mission-activity.test.ts test/task-2373-refresh-performance.test.ts test/task-2388-repro.test.ts` → 52/52 pass | PASS |
| Static-analysis gate | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint, tsc, test-hygiene, test typecheck) | PASS |

Next action: CP-3 — add the deterministic focused coverage for day/hour/minute boundary crossings, expiry-to-available, the indefinite case, and each SC4 non-countdown state change to `test/task-2442-repro.test.ts`, then run the three mission-declared gates and record their results.
