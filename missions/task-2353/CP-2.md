# CP-2 — Declared-gate rebounce repair

Declared pre-review gate exits now enter the deterministic `GitBlockers —
AutoRepair` path unless the diagnostic explicitly identifies a human-only
infrastructure or state-machine failure. A successful repair restarts the same
review loop through its injected seams, replaying pre-review rebase and the
declared gate before the reviewer is launched. Hook-specific behavior and the
two-attempt exhaustion path remain separate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Declared gate exit receives deterministic AutoRepair classification | `src/adapters/review/review-loop.ts:434`, `"task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop"` | PASS |
| Repair prompt preserves gate command, output, classification, and retry attempt | `src/adapters/review/review-loop.ts:454`, `test/task-1385-pre-review-gate.test.ts:464` | PASS |
| Successful repair replays setup and continues the review loop | `src/adapters/review/review-loop.ts:1304`, `"task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop"` | PASS |
| Retry exhaustion and hook handling remain bounded | `src/adapters/review/review-loop.ts:411`, `test/task-2340-hook-rebounce.test.ts` | PASS |
| Focused coverage uses no real process, agent, or Forgejo dependency | `test/task-2353-rebounce-reproduction.test.ts:16`, `npx tsx --test test/task-2353-rebounce-reproduction.test.ts test/task-1385-pre-review-gate.test.ts test/task-2340-hook-rebounce.test.ts` | PASS |

Next action: Run the mission-wide `all` verification gate and capture final success-criterion evidence.
