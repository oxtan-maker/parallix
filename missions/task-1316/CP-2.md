# CP-2: Launcher Integration

## Work Done

Wired `extractOpencodeTelemetryFromExport` into `startOpencodeAgent` in `lib/agents/opencode.js`.

### Key changes:
- Added import: `const { extractOpencodeTelemetryFromExport } = require('./opencode-telemetry');`
- Updated module comments to reflect real telemetry parsing (lines 4-8).
- In `startOpencodeAgent`, after the session completes and `sessionId` is extracted:
  1. Spawns `opencode export <sessionId>` as a child process (std pipe, worktree cwd)
  2. Parses the JSON stdout with `extractOpencodeTelemetryFromExport`
  3. Attaches telemetry to `result.telemetry`, `result.model`, `result.provider`
  4. Wrapped in try/catch with `.catch()` returning the original result — telemetry failure never breaks the launch

### Pattern compliance:
- Follows the exact same try/catch/best-effort pattern as `codex.js:84-96` and `claude.js:82-91`
- Does not modify function signatures (`buildOpencodeInvocation`, `startOpencodeAgent`, `resolveOpencodeCommand`)
- Preserves `run --pure --dangerously-skip-permissions` invocation flags
- Does not modify `lib/commands/stats.js:telemetryToStatsFields`
- Does not modify `lib/agents/stage-telemetry.js`

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `startOpencodeAgent` attaches non-null `result.telemetry` when export succeeds | `lib/agents/opencode.js:60-64` — calls parser, sets `result.telemetry` when non-null |
| 2 | Uses same try/catch pattern as codex.js and claude.js | `lib/agents/opencode.js:52-74` — try/catch wrapper + `.catch()` returning original result |
| 3 | No function signature changes | `lib/agents/opencode.js:43` — `startOpencodeAgent` params unchanged; `buildOpencodeInvocation` params unchanged |
| 4 | Telemetry is best-effort, never hangs or crashes launcher | `lib/agents/opencode.js:68-71` — `.catch()` returns `result` on any error |
| 5 | Attaches model/provider to result when telemetry available | `lib/agents/opencode.js:63-64` — mirrors codex.js:91-92 and claude.js:86-87 |

## Next action
Write tests: new `test/opencode-telemetry.test.js` with offline unit tests, and update `test/telemetry-stubs.test.js` assertions.
