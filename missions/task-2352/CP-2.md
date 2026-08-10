# CP-2: Declared checkpoint completeness validation

Implemented mission-driven checkpoint validation before handoff. The validator reads `MISSION.md`, accepts the declared `CP N` and `CP-N` forms, rejects malformed or empty declarations, and reports every missing checkpoint document before any handoff can begin.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Declared checkpoint names are parsed from the mission document | `src/adapters/cli/commands/active.ts:337` | PASS |
| Missing declared checkpoint documents fail validation with their names | `src/adapters/cli/commands/active.ts:401` | PASS |
| Validation remains before handoff execution | `src/adapters/cli/commands/active.ts:467` | PASS |
| Command syntax passes lint | `src/adapters/cli/commands/active.ts:1`, `npx eslint src/adapters/cli/commands/active.ts` | PASS |

Next action: Give incomplete-mission relaunches a dedicated continuation prompt naming the next missing checkpoint.
