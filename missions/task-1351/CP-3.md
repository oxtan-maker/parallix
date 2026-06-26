# CP-3: Mission Complete

## Summary

Fixed the opencode launcher model handling by moving the provider prefix from hardcoded code into the config file. The `vllm` provider is now part of the model name in `workflow.config.json` rather than being prepended by a translation function.

## Changes Made

### 1. `lib/agents/opencode.js`
- Removed `translateOpencodeModel` function (was incorrectly hardcoding `vllm/` prefix)
- Reverted `buildOpencodeInvocation` to pass model directly to `-m` flag
- Removed `translateOpencodeModel` from module exports

### 2. `workflow.config.json`
- Updated model name from `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` to `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`
- The full provider/model identifier is now in config, making it deployment-configurable

### 3. `test/opencode.test.js`
- Reverted model assertion: `vllm/qwen3-coder` → `qwen3-coder`
- Removed all `translateOpencodeModel` test cases

### 4. `test/agents.test.js`
- Reverted model assertion: `vllm/qwen3.5:9b` → `qwen3.5:9b`

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `buildOpencodeInvocation` passes model directly to `-m` | `lib/agents/opencode.js:138` | PASS |
| No hardcoded vllm prefix translation | `translateOpencodeModel` removed | PASS |
| Provider is in config, not code | `workflow.config.json:8` — `"vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"` | PASS |
| Tests reverted to original expectations | `test/opencode.test.js`, `test/agents.test.js` | PASS |

## Next action
Mission complete. All checkpoints done. All gates pass. Ready for handoff to review.
