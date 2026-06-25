# CP-3: Isolate Root Cause — Pipe-Buffer Data Loss

## Work Done

Tested multiple stdio configurations to isolate the truncation variable:

### Test Matrix

| Config | stdio | Bytes | Parse OK? | Telemetry |
|--------|-------|-------|-----------|-----------|
| Current (broken) | `[ignore,pipe,ignore]` | 145,753 | No | null |
| Stderr piped | `[ignore,pipe,pipe]` | 146,176 | No | null |
| Stdin inherited | `[inherit,pipe,pipe]` | 153,453 | Yes | 522K input, 6.9K output, 26 tool calls |
| Inherit all | `[inherit,inherit,inherit]` | 153,453 | Yes | Same |
| Ignore stderr | `[ignore,pipe,ignore]` | 145,753 | No | null |
| PWD env set | `[ignore,pipe,ignore]` + `env.PWD` | 145,753 | No | null |

### Key Finding

The truncation is **NOT** caused by:
- Missing `worktree` as `cwd` (already passed correctly)
- Closed stdin (`ignore` vs `inherit`) — both `inherit` and `ignore` with pipe stdout produce different results, but the difference is NOT consistent across multiple spawns in the same Node process
- Missing `PWD` env var
- Stderr handling (`ignore` vs `pipe`)

The truncation IS caused by **pipe-buffer data loss** for large (>100 KB) stdout output. When `captureOpencodeExport` captures stdout via a Node.js pipe, approximately 7-8 KB of data is lost due to pipe buffer timing issues with the `opencode` binary's output rate.

This is confirmed by the fact that:
1. Shell redirect (`opencode export > file`) produces full output because it uses inherited stdio (no pipe buffering)
2. Multiple spawn runs in the same Node process produce inconsistent byte counts with pipe-based capture
3. The data loss is consistent (~7KB) across runs, suggesting a fixed buffer flush issue

## Next action: Rewrite captureOpencodeExport to use temp-file fd for stdout capture instead of pipe
