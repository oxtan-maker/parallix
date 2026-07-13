# CP-3: Origin cleanup and end-to-end checkpoint verification

## Summary

Deleted all 16 existing `mission/*` branches from the `origin` (GitHub) remote. Updated the pre-push hook to allow `--delete` operations. Performed end-to-end verification of the `px checkpoint` command — it stages, commits, and completes without pushing to origin. Fixed a pre-existing CJS compat issue in `lib/commands/checkpoint.ts` (task-1396) that prevented the checkpoint command from running via the CLI.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: Existing `mission/*` branches on origin are deleted | `git ls-remote origin 'refs/heads/mission/*'` returns empty — all 16 branches deleted; policy documented at `AGENTS.md:18` | PASS |
| E2E: Checkpoint command completes without pushing to origin | `node px.js checkpoint task-2237 "CP-3 e2e test" "Final gates" --no-gate` confirmed no origin push; `lib/commands/checkpoint.ts:67` — push step removed | PASS |
| SC1: checkpoint.ts contains zero `git push origin` calls | `lib/commands/checkpoint.ts:67` — push step removed | PASS |
| Pre-push hook allows deletions | `AGENTS.md:18` — pre-push hook documented; `.git/hooks/pre-push` tested by `git push origin --delete` on 16 branches | PASS |
| CJS compat fix for checkpoint command | `lib/commands/checkpoint.ts:74` — `module.exports = checkpoint` added | PASS |

Next action: Run final gates (`./scripts/verify-local.sh all`), update backlog task, and commit all changes.
