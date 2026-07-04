# CP 4: Regression coverage for the unchanged real-failure path

## Summary

Added two additional tests to `test/task-1416-repro.test.js` proving genuine Codex/Mistral failures are unaffected by the new success-classification logic (SC 4):

- `codex exit 1 with no telemetry still reroutes and blocklists (real-failure path unchanged)` (`test/task-1416-repro.test.js:182-213`): a codex binary that exits 1 without writing any rollout produces no `result.telemetry`, so `isSpuriousCodexExit` returns `false`, `startAgent()` reroutes to the next eligible agent (mistral), and a blocklist entry is still written for codex.
- `mistral exit 1 with only stale telemetry still reroutes and blocklists (real-failure path unchanged)` (`test/task-1416-repro.test.js:220-262`): a session `meta.json` with real non-zero stats exists on disk but its mtime is deliberately back-dated 10 minutes before the invocation (`fs.utimesSync`), simulating leftover telemetry from an earlier, unrelated run sharing the same log directory. `telemetryFresh` correctly evaluates `false`, so `isSpuriousMistralExit` returns `false` and the run still reroutes/blocks — directly exercising the freshness guard added in CP 3, not just the presence of telemetry.

Existing suite tests already covered adjacent real-failure scenarios and continue to pass unchanged, confirming no double coverage gap:
- `test/agents.test.js:1843` `invalid-model launch failure retries without persisting a blocklist entry` (codex genuine failure, no telemetry, worktree-isolated).
- `test/agents.test.js:1815` `non-limit launch failure with transient error retries and persists a block for non-custom agents` (mistral genuine failure; this test's mistral case is exactly what surfaced the stale-telemetry contamination risk during development — see CP 2 — and now passes because of the `telemetryFresh` guard).
- `test/agents.test.js:1902` `hard launch failure (model not found) does not blocklist agent family` (mistral + custom genuine failures).

## Full suite run

```
$ npm test
ℹ tests 2016
ℹ pass 1994
ℹ fail 0
ℹ skipped 22
```

No new skips or failures introduced; skip count matches the pre-existing baseline.

## Goal Check

| Item | Evidence |
|---|---|
| SC 4 (codex genuine failure still reroutes/blocks) | `test/task-1416-repro.test.js:182-213` |
| SC 4 (mistral genuine failure still reroutes/blocks, freshness guard exercised) | `test/task-1416-repro.test.js:220-262` |
| No regression in existing suite | `npm test` → 1994 pass / 0 fail / 22 skipped (unchanged baseline) |
| SC 5 (opencode/custom untouched) | `test/agents.test.js` opencode/custom launch-failure tests (e.g. `hard launch failure (model not found) does not blocklist agent family`, `custom is excluded from non-limit block logic`) pass unchanged |

Next action: CP 5 — run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, capture proof, and finalize the mission handoff.
