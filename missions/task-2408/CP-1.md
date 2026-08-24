# CP 1 — Reproduction test authored (red on parent)

## Work done
Traced the operator rail and agent-strip render path. Confirmed the unsupported
content lives in `src/interfaces/tui/shell.tsx`: the rail renders a live-work
count (`projection.stages.flatMap(...).filter(agentIsWorking).length`) and a
`WorkingItems` block (`task-… · phase · agent`) above `▲ NEEDS YOU NEXT`, and
the raw block reason reaches the UI through
`src/interfaces/tui/agent-strip.tsx` (`agent.reason` rendered verbatim).

Authored `test/task-2408-board-hallucinated-content-repro.test.ts` rendering a
board with one live mission (`task-2406 · execute · codex`), one attention item
(`task-9000`, `review-lane`), and one unavailable `qwen` family whose stored
reason is the reported quota regular expression.

Verified red on the mission parent commit `083756c4d`:
- rail test fails: `task-2406 · execute · codex` precedes the heading
- reason test fails: the strip renders `parsed: (?:\b429\b...)`

Both assertions will pass after the CP 2 display-boundary repair.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test authored and red on parent | `test/task-2408-board-hallucinated-content-repro.test.ts`, `"task-2408: the operator rail begins with ▲ NEEDS YOU NEXT and shows no live-work rows"` + `"task-2408: a raw persisted agent-block reason is not rendered on the agent strip"` | PASS |
| Red on parent commit `083756c4d` | `FORCE_COLOR=0 npx tsx --test test/task-2408-board-hallucinated-content-repro.test.ts` → 2 fail | PASS |
| Green expected after repair | same test names | TODO |

## Next action
Run CP 2: edit `src/interfaces/tui/shell.tsx` to drop the rail count + `WorkingItems`, then `src/interfaces/tui/agent-strip.tsx` to reject the raw reason at the display boundary; re-run the repro (expect green).
