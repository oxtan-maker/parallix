# CP-1: qwen → Custom naming migration map

## Scope

Every use of the literal `qwen` as an agent-family label in runtime code, config, and docs.
Tests retain `qwen` only where they validate review-loop behavior, stats rollups, or legacy fixtures.

## Migration decisions

| File | Line(s) | Current value | Action | Notes |
|------|---------|---------------|--------|-------|
| `config/agents.json` | 6, 10, 18 | `"qwen"` in eligible arrays | Migrate → `"custom"` | Step eligibility for draft/active/review |
| `config/workflow.config.schema.json` | 90 | `qwen` in description | Migrate → `custom` | Schema docstring only |
| `lib/agents/agents.js` | 22 | `RESUME_CAPABLE` set | Migrate → `custom` | Set membership |
| `lib/agents/agents.js` | 33 | `qwen: startOpencodeAgent` | Migrate → `custom` | Launcher map key |
| `lib/agents/agents.js` | 40 | `qwen: resolveOpencodeCommand` | Migrate → `custom` | Resolver map key |
| `lib/agents/agents.js` | 47 | `qwen: ['--help']` | Migrate → `custom` | Health-check map key |
| `lib/agents/agents.js` | 826 | `chosen !== 'qwen'` | Migrate → `custom` | Non-limit block exclusion |
| `lib/agents/agents.js` | 20, 135 | Comments mentioning qwen | Migrate → custom | Comments only |
| `lib/agents/opencode.js` | 42 | Comment mentioning qwen | Migrate → custom | Comment only |
| `lib/agents/opencode.js` | 135 | Comment mentioning qwen/vLLM | Migrate → custom | Comment only |
| `lib/agents/opencode.js` | 200 | `agent: 'qwen'` | Migrate → `agent: 'custom'` | Launcher result |
| `lib/agents/opencode-telemetry.js` | 13 | Comment mentioning qwen | Migrate → custom | Comment only |
| `lib/agents/opencode-telemetry.js` | 20 | `MODEL = 'qwen'` | Migrate → `MODEL = 'custom'` | Fallback model name |
| `lib/agents/limit-hit.js` | 23 | `PATTERN_SETS['qwen']` | Migrate → `custom` | Rate-limit patterns |
| `lib/core/fmt.js` | 34 | `qwen: 'yellow'` in agentMap | Migrate → `custom` | Color palette |
| `lib/core/fmt.js` | 69-70 | `family === 'qwen'` guard | Migrate → `custom` | Display label logic |
| `lib/commands/stats.js` | 1355-1356 | Falls back to `agentFamily` | No code change needed | Will naturally show `custom` after rename |
| `docs/agents.md` | Various | `qwen` references | Migrate → `custom` | User-facing docs |
| `docs/operator-setup.md` | Various | `qwen` references | Migrate → `custom` | Setup docs |
| `README.md` | Various | `qwen` references | Migrate → `custom` | Top-level docs |
| `test/fmt.test.js` | Assertions on qwen | `qwen` labels/colors | Migrate → `custom` | Align tests with new name |
| `test/stats.test.js` | Many fixture rows | `qwen` implementer | Migrate → `custom` | Test fixtures |
| `test/review.test.js` | Eligible agent arrays | `qwen` in arrays | Migrate → `custom` | Test fixtures |
| `test/agents.test.js` | Tests referencing qwen | `qwen` agent | Migrate → `custom` | Test fixtures |
| `test/setup-review.test.js` | Agent passwords/fixtures | `qwen` user | Migrate → `custom` | Test fixtures |
| `test/task-*.test.js` | Various | `qwen` assignee/implementer | Migrate → `custom` | Test fixtures |

## Preserved (tests only)

- `missions/*/review-state.json` — factual runtime state from prior runs, not edited
- `missions/*/review-events/*.md` — factual review artifacts from prior runs, not edited
- `missions/task-1290/MISSION.md` — describes the migration itself, references to `qwen` are intentional
- `backlog/tasks/task-1290 - Replace-qwen-naming.md` — task file itself (per mission constraint)

## Next action: Apply CP-2 — rename runtime family from `qwen` to `custom` in config/agents.json, lib/agents/agents.js, lib/agents/opencode.js, lib/agents/opencode-telemetry.js, lib/agents/limit-hit.js, and lib/core/fmt.js
