# CP 2 — Core sandbox fix

Moved Codex's operator state-root resolution into `state-homes.ts`, added Claude's credential and session paths, and use one family resolver for review and non-review profiles. Existing credential files receive narrow file binds; absent leaves are neither created nor bound.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 non-review argv grants all required family state paths and retains root read-only bind | `test/task-2443-repro.test.ts`, `"task-2443: active claude argv binds credentials, session env, and project state"`, `"task-2443: active codex argv binds the configured host auth file"`, `"task-2443: active opencode argv binds only opencode state homes"`, `"task-2443: active pi argv binds only pi state homes"` | PASS |
| SC2 Codex honors `CODEX_HOME`; Claude includes credentials, session state, and project state | `src/adapters/config/state-homes.ts`, `test/task-2443-repro.test.ts` | PASS |
| SC3 review and non-review use the same resolver | `src/adapters/process/bubblewrap.ts` | PASS |
| SC4 no cross-family, qwen, or vibe host-home write grant | `test/task-2443-repro.test.ts`, `"task-2443: active profiles do not cross-bind families or grant qwen/vibe host homes"` | PASS |
| Absent credential leaves fail closed without creating a directory | `test/task-2443-repro.test.ts`, `"task-2443: absent credential leaves are not created or bound"` | PASS |
| Focused regression and existing guard tests | `npm test -- --unit-test-headroom test/task-2443-repro.test.ts test/bubblewrap-guard.test.ts` | PASS (24 tests) |

Next action: seed qwen's operator OAuth credential into its existing worktree-local home and cover present and absent sources.
