# CP-3: Incomplete-mission continuation relaunch

Added a dedicated continuation prompt for declared checkpoint gaps. It extracts the first missing checkpoint from validation diagnostics and instructs the resumed implementer to complete it, continue through the remaining checkpoints and gates, and not send a final response early. Missing declared checkpoints are treated as relaunchable before handoff.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Relaunch extracts the next missing declared checkpoint | `src/adapters/cli/commands/active.ts:324` | PASS |
| Continuation prompt names the checkpoint and prohibits early exit | `src/adapters/cli/commands/active.ts:330` | PASS |
| Missing declared checkpoint validation enters the targeted relaunch path | `src/adapters/cli/commands/active.ts:483` | PASS |
| Command syntax passes lint | `src/adapters/cli/commands/active.ts:1`, `npx eslint src/adapters/cli/commands/active.ts` | PASS |

Next action: Add hermetic unit coverage for declared checkpoint completeness and continuation prompt behavior, then run the mission verification gate.
