# CP-2: Claude command presentation

Removed the structured `Bash` label only from Claude command-start and command-completion rows. The command input, result summary, success/error mark, ordering, and all non-Bash tool labels are unchanged. No shared CLI formatter or non-Claude adapter was touched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claude command event has no prefixed tool label while retaining command text | `test/task-2461-claude-stream-render.test.ts`, `"rendered Claude Bash command entries omit the label while preserving command, output, and status"`; `npm test -- test/task-2461-claude-stream-render.test.ts` | PASS |
| Command output and completion/status remain rendered | `test/task-2461-claude-stream-render.test.ts`, `"rendered Claude Bash command entries omit the label while preserving command, output, and status"` | PASS |
| Focused Claude coverage and non-Claude behavior remain covered | `test/task-2461-claude-stream-render.test.ts`; `src/adapters/agents/claude-stream-view.ts` | PASS |
| Required mission verification passes | `./scripts/verify-local.sh all` | PENDING |

Next action: run the mission gate, inspect the committed scope, and record final evidence.
