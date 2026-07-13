# CP-1: Remove origin push from checkpoint and tracking ref

## Summary

Removed the `git push origin <branch>` call from `lib/commands/checkpoint.ts` so that the checkpoint command stages and commits without pushing to the GitHub `origin` remote. Removed the unused `getCurrentBranch` import. Updated `resolveTrackingBranchSha` in `lib/tools/forgejo.ts` to no longer check `refs/remotes/origin/<branch>` as a candidate ref for mission branch resolution, keeping only `refs/remotes/review/<branch>`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `lib/commands/checkpoint.ts` contains zero `git push origin` calls | `lib/commands/checkpoint.ts:67` — push step removed; line reads `Checkpoint complete (local-only — branch not pushed to origin).` | PASS |
| SC2: `resolveTrackingBranchSha` no longer checks `refs/remotes/origin/` | `lib/tools/forgejo.ts:1005` — candidateRefs reduced to `[`refs/remotes/review/${branch}`]` only | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene all PASS | PASS |

Next action: CP-2 — Add "Local-only development" section to AGENTS.md and configure the hard git push rule for origin.
