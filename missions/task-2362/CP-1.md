# CP-1: Launcher + Home Isolation + Approval Bypass

## Summary

Delivered `qwen.ts` launcher module and registered `qwen` in all selection surfaces.

### Files delivered
- `src/adapters/agents/qwen.ts` — launcher: `startQwenAgent`, `ensureQwenHome`, `buildQwenInvocation`, `resolveQwenCommand`, `extractQwenSessionId`, `isSpuriousQwenExit`
- `src/adapters/agents/launcher-selection.ts` — `qwen` added to `LAUNCHERS`, `RESOLVERS`, `HEALTH_PROBE_ARGS`, `WORKFLOW_AGENT_NAMES`, `RESUME_CAPABLE`, and `KNOWN_AGENT_NAMES` (via spread)
- `test/qwen-launcher.test.ts` — 18 hermetic tests

### thoughtsTokens justification (telemetry contract)

`telemetryToStatsFields` maps `inputTokens`/`outputTokens`/`cachedTokens`/`totalTokens`/`toolCalls` to existing stats columns. `thoughtsTokens` has no home in the current schema.

**Decision: Add `thoughts_tokens` as a new stats column in CP-2.** Thinking tokens are a distinct credit-consuming category on the Bailian Token Plan (separate deduction coefficient from output tokens). Silent drop or fold-into-output misleads the operator about credit consumption. The field is one line in `telemetryToStatsFields` and one column in `STATS_HEADERS`. Implementation deferred to CP-2 alongside `qwen-telemetry.ts` to keep CP-1 scoped to launcher mechanics.

### Resume decision

`qwen` added to `RESUME_CAPABLE`. Session ID extracted from disk artifacts (`<QWEN_HOME>/projects/<project-hash>/chats/<sessionId>.jsonl`) with invocation-window correlation guard (`MAX_SESSION_AGE_MINUTES = 120`). CLI supports `-r <session-id>` and `-c` (continue most recent). Session-not-found fallback implemented in `startQwenAgent` via `extractQwenSessionId` returning null, which the caller treats as a fresh session.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Qwen launcher module exists and exports startQwenAgent | `src/adapters/agents/qwen.ts` | PASS |
| ensureQwenHome creates .workflow/qwen-home and writes settings.json with approvalMode:yolo | `test/qwen-launcher.test.ts`, `"qwen approval bypass: settings.json has tools.approvalMode yolo after ensureQwenHome"` | PASS |
| Approval bypass prevents TASK-1398 failure mode (tool-call prompt not blocked) | `test/qwen-launcher.test.ts`, `"qwen approval bypass: tool-call prompt completes without approval block (red-to-green)"` | PASS |
| QWEN_HOME set to worktree-local .workflow/qwen-home | `test/qwen-launcher.test.ts`, `"buildQwenInvocation: QWEN_HOME set to worktree .workflow/qwen-home"` | PASS |
| HOME and PATH untouched in spawn env | `test/qwen-launcher.test.ts`, `"buildQwenInvocation: HOME and PATH untouched in env"` | PASS |
| Model flag only passed when operator-configured | `test/qwen-launcher.test.ts`, `"buildQwenInvocation: model only passed when configured"` | PASS |
| Resume flags: -r for session id, -c for continue | `test/qwen-launcher.test.ts`, `"buildQwenInvocation: resume with session id uses -r flag"`, `"buildQwenInvocation: resume without session id uses -c flag"` | PASS |
| isSpuriousQwenExit detects exit-1-with-tokens pattern | `test/qwen-launcher.test.ts`, `"isSpuriousQwenExit: returns true for exit 1 with non-zero telemetry"` | PASS |
| Session ID extraction from disk with invocation window | `test/qwen-launcher.test.ts`, `"extractQwenSessionId: extracts session id from chat file"`, `"extractQwenSessionId: respects invocation window"` | PASS |
| qwen registered in LAUNCHERS, RESOLVERS, HEALTH_PROBE_ARGS | `src/adapters/agents/launcher-selection.ts` | PASS |
| qwen in WORKFLOW_AGENT_NAMES | `src/adapters/agents/launcher-selection.ts` | PASS |
| qwen in RESUME_CAPABLE | `src/adapters/agents/launcher-selection.ts` | PASS |
| thoughtsTokens handling decision documented | CP-1.md (this file) — new column deferred to CP-2 | PASS |
| ESLint clean on changed files | `npx eslint src/adapters/agents/qwen.ts test/qwen-launcher.test.ts src/adapters/agents/launcher-selection.ts` | PASS |
| tsc --noEmit clean on changed files | `npx tsc --noEmit` (no qwen/launcher-selection errors) | PASS |

Next action: CP-2 — deliver qwen-telemetry.ts with JSONL parsing, honest-zeros path, fixture-backed tests, and agent-limit.ts qwen PATTERN_SETS with quota-vs-rate-limit distinction.
