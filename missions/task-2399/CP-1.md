# CP-1: Trace shared source + add failing assertions for the output contract

## Goal
Make active-work status truthful and visible (task-2399): retain working-agent
counts, remove the fabricated trailing "working" text and the unrequested
"Working" label, and give running mission cards a terminal-compatible activity
animation.

## Trace (single shared sources)
- `describeMissionWork()` in `src/application/projections/mission-activity.ts`
  is the single source of the per-mission work text. It renders
  `working (${certainty}): ${phase}` — the literal `working` word is the
  unrequested "Working" label; only `px status` consumes it.
- `● WORKING` rail stamp in `src/interfaces/tui/shell.tsx:299` is the invented
  status label in the board rail (not a mission lifecycle lane).
- Working-agent counts live in `summarizeMissionActivity()` /
  `describeMissionActivityTotals()` (`work: 1 live`) and the rail count next to
  the label — these are the authoritative-work signal and stay untouched.
- `agentIsWorking(card)` (mission-board.ts) is the shared active/running test;
  `MissionCard` (`src/interfaces/tui/mission-card.tsx`) is the card renderer.
- Ink 6.8 preserves a `\x1b[5m` (blink-on) escape through `renderToString`, so a
  blink treatment is terminal-compatible, deterministic, and needs no timer.

## Work done
- Added three deterministic failing assertions to `test/mission-activity.test.ts`
  for the new contract (TDD red phase): `describeMissionWork` drops the working
  label; `px status` omits the working label; an active `MissionCard` carries a
  `\x1b[5m` blink treatment and an idle card does not.
- Current result: 22 pass, 3 fail (the three new assertions).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Shared source of the working label traced | `src/application/projections/mission-activity.ts` `describeMissionWork`; `src/interfaces/tui/shell.tsx:299` | PASS |
| Agent-count signal left in place | `summarizeMissionActivity` / `describeMissionActivityTotals` (`work: 1 live`) | PASS |
| Failing assertions for new contract present | `test/mission-activity.test.ts`, 3 new tests red | PASS |
| `npm test -- test/mission-activity.test.ts` runs | node --test, 25 tests (22 pass / 3 fail pre-change) | PASS |

## Next action
CP-2: change `describeMissionWork`, drop the `● WORKING` rail label, add the
active-only blink to `MissionCard`, and update the affected assertions to green.
