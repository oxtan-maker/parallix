# CP-1: Claude command-label mapping

Mapped the Claude stream path from `stream-json` tool-use records through `ClaudeStreamNormalizer` to `ClaudeStreamView`. The structured tool `name` (`Bash`) is rendered beside both command starts and completion entries; the shell command is independently held in `event.input`, and completion content in `event.summary`. The focused renderer fixture is `test/task-2461-claude-stream-render.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claude command event has no prefixed tool label while retaining command text | `src/adapters/agents/claude-stream-view.ts`; `test/task-2461-claude-stream-render.test.ts`, `"rendered fixture shows every required surface and no raw JSON envelope"` | MAPPED |
| Command output and completion/status remain rendered | `src/adapters/agents/claude-stream-view.ts`; `test/task-2461-claude-stream-render.test.ts`, `"rendered fixture shows every required surface and no raw JSON envelope"` | MAPPED |
| Focused Claude coverage and non-Claude behavior remain covered | `test/task-2461-claude-stream-render.test.ts`, `"rendered fixture shows every required surface and no raw JSON envelope"` | READY |
| Required mission verification passes | `./scripts/verify-local.sh all` | PENDING |

Next action: remove the structured `Bash` label only for Claude command start and completion rendering, then extend the focused fixture assertion.
