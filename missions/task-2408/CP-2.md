# CP 2 — Display-boundary repair

## Work done
Made the smallest display-boundary change that removes only the unsupported rail
content and the raw-payload leak, preserving all supported facts.

**Operator rail (`src/interfaces/tui/shell.tsx`).** Deleted the live-work count
row and the `WorkingItems` block (and the now-unused `agentIsWorking` import)
from the operator rail. The rail's first content is now exactly
`▲ NEEDS YOU NEXT <attnCount>`, followed by the attention items and the
`ranked: integrate>review>active` footer. The authoritative mission-work totals
stay in the agent strip's `work:` summary (untouched).

**Agent-strip reason boundary (`src/interfaces/tui/agent-strip.tsx`).** Added
`displayBlockReason()`, a display-boundary guard: a persisted reason of the
internal `parsed: <regex source>` form (the quota-matching regex leaked from
`agent-limit.ts:251`) is replaced with the neutral `usage limit reached`
vocabulary the fallback block reason already uses; every other human-written
launcher or block reason passes through unchanged. The family still renders as
unavailable with its red dot, countdown, and `px cmd` liveness evidence.

**Updated two tests that encoded the removed behavior:**
- `test/task-2373-operator-rail.test.ts` SC15/SC16 now assert the rail begins
  with the attention heading and that no working row precedes it.
- `test/tui-wave-4-attention.test.ts` "working work is separate from NEEDS YOU"
  now asserts the working row is gone and the `work:` summary is retained in the
  strip.

No changes to attention ranking/projection, mission-activity, agent-block
persistence, quota detection, or `px status`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Rail begins with `▲ NEEDS YOU NEXT` | `test/task-2408-board-hallucinated-content-repro.test.ts`, `"task-2408: the operator rail begins with ▲ NEEDS YOU NEXT and shows no live-work rows"` | PASS |
| Raw persisted reason not rendered | `test/task-2408-board-hallucinated-content-repro.test.ts`, `"task-2408: a raw persisted agent-block reason is not rendered on the agent strip"` | PASS |
| Attention/summary/px cmd retained | `test/task-2408-board-hallucinated-content-repro.test.ts` (matches `task-9000`, `ranked: integrate>review>active`, `px cmd live`, `work: 1 live`) | PASS |
| Existing attention coverage green | `test/tui-wave-4-attention.test.ts`, `test/task-2373-operator-rail.test.ts`, `test/agent-strip.test.ts` (2078 tests) | PASS |
| Repro green after repair | `FORCE_COLOR=0 npx tsx --test test/task-2408-board-hallucinated-content-repro.test.ts` | PASS |

## Next action
Run CP 3: re-run `./scripts/verify-local.sh all` and inspect the final diff for scope compliance; record the Goal Check evidence.
