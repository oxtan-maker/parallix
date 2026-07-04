# CP-2: Overlap Detection in printIntegrationPreflight()

## Summary

Modified `printIntegrationPreflight()` in `lib/commands/integrate.ts` to detect when dirty paths overlap with files that integrate mutates during closeout. The change upgrades overlapping dirty paths from a `WARN` to a `FAIL` with a clear recovery message.

Key changes in `integrate.ts:1251-1310`:
- Added overlap detection logic that checks dirty entries against:
  - `backlog/tasks/<slug>*.md` and `backlog/completed/<slug>*.md` (task files)
  - `missions/<slug>/MISSION.md` and the recorded mission dir path
- Overlapping dirty paths produce `FAIL` with `[STASH]` prefix and recovery steps
- Non-overlapping dirty paths still produce `WARN` with `[STASH]` prefix (safe to stash)
- Narrow overlap set per Stop Rules: only task files, completed files, and mission docs

## Goal Check

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | Overlap detection blocks unsafe integrates | `lib/commands/integrate.ts:1270` — `failures.push('main-dirty-overlap')` with FAIL message |
| 2 | Recovery message lists overlapping paths | `lib/commands/integrate.ts:1272-1274` — WARN entries for each overlapping dirty path |
| 3 | Non-overlapping dirty paths produce WARN | `lib/commands/integrate.ts:1286` — `warnings.push('main-dirty')` with [STASH] prefix |
| 4 | [STASH] prefix on dirty-state interactions | `lib/commands/integrate.ts:1271` — `[STASH] Integration checkout dirty: overlapping paths` |
| 5 | Narrow overlap set (no editor swaps/.env) | `lib/commands/integrate.ts:1261` — only checks `backlog/(tasks|completed)/` and `missions/<slug>/` |

## Next action
Harden `restoreMainCheckoutStash()` to use `git stash pop --index` or patch-based restore, and improve `reportStashPopFailure()` diagnostics.
