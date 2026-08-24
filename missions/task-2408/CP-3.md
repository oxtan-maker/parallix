# CP 3 — Final verification and Goal Check

## Work done
Ran the mission gate on the final committed tree and inspected the diff for
scope compliance. All Success Criteria are met and falsifiable.

Final diff touches only display-boundary files:
- `src/interfaces/tui/shell.tsx` — removed the rail live-work count row and the
  `WorkingItems` block (and the unused `agentIsWorking` import).
- `src/interfaces/tui/agent-strip.tsx` — added `displayBlockReason()` to reject
  the `parsed:` raw-payload reason at the display boundary.
- `test/task-2408-board-hallucinated-content-repro.test.ts` — new repro.
- `test/task-2373-operator-rail.test.ts`, `test/tui-wave-4-attention.test.ts` —
  updated to the new rail contract.

Out-of-scope files left untouched: `src/application/projections/mission-activity.ts`,
attention ranking/projection, agent-block persistence, quota detection
(`src/application/services/agent-limit.ts`), `px status`, board commands, lanes.

Known pre-existing failure (unrelated, out of scope): `scripts/benchmark-runtime.ts`
fails `tsc --project tsconfig.scripts.json` (`loadReview` vs `loadReviews`,
introduced by task-2404). The `src/` typecheck is clean and the mission gate
`./scripts/verify-local.sh all` passes. Not fixed: outside this mission's scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro red on parent, green after repair | `test/task-2408-board-hallucinated-content-repro.test.ts`, `"task-2408: the operator rail begins with ▲ NEEDS YOU NEXT and shows no live-work rows"` + `"task-2408: a raw persisted agent-block reason is not rendered on the agent strip"` | PASS |
| Rail first content is `▲ NEEDS YOU NEXT 1`, no count/working row before | `test/task-2408-board-hallucinated-content-repro.test.ts` asserts `▲ NEEDS YOU NEXT 1` match and `task-2406 · execute · codex` absent; `test/task-2373-operator-rail.test.ts` SC15/SC16 | PASS |
| Attention mission, action text, ranking footer retained | `test/task-2408-board-hallucinated-content-repro.test.ts` matches `task-9000` and `ranked: integrate>review>active`; `test/tui-wave-4-attention.test.ts` | PASS |
| Source-status indicator + `work:` summary + `px cmd` liveness retained | `test/task-2408-board-hallucinated-content-repro.test.ts` matches `px cmd live` and `work: 1 live`; `test/agent-strip.test.ts` | PASS |
| Raw persisted reason `parsed: (?:\b429\b...)` not rendered; family still unavailable | `test/task-2408-board-hallucinated-content-repro.test.ts`, `"task-2408: a raw persisted agent-block reason is not rendered on the agent strip"` | PASS |
| Mission gate passes on final tree | `./scripts/verify-local.sh all` → 2078 pass, 0 fail (exit 0) | PASS |
| Static analysis clean on changed files | ESLint exit 0 and `tsc --noEmit` (src) exit 0 on changed source files `src/interfaces/tui/shell.tsx:1` and `src/interfaces/tui/agent-strip.tsx:1`; repro `test/task-2408-board-hallucinated-content-repro.test.ts` | PASS |

## Next action
None — all declared checkpoints committed and the mission gate `./scripts/verify-local.sh all` passes. Mission ready for lifecycle handoff (not performed: `px review` is parallix-owned).
