# CP-3

The active-step `repairHandoff()` seam now treats repo-local implementation paths as auto-committable while still rejecting operator-local/generated directories before staging. The change stays inside the handoff repair path: `isSafeToCommit()` now combines `isMissionArtifact()` with a new repo-local implementation-path check, and the updated regressions prove `.workflow/`, `.sessions/`, `.forgejo-local/`, and `graphify-out/` still block the repair flow.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Active-step repair widened in the intended seam instead of a blanket `git add -A` policy | `lib/commands/repair-handoff.ts:314`, `lib/commands/repair-handoff.ts:403` | PASS |
| Reproduction now passes for mission docs plus repo-local implementation files | `"repairHandoff auto-commits repo-local implementation files for active-step handoff repair"`, `node --test test/task-2202-repair-handoff-autocommit.test.js` | PASS |
| Operator-local/generated paths still refuse auto-commit in this seam | `"repairHandoff refuses to commit when operator-local or generated paths are dirty"`, `test/repair-handoff.test.js:84` | PASS |
| Existing branch-behind and stage-failure behavior remains covered after the change | `"repairHandoff calls rebase when branch is behind"`, `"repairHandoff reports staging failures and stops before commit"` | PASS |

Next action: run the mission gates, update the backlog task metadata if needed, then write `missions/task-2202/CP-4.md` with final verification evidence.
