# CP-2: Runtime Family Renamed qwen → custom

## Summary
Renamed the `qwen` agent-family label to `custom` across all runtime configuration, launcher maps, telemetry fallbacks, rate-limit patterns, and UI color maps. This ensures `qwen` no longer appears as a product-facing or runtime agent-family identifier.

Changes made:
- `config/agents.json`: Step eligibility policy updated from `qwen` to `custom`
- `config/workflow.config.schema.json`: Schema updated
- `lib/agents/agents.js`: LAUNCHERS/RESOLVERS maps, `resolveAgentModel()` updated
- `lib/agents/opencode-telemetry.js`: `MODEL` constant replaced with dynamic `setOpencodeDefaultModel()`
- `lib/agents/limit-hit.js`: Rate-limit patterns updated
- `lib/agents/opencode.js`: Launcher invocation updated
- `lib/core/fmt.js`: Color map `qwen` → `custom`
- `lib/review/review-prompts.js`: Prompt templates updated
- `test/*.test.js`: Bulk replaced all `'qwen'`/`"qwen"` literals (77+ replacements across 15+ files)

## Goal Check

| Goal | Status |
|------|--------|
| `config/agents.json` step eligibility updated | DONE |
| `lib/agents/agents.js` LAUNCHERS/RESOLVERS updated | DONE |
| `lib/agents/opencode.js` launcher updated | DONE |
| `lib/agents/limit-hit.js` rate-limit patterns updated | DONE |
| `lib/core/fmt.js` color map updated | DONE |
| `lib/review/review-prompts.js` prompts updated | DONE |
| All test files updated (0 remaining `qwen` agent literals) | DONE |

## Non-Generic Next Action
Proceed to CP-3: Thread model ID/provenance into stats/telemetry at stage boundaries.
