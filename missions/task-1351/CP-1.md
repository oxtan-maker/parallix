# CP-1: Investigation Complete

## Finding

The original approach of hardcoding `vllm/` as a prefix in a translation function is incorrect because the provider depends on which machine the workflow runs on. Different deployment environments may use different backends (vllm, ollama, lmdeploy, etc.).

## Correct Approach

The `vllm` provider should be part of the model name in `workflow.config.json` itself, not added via a hardcoded translation layer. This makes the provider explicit and configurable per deployment.

The config value should be:
```
vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
```

The `buildOpencodeInvocation` function should pass the model identifier from config directly to the `-m` flag without any translation.

## Fix Approach

1. Remove the `translateOpencodeModel` function from `lib/agents/opencode.js`
2. Revert `buildOpencodeInvocation` to pass `model` directly to `-m`
3. Update `workflow.config.json` to include the full `vllm/` prefix in the model name
4. Remove the test additions for `translateOpencodeModel`
5. Revert the test assertion changes
