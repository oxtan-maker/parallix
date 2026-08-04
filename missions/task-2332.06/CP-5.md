# CP-5 — legacy architecture removed

Deleted `src/platform/` rather than retaining aliases or a compatibility
facade. Removed the transitional CLI dispatcher and dependency allowlist, and
updated architecture documentation and path-sensitive tests to canonical homes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The legacy production directory is absent | `test ! -d src/platform` | PASS |
| Production and build inputs contain no legacy path reference | `! rg -n "src/platform|platform/runtime" src scripts package.json` | PASS |
| Dependency exceptions are deleted | `src/adapters/architecture/dependency-graph-allowlist.ts` is absent | PASS |
| Transitional CLI re-export is deleted | `src/interfaces/cli/dispatcher.ts` is absent | PASS |
| Documentation describes the canonical layers | `docs/adr/0037-ai-workflow-coordination-architecture.md`; `docs/authority-reference.md`; `src/domain/README.md` | PASS |

Next action: run the complete graph, static, default, integration, packaging, SEA, and recovery checks and record final evidence.
