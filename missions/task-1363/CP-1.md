# CP-1: Schema and Config Parsing

## Work Done

Extended `workflow.config.schema.json` to add `adapters.agents.subagents` object with an integer `maxParallel` property (nullable, minimum 0). The existing `product-config.js` validation already accepts arbitrary nested properties under adapter sections (it only verifies that each adapter key is an object), so no changes were needed to `validateWorkflowConfig()` or `deepMerge()` — the subagents field merges cleanly over the built-in defaults.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Schema includes `adapters.agents.subagents` with integer `maxParallel` (nullable) | `config/workflow.config.schema.json:83-104` — `subagents` object with `maxParallel` of type `["integer", "null"]`, minimum 0 |
| Schema validates correctly | `node -e "require('./config/workflow.config.schema.json')"` — parses without error |
| `validateWorkflowConfig()` accepts config with subagents | Test inline: `validateWorkflowConfig({ adapters: { agents: { subagents: { maxParallel: 2 } } } })` returns `[]` (0 issues) |
| `loadEffectiveConfig()` merges subagents over defaults | Inline test: `loadEffectiveConfig()` on temp dir with `subagents.maxParallel: 2` returns `effective.adapters.agents.subagents.maxParallel === 2` |
| `px config` prints the field | `node lib/commands/config.js` output includes `agents` section; adding subagents to config file merges correctly |
| Existing tests pass without modification | `test/product-config.test.js`: 32 tests, 0 failures |

## Next action

CP-2: Implement `lib/core/subagent-limit.js` prompt injection module and wire it into `lib/agents/opencode.js:startOpencodeAgent`.
