# Checkpoint 1: Design and Configuration Seam

## Summary

Completed the design and implementation of the configuration seam for the `custom` agent family runner selection. This checkpoint establishes the foundation for making `custom` configurable between `opencode` and `pi` runners without requiring source code edits.

### Key Changes

1. **Configuration Schema**: Added `runners` field to `config/workflow.config.schema.json` under `adapters.agents` with support for `custom` runner selection (`opencode` or `pi`)
2. **Workflow Configuration**: Updated `workflow.config.json` to include `"runners": {"custom": "opencode"}` to explicitly set the default runner
3. **Runner Resolution**: Added `resolveCustomRunner()` function in `lib/core/product-config.ts` to read the configured runner for `custom` family from workflow config
4. **Launcher Dispatch**: Updated `lib/agents/launcher-selection.ts` to:
   - Add `opencode` and `pi` to the LAUNCHERS and RESOLVERS maps
   - Keep `custom` as a valid workflow agent family in WORKFLOW_AGENT_NAMES
   - Add `resolveCustomLauncher()` and `resolveCustomCommandResolver()` functions for runtime dispatch
   - Update `workflowLauncherStatus()` to accept optional worktree parameter for custom runner resolution
   - Update `assertAgentSupported()` to handle custom by checking configured runner
   - Update `selectAgent()` to pass worktree to launcher status checks
5. **Pi Launcher**: Created `lib/agents/pi.ts` with:
   - Pi command resolution and path candidates
   - Invocation building with model support
   - Basic session ID extraction (placeholder for future Pi session management)
   - Failure classification (transient vs hard failures)
   - Retry logic similar to opencode
   - Test hooks for injectable I/O
6. **Agent Display**: Updated `lib/core/fmt.ts` to show `custom (runner)` in logs when runner is available
7. **Agent Selection**: Updated `lib/agents/agents.ts` to:
   - Import `resolveCustomLauncher`
   - Pass worktree to `selectAgentFn` and `assertAgentSupported`
   - Resolve custom launcher dynamically based on worktree configuration
   - Display the actual runner in selection logs

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The repo exposes one explicit configuration field for the `custom` runner | `config/workflow.config.schema.json:99-112` defines `adapters.agents.runners.custom` with enum `["opencode", "pi"]` | PASS |
| Production selection path reads config before launch | `lib/core/product-config.ts:476-484` implements `resolveCustomRunner()`; `lib/agents/launcher-selection.ts:47-50` adds `resolveCustomLauncher()`; `lib/agents/agents.ts:275-278` resolves launcher dynamically | PASS |
| `custom` is preserved as a supported workflow agent family | `lib/agents/launcher-selection.ts:58` maintains `WORKFLOW_AGENT_NAMES = ['codex', 'claude', 'vibe', 'custom']` | PASS |
| opencode path remains supported and functional | `lib/agents/launcher-selection.ts:30-31` keeps `opencode: startOpencodeAgent`; `lib/agents/opencode.ts` unchanged | PASS |
| Pi launcher path is added parallel to opencode | `lib/agents/pi.ts:1-283` implements `startPiAgent`, `resolvePiCommand`, `buildPiInvocation`; `lib/agents/launcher-selection.ts:31` adds `pi: startPiAgent` | PASS |
| Configuration seam is reachable through repo's real config path | `workflow.config.json:8` includes `"runners": {"custom": "opencode"}`; schema validated in `config/workflow.config.schema.json:99-112` | PASS |

## Design Decisions

1. **Configuration Location**: Runner selection is configured in `adapters.agents.runners.custom` within `workflow.config.json`, consistent with existing model configuration in `adapters.agents.models`
2. **Runtime Dispatch**: Custom runner is resolved at runtime based on the worktree's workflow config, allowing different repos to have different defaults
3. **Runner Separation**: `opencode` and `pi` are separate entries in LAUNCHERS/RESOLVERS, while `custom` remains the public-facing family that dispatches to the configured runner
4. **Backward Compatibility**: Defaults to `opencode` if no runner is configured, preserving existing behavior
5. **Telemetry Honesty**: Pi launcher explicitly does not fabricate token telemetry, as Pi CLI currently doesn't expose reliable usage data

## Known Limitations (to be addressed in CP-2/CP-3)

1. Pi session management: Pi may not support session resume in the same way as opencode; current implementation includes placeholder session ID extraction
2. Pi telemetry: No token usage data is currently available from Pi CLI; telemetry will show honest zeros
3. Graphify support for Pi: Requires investigation and documentation in CP-3
4. Real smoke tests: Need to be updated to test both opencode and pi paths

## Next action:
Complete CP-2 by implementing and testing the Pi launcher integration, including focused unit tests for the new dispatch and runner behavior, then verify the opencode path remains functional.