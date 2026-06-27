# CP-2: Prompt Injection Module and Wiring

## Work Done

Created `lib/core/subagent-limit.js` — a pure module exporting `buildSubagentLimitPrefix(maxParallel)` that:
- Returns a non-empty advisory string containing the integer when `maxParallel >= 1` (prefix length ~75 chars, well under 200-char target)
- Returns an empty string when `maxParallel` is `null`, `undefined`, `0`, or negative (backward-compatible default)
- Reads from the effective workflow config when no explicit value is passed

Integrated the prefix into `lib/agents/opencode.js:startOpencodeAgent` by prepending the returned prefix to the prompt before it reaches `buildOpencodeInvocation`, covering all code paths (main invocation, stale-session fresh invocation, and JSON-fallback legacy invocation).

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `buildSubagentLimitPrefix(maxParallel)` returns non-empty string when maxParallel >= 1 | `lib/core/subagent-limit.js:22-24`: `buildSubagentLimitPrefix(2)` returns `"Do not spawn more than 2 parallel subagents. If you need more, pause and wait.\n"` |
| Returns empty string for null/undefined/0/negative | `lib/core/subagent-limit.js:25-27`: `buildSubagentLimitPrefix(0)`, `buildSubagentLimitPrefix(null)`, `buildSubagentLimitPrefix(undefined)`, `buildSubagentLimitPrefix(-1)` all return `""` |
| `startOpencodeAgent` calls subagent-limit and prepends prefix | `lib/agents/opencode.js:269-270`: `const subagentPrefix = buildSubagentLimitPrefix(); const injectedPrompt = subagentPrefix + prompt;` |
| All paths use injected prompt | `lib/agents/opencode.js:350` (legacy fallback), `lib/agents/opencode.js:369` (fresh session), `lib/agents/opencode.js:375` (main invocation) all use `injectedPrompt` |
| Existing opencode tests pass | `test/opencode.test.js`: 18 tests, 0 failures |
| Existing product-config tests pass | `test/product-config.test.js`: 32 tests, 0 failures |

## Next action

CP-3: Set `maxParallel: 2` in `workflow.config.json`, run `npm test` gate, confirm all tests pass.
