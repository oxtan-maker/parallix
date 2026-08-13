# CP-1: Extract task file I/O

Moved task-file discovery, frontmatter reads, storage resolution, integrity maintenance, task-update commits, and repository-id helpers into the focused file-I/O adapter. `backlog.ts` imports those bindings and preserves its existing compatibility exports.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| File-I/O adapter exists with the required public operations | `src/adapters/backlog/task-file-io.ts` | PASS |
| Existing backlog entry point continues to expose file-I/O operations | `src/adapters/backlog/backlog.ts` | PASS |
| Static analysis passes after extraction | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Extract task assignee, label, and classification operations into `task-metadata.ts` while retaining the backlog compatibility exports.
