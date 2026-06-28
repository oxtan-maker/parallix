# CP-2: Fix px.js shellInit() to silently skip missing directory

## Summary

Modified `px.js` `shellInit()` function to remove the error-emitting `else` branch. When the extracted target directory does not exist, the shell function now silently skips the `cd` and falls through to `return $_px_exit`, preserving the runner's original exit code. This applies identically to both bash and zsh variants since they share the same template.

Changed `px.js:64-66` — removed the three-line `else` block that emitted `[px] ERROR: target directory '$_px_target' not found.` to stderr.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | No error for missing directory | `px.js:64` — `else` branch removed; shell function falls through to `return $_px_exit` when `[ -d "$_px_target" ]` is false |
| 2 | Happy path unchanged (directory exists) | `px.js:59-63` — `if [ -d "$_px_target" ]` block still performs `cd` and prints success message |
| 3 | Both bash and zsh share the same template | `px.js:30-71` — single template string, no shell-specific branches in the directory-check logic |
| 4 | Reproduction test passes after fix | `test/px-shell-init.test.js:132` — test `px function silently skips cd when target directory is missing (task-1381)` expects no stderr error |

## Next action: Add guards in lib/commands/integrate.js so `nextActionMessage` is only set when `fs.existsSync(baseWorktree)` returns true (three emission points).
