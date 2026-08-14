# CP-6 — Honest operator rail (SC15–SC18)

## Summary of work done

The board’s operator rail now uses the same `agentIsWorking` authority as the
projection, including its bounded legacy/recovery fallback. It renders the
first three live missions and explicitly reports `+N more` when the WORKING
count exceeds the visible rows. Recovery-only activity is labelled `recovery
evidence` rather than silently treated as an ordinary published work fact.

Attention actions now expose their actual availability. Review and integration
remain deliberately unavailable from this board because their application use
cases are not wired into `BoardCommandController`; they render `unavailable`
rather than the green `run ▶` affordance. Enter uses the same typed action and
reports the controller’s unavailable result instead of opening a confirmation.
The command text remains projection-owned through `AttentionAction`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC15 — WORKING count accounts for hidden live rows | `test/task-2373-operator-rail.test.ts`, `"SC15: WORKING count either renders every live mission or states the hidden overflow"` | PASS |
| SC16 — bounded recovery evidence is visible instead of disappearing | `test/task-2373-operator-rail.test.ts`, `"SC16: bounded recovery evidence remains visibly WORKING with an uncertainty label"` | PASS |
| SC17 — unavailable attention actions do not render as green runnable actions | `test/task-2373-operator-rail.test.ts`, `"SC17 and SC18: unavailable review and integration actions never render a green runnable affordance"` | PASS |
| SC17 — typed action text and confirmation command stay aligned | `test/tui-wave-4-attention.test.ts`, `"attention action display and its typed confirmation command stay aligned"` | PASS |
| SC18 — unavailable review commands report unavailable without dispatching | `test/tui-command-flow.test.ts`, `"Ctrl+R on card produces unavailable outcome without dispatching"` | PASS |
| CP6 focused regression set | `npx tsx --test test/task-2373-operator-rail.test.ts test/tui-wave-4-attention.test.ts test/tui-command-flow.test.ts` | PASS |
| Test typecheck | `npx tsc --noEmit --project tsconfig.test.json` | PASS |

Next action: CP-7 — make `q`, Ctrl+C, modal quit, and SIGTERM terminate a real spawned
interactive board without leaking its projection subscription, terminal state, or client
resources.
