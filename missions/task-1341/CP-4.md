# CP-4

Downstream command paths now degrade cleanly when a mission has synthetic or missing task metadata. Mission-start can continue with `unknown`, gatekeeper treats mission artifacts as sufficient, integrate no longer fails on task absence, and mission-artifact detection follows the configured task adapter.

## Goal Check
| Check | Evidence |
| --- | --- |
| Mission-start only fails ambiguous task resolution and tolerates missing tasks with `unknown`. | `lib/commands/mission-start.js:127`, `lib/commands/mission-start.js:153` |
| Gatekeeper no longer blocks review solely because the task file is absent when `MISSION.md` and checkpoints exist. | `lib/tools/gatekeeper.js:17`, `lib/tools/gatekeeper.js:44` |
| Integrate preflight warns and proceeds with synthetic/unknown task metadata. | `lib/commands/integrate.js:986`, `lib/commands/integrate.js:1012` |
| Mission artifact detection now uses adapter-configured task storage paths. | `lib/core/mission-utils.js:949`, `lib/core/mission-utils.js:957` |
| Unit coverage verifies the gatekeeper and integrate missing-task paths. | `test/gatekeeper.test.js:73`, `test/integrate.test.js:692` |

Next action: finish the adapter cleanup pass by removing the remaining hardcoded Backlog.md/task-path language and switching the README to the new no-task quick start.
