Checkpoint 1 extracted the config/blocklist helpers into `lib/agents/agent-config.ts` and the git worktree discovery helpers into `lib/agents/worktree.ts`, while keeping `lib/agents/agents.ts` as the stable export surface. The focused regression suite confirmed invalid-config handling, local blocklist migration/merge, timestamp parsing, and blocklist writes still behave the same after the move.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Config and blocklist helpers moved out of `agents.ts` | `lib/agents/agent-config.ts:36`, `lib/agents/agent-config.ts:48`, `lib/agents/agent-config.ts:56`, `lib/agents/agent-config.ts:101`, `lib/agents/agent-config.ts:130`, `lib/agents/agent-config.ts:150`, `lib/agents/agent-config.ts:155` | PASS |
| Worktree discovery helpers moved out of `agents.ts` | `lib/agents/worktree.ts:11`, `lib/agents/worktree.ts:23`, `lib/agents/worktree.ts:30`, `lib/agents/worktree.ts:57` | PASS |
| Invalid-config, migration, merge-local, timestamp, and blocklist-write paths still hold | `test/agents.test.js`, "readAgentConfig reports and skips malformed workflow/config/agents.local.json during migration", "readAgentConfig can merge local blocklists when caller passes the default path explicitly", "readAgentConfig migrates blocklist from main worktree path", "isAgentBlocked ignores invalid date-plus-hour timestamps", `test/agents-limit-hit.test.js`, "updateAgentBlock writes { until, reason } to agents.local.json", "updateAgentBlock fails loudly on malformed agents.local.json instead of overwriting it" | PASS |

Next action: extract launcher registry, probing, selection, and watchdog resolution into a dedicated `lib/agents/launcher-selection.ts` module while preserving the existing exports from `lib/agents/agents.ts`.
