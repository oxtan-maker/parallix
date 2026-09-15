# CP-1: Map local allocation and pin one-commit semantics

The current allocator is `scripts/refresh-global-px.sh`: it runs after the
landed squash commit, calls `npm version patch`, then creates the unwanted
standalone `chore: bump version` commit. `src/adapters/cli/commands/integrate.ts`
already owns the landed commit and its explicit payload set, so CP-2 will move
allocation there before that commit and leave the hook responsible only for
rebuild, pack, and global self-update.

Added a focused red regression before changing either production path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Local allocator and closeout ownership are mapped | `scripts/refresh-global-px.sh`, `src/adapters/cli/commands/integrate.ts`, `test/task-2203-publish-proof-refresh-order.test.ts` | PASS |
| One-commit allocation behavior is specified before implementation | `test/task-2509-local-version-allocation.test.ts`, test `task-2509: local allocation is staged into the landed squash commit, not committed by the refresh hook` | PASS (red until CP-2) |
| Existing rebuild/self-update responsibility remains covered | `test/refresh-global-px-script.test.ts`, `test/task-1424-post-integrate-publish-reinstall.test.ts` | PASS |

Next action: Move patch allocation into the Variant B closeout before its explicit squash commit, stage both manifests there, then reduce `refresh-global-px.sh` to rebuild/pack/reinstall work and turn the new regression green.
