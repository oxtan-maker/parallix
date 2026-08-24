# CP-2: Remove working label, drop Working stamp, add active-only card animation

## Goal
Make active-work status truthful and visible (task-2399).

## Work done
Smallest shared change that satisfies the output contract:

- `src/application/projections/mission-activity.ts` — `describeMissionWork` no
  longer emits the literal `working` word; it returns `(${certainty}): ${phase}`,
  keeping the trust grade and phase (both grounded in the published work fact).
  The agent-mission count stays in `describeMissionActivityTotals`.
- `src/interfaces/tui/shell.tsx:298` — the `● WORKING` rail label was an
  invented status; only the active-mission count next to it remains.
- `src/interfaces/tui/mission-card.tsx` — a card an agent is working on
  (`agentIsWorking`) gets a steady ANSI blink (`\u001b[5m` … `\u001b[25m`) on its
  marker; cards outside that state get none. No timer, no terminal negotiation,
  no new dependency — Ink forwards the escape through `renderToString`.
- `test/mission-activity.test.ts` — updated the four assertions that pinned the
  old `working (...)` strings and added the three contract assertions from CP-1
  (now green).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Active-agent count retained, fabricated text removed | `describeMissionActivityTotals` `work: 1 live`; `describeMissionWork` no longer emits `working` | PASS |
| Literal "Working" text absent from active render | `test/mission-activity.test.ts`, `px status omits the working label from the active mission work line` | PASS |
| Active/running card animated; others not | `test/mission-activity.test.ts`, `an active mission card receives a terminal-compatible activity treatment and an idle card does not` | PASS |
| Focused test suite green | `npm test -- test/mission-activity.test.ts`, 25 tests | PASS |
| Static-analysis gate | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action
CP-3: run the full `./scripts/verify-local.sh all` gate and record final evidence.
