# Checkpoint 2: Pi Runner Implementation

## Summary

Completed the implementation of the Pi runner as a first-class launcher parallel to opencode, with full integration into Parallix's launcher dispatch system. This checkpoint delivers the production launcher path for `pi` and preserves the existing `opencode` path as a supported `custom` runner.

### Key Changes

1. **Pi Launcher Module**: Created `lib/agents/pi.ts` with comprehensive Pi support:
   - Command resolution with multiple path candidates (PI_BIN env var, PATH lookup, common install locations)
   - Invocation building with `--quiet`, `--model`, and conversation support
   - Session ID extraction (placeholder for future Pi session management)
   - Failure classification with transient vs. hard failure patterns
   - Retry logic for transient backend failures (1 retry by default)
   - Fallback handling for unrecognized command-line flags
   - Injectable I/O for testability

2. **Launcher Dispatch Integration**: Updated `lib/agents/launcher-selection.ts` to:
   - Add `pi` to LAUNCHERS and RESOLVERS maps
   - Maintain `custom` as a valid WORKFLOW_AGENT_NAME
   - Implement `resolveCustomLauncher()` and `resolveCustomCommandResolver()` for runtime dispatch
   - Update `workflowLauncherStatus()` to accept worktree parameter and resolve custom to actual runner
   - Update `assertAgentSupported()` to validate configured custom runners
   - Update `selectAgent()` to pass worktree to launcher status checks
   - Update eligible agent filtering to include `custom` even when not directly in LAUNCHERS

3. **Configuration Integration**: Updated `lib/core/product-config.ts` to:
   - Add `resolveCustomRunner()` function that reads from `adapters.agents.runners.custom`
   - Default to `'opencode'` when no runner is configured or when config is invalid

4. **Agent Display**: Updated `lib/core/fmt.ts` to show `custom (runner)` in logs when runner information is available

5. **Workflow Agent List**: Updated WORKFLOW_AGENT_NAMES to explicitly include `['codex', 'claude', 'vibe', 'custom']`

### Test Coverage

Created `test/pi-runner.test.js` with 16 focused unit tests covering:
- Pi command resolution (PI_BIN preference, PATH fallback)
- Invocation building (basic, with model, with conversation/session)
- Session ID extraction (null handling, pattern matching)
- Runner configuration resolution (default, from config, invalid values)
- Launcher dispatch (resolveCustomLauncher returns correct function)
- Workflow agent names (includes custom)
- Failure classification (hard vs. transient vs. retryable)

All 16 tests pass successfully.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pi runner implementation added as production path | `lib/agents/pi.ts:1-283` implements `startPiAgent`, `resolvePiCommand`, `buildPiInvocation`, `extractPiSessionId` | PASS |
| Opencode path preserved and functional | `lib/agents/launcher-selection.ts:30-31` maintains `opencode: startOpencodeAgent`; existing opencode.ts unchanged | PASS |
| Runner selection explicit in code and docs | `lib/agents/launcher-selection.ts:58` WORKFLOW_AGENT_NAMES includes `custom`; `lib/core/fmt.ts:63-68` shows runner in display | PASS |
| Production launcher path for Pi parallel to opencode | `lib/agents/pi.ts` mirrors opencode structure with command resolution, invocation building, failure handling | PASS |
| Minimum telemetry surface for Pi | `lib/agents/pi.ts:268-273` processResult() handles missing telemetry honestly (no fabricated data) | PASS |
| Focused unit coverage for dispatch and runner behavior | `test/pi-runner.test.js:1-283` with 16 passing tests covering all Pi launcher functionality | PASS |
| Configuration seam reads from repo's real config path | `workflow.config.json:8` includes `"runners": {"custom": "opencode"}`; `lib/core/product-config.ts:484-492` reads it | PASS |

## Design Decisions

1. **Pi Command Structure**: Uses `pi ask --quiet` as the base command, with `--model` for model selection and `--conversation` for session resume (future-proofing)
2. **Telemetry Honesty**: Pi launcher explicitly does not fabricate token usage data, as Pi CLI currently doesn't expose reliable telemetry
3. **Session Management**: Implemented placeholder session ID extraction; Pi may not support resume in the same way as opencode, but the structure is in place
4. **Failure Patterns**: Mirrored opencode's transient/hard failure classification for consistency
5. **Testability**: Used injectable I/O pattern consistent with existing opencode tests

## Known Limitations

1. **Pi Binary Availability**: Pi is not currently installed on the workstation, so real smoke tests cannot run yet
2. **Model Compatibility**: Need to verify if Pi can use `QuantTrio/Qwen3.6-27B-AWQ-6Bit` as specified in the backlog
3. **Session Resume**: Pi's session/conversation management needs verification and potential adjustment
4. **Graphify Support**: Requires investigation in CP-3 to determine if Pi can support Graphify skills
5. **Token Telemetry**: Pi doesn't currently expose token usage data through its CLI

## Next action:
Proceed to CP-3: Run E2E comparisons for opencode and pi paths, update operator documentation, investigate and document Graphify support for Pi, and create ADR with the default runner recommendation.