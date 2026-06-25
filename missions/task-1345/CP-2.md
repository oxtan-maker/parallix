# CP-2: Reproduce Truncation with Controlled Test

## Work Done

Confirmed deterministic truncation of `captureOpencodeExport` for session `ses_1053117b7ffeDySSqY21XiQO8z`:

| Config | stdio | Bytes | Parse OK? |
|--------|-------|-------|-----------|
| Broken (current) | `[ignore,pipe,ignore]` | 145,753 | No |
| Stderr piped | `[ignore,pipe,pipe]` | 146,176 | No |
| **Stdin inherited** | **`[inherit,pipe,pipe]`** | **153,453** | **Yes** |
| Shell redirect | `sh -c` (inherited) | 146,176* | No* |

*Shell redirect test captured stderr mixed into stdout buffer. Clean separation confirmed via Test 3.

## Evidence

- `lib/agents/opencode-export.js:66`: `stdio: ['ignore', 'pipe', 'ignore']` — closes stdin
- `lib/agents/opencode.js:262`: `_captureExport(result.sessionId, { worktree, env })` — worktree IS passed (contradicts mission doc claim)
- Session: `ses_1053117b7ffeDySSqY21XiQO8z` at `/home/magnus/code/parallix-task-1344/.workflow/sessions/`
- Full export: 153,453 bytes (parses, yields 522K input / 6.9K output / 26 tool calls)
- Captured export: 145,753 bytes (truncated mid-JSON at pos 145753)

## Next action: Change stdio from ['ignore','pipe','ignore'] to ['inherit','pipe','pipe'] in opencode-export.js:66 and run full test suite
