# CP-2: Stage every non-conflicted dirty file

Removed the `isRepoLocalImplementationPath` and `isSafeToCommit` allowlist
from `repairHandoff`. After the existing unmerged-status check, it now passes
the entire porcelain-derived dirty-file list to one `git add --` call and then
creates the existing single auto-commit. The error return path and commit
message remain intact. Legacy tests that represented the removed restriction
now assert staging of those paths, while the conflict test continues to assert
that no files are staged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All non-conflicted dirty files are staged and committed together | `src/adapters/cli/commands/repair-handoff.ts`, `"repairHandoff auto-commits all non-conflicted dirty files for git-blocker handoff repair"` | PASS |
| Previously rejected `src/`, `docs/`, `graphify-out/`, and completed-backlog paths are covered | `test/task-2202-repair-handoff-autocommit.test.ts` | PASS |
| Conflicted porcelain statuses remain a no-stage blocker | `test/repair-handoff.test.ts`, `"repairHandoff refuses to commit when mission files are conflicted"` | PASS |
| Bounded active-step fixture remains committed | `test/task-2202-repair-handoff-autocommit.test.ts`, `"repairHandoff auto-commits bounded implementation files for active-step handoff repair"` | PASS |
| Focused repair-handoff tests pass | `npm test -- test/task-2202-repair-handoff-autocommit.test.ts test/repair-handoff.test.ts` | PASS |

Next action: Run the mission-wide `./scripts/verify-local.sh all` gate and assess whether ADR 0048 needs a durable behavior update.
