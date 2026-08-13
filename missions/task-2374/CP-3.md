# CP-3: Shared agent-launch integration

## Summary

Connected the sandbox profile to `startAgent`, the shared workflow-agent launch
boundary, and applied the wrapper inside `spawnAndTee`. This covers every
existing agent family through its common process seam. Missing Bubblewrap and
`PARALLIX_NO_BUBBLEWRAP` preserve the original invocation; a malformed guard
throws before any unsandboxed child can be created.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All workflow families use one shared sandbox decision point | `src/adapters/agents/agents.ts`; `src/adapters/process/spawn-tee.ts` | PASS |
| Review resolves its configured artifact directory before launch | `src/adapters/agents/agents.ts`; `src/adapters/review/review-adapter.ts` | PASS |
| The opt-out configuration remains available | `src/adapters/process/bubblewrap.ts`; `PARALLIX_NO_BUBBLEWRAP` | PASS |
| Production TypeScript checks successfully | `npx tsc --noEmit` | PASS |

Next action: add hermetic spawn-seam coverage for wrapper argv and broken-guard failure behavior, then run the mission gate.
