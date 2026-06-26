# CP-1: Update px --help to match current command surface

## Summary

`px --help` resolves to `printUsage()` in `index.js` (px.js → `workflow.main(['--help'])`
→ `printUsageFn()`). Audited the actual dispatchable command surface against the
help text and found five undocumented but invokable commands:

- `config` and `aliases` — listed in `KNOWN_COMMANDS` (`index.js:21-40`) and
  dispatched by `main()` (`config` via the lib module at `index.js:109-137`,
  `aliases` directly at `index.js:104-107`), but absent from `printUsage`.
- `version` / `--version` / `-v`, `shell-init`, and `review-event` — handled in
  the `px.js` entrypoint (`px.js:13-14`, `153-161`, `168-198`) but never shown in help.

Changes:
- Added `config` and `aliases` to the Core Commands block and a new Utility
  Commands block (`version`, `shell-init`, `review-event`) in `printUsage`.
- Extended the existing `printUsage` test and added a new test asserting every
  `KNOWN_COMMANDS` entry is documented, locking the help against future drift.

Verified: `node index.js --help` shows all commands; gate passes; full suite green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `config` documented in help | `index.js:226` (`config  Print the effective configuration ...`) | PASS |
| `aliases` documented in help | `index.js:227` (`aliases  Print the derived command-alias table ...`) | PASS |
| `version`/`--version`/`-v` documented | `index.js:230` (Utility Commands block) | PASS |
| `shell-init` documented | `index.js:231` | PASS |
| `review-event` documented | `index.js:232` | PASS |
| Help token coverage asserted by test | test `printUsage prints the command help text` (`test/index.test.js:226-231`) | PASS |
| Every `KNOWN_COMMANDS` entry documented | test `printUsage documents every KNOWN_COMMANDS entry` (`test/index.test.js:234-250`) | PASS |
| Docs gate passes | `./scripts/verify-local.sh docs` → `PASS: all required documentation present` | PASS |
| Full suite passes | `node --test test/*.test.js` → tests 1661, fail 0 (post-rebase) | PASS |
| Diff scoped to task-1346 | `git diff --name-only main..HEAD` → 6 files (index.js, test/index.test.js, mission docs, backlog) | PASS |

## Review Round 1 Resolution

Reviewer (qwen) returned REQUEST_CHANGES with a single required change: the branch
appeared to bundle task-1290 (`custom`→`qwen` rename, ~35 files). Investigation
showed this was a **stale-branch artifact**, not actual scope creep: `main` had
advanced to include task-1290 (`7725a79a`) while `mission/task-1346` diverged at
`15252e14`, *before* task-1290 landed. `git diff main..HEAD` therefore rendered
task-1290 as reversions. Our branch's real changes (from the divergence point)
only ever touched the 6 task-1346 files.

Resolution: rebased `mission/task-1346` onto `main` (clean, no conflicts). The
diff now shows only the task-1346 changes (6 files, +133/-3). Gate and full suite
re-verified post-rebase.

Next action: Hand off the rebased branch to review round 2; the scope concern is
resolved (diff is now 6 task-1346 files) and all gates pass.
