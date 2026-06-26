# CP-2: Fix Implemented

## Changes Made

### 1. `lib/agents/opencode.js` — Removed `translateOpencodeModel` function

Removed the `translateOpencodeModel` function entirely (previously at lines 102-123). The function incorrectly hardcoded `vllm/` as a provider prefix, which is deployment-specific and should not be assumed.

Reverted `buildOpencodeInvocation` at line 138 to pass the model directly:
```javascript
if (model) args.push('-m', model);
```

Removed `translateOpencodeModel` from module exports.

### 2. `workflow.config.json` — Updated model name with provider prefix

Changed line 8 to include the full model identifier with provider:
```json
"agents": { "models": { "codex": "gpt-5.3", "custom": "vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit" } },
```

### 3. `test/opencode.test.js` — Reverted test changes

- Reverted line 114: `vllm/qwen3-coder` → `qwen3-coder`
- Removed the four `translateOpencodeModel` tests added in the original fix (lines 130-162)

### 4. `test/agents.test.js` — Reverted test assertion

Reverted line 1802: `vllm/qwen3.5:9b` → `qwen3.5:9b`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `buildOpencodeInvocation({ model: 'vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit' })` passes model directly to `-m` | `lib/agents/opencode.js:138` — `if (model) args.push('-m', model);` |
| Full model name with provider prefix in `workflow.config.json` | `workflow.config.json:8` — `"custom": "vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"` |
| No hardcoded vllm prefix translation | `translateOpencodeModel` removed from `lib/agents/opencode.js` |
| Provider is configurable in config, not code | `workflow.config.json` contains the full `vllm/...` identifier |

## Next action
Update CP-3 with test verification results.
