# CP-4: Final verification and ADR 0051 amendment

## Summary

Amended ADR 0051 with the corrected dependency direction, fixed a TypeScript import-path regression in `src/application/domain-ports.ts` (used `../../domain/` instead of `../domain/` for files at the `src/application/` root), and ran all required distribution, package, reproducibility, default-suite, lint/static-analysis, and hygiene checks.

### ADR 0051 amendment

Added a "Canonical application home (TASK-2314)" paragraph to the dependency direction section of `docs/adr/0051-ui-neutral-application-boundary.md`. This records that `src/application/` is the canonical home for contracts, ports, and services; that the legacy runtime tree now depends on `src/application/` (not the reverse); and that four modules were relocated from `src/platform/runtime/lib/application/`. No superseded-history clauses were added.

### SQLite accept fixture corrected (Round 2, Round 3)

`test/fixtures/application-boundary/accept-sqlite-adapter.ts` initially imported `../../adapters/sqlite/database-adapter.js`, which resolved to the nonexistent `test/adapters/sqlite/database-adapter.js`. Round 2 updated to `../../../../src/adapters/sqlite/database-adapter.js`, but this still resolved outside the worktree. Round 3 corrected to `../../../src/adapters/sqlite/database-adapter.js` (correct relative depth from `test/fixtures/application-boundary/`), which resolves to the real `src/adapters/sqlite/database-adapter.ts`. The test at `test/application-boundaries.test.ts:85-93` now asserts that the resolved target file exists via `fs.existsSync()`, and passes `APPLICATION_DIR` as scope so the transitive walk does not follow into the adapter (which lives outside `src/application/` and would bring its own `node:sqlite` / `node:fs` imports).

### Domain documentation updated (Round 3)

`src/domain/README.md:105-107` still referenced the old path `src/application/ports/domain.ts`. Updated to `src/application/domain-ports.ts` to match the relocated file.

### Import-path regression fix

`src/application/domain-ports.ts` imported from `../../domain/agents.js` and `../../domain/mission.js`, which resolve to the repository root's `domain/` directory (nonexistent). Corrected to `../domain/agents.js` and `../domain/mission.js`, matching the pattern used by sibling files in `src/application/` (e.g., `mission-authority.ts`). This was the root cause of the `tsc --noEmit` failure detected by the static-analysis gate during the active-to-review transition.

### Test failure investigation

The transition reported many test failures with only `'test failed'` as the message. Root cause analysis:
- Tests pass green on both the base commit (`138e7b589`) and the mission branch (1356 pass, 0 fail)
- The `domain-ports.ts` import-path bug caused `tsc --noEmit` to fail during the build phase of the transition
- The `source-runtime-alias.js` and `build-test-runtime.js` changes added new resolution paths that required a fresh `.test-runtime/` build — stale artifacts during transition caused the generic `'test failed'` errors
- These were transient build infrastructure issues, not a regression in test logic

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy `src/platform/runtime/lib/application/` no longer contains the four modules | Directory absent; `ls src/platform/runtime/lib/application/` returns ENOENT | PASS |
| Each relocated module has one canonical implementation under `src/application/` | `src/application/contracts.ts`, `ports.ts`, `active-service.ts`, `stats-backfill-service.ts` all present | PASS |
| No file under `src/application/` or `src/adapters/` imports the legacy runtime application path | `grep -r "src/platform/runtime/lib/application" src/application/ src/adapters/` returns no matches | PASS |
| Legacy adapters import from canonical paths | `legacy-active-adapter.ts:8-9` imports `contracts.js` and `ports.js` from `../../../../application/`; `legacy-stats-backfill-adapter.ts:3-4` same; `application-services.ts:1-2` imports `ActiveService` and `StatsBackfillService` from `../../../../application/` | PASS |
| No legacy-to-canonical reverse import introduced | `grep -r "src/platform/runtime/lib/application" src/application/ src/adapters/` returns no matches | PASS |
| Forwarding shims `src/application/services/index.ts` and `src/adapters/legacy/index.ts` absent | Both files removed; `ls` returns ENOENT | PASS |
| Boundary suite walks `src/application/` by directory | `test/application-boundaries.test.ts:16-27` — `applicationFiles()` and `collectTsFiles()` walk directory; test passes `APPLICATION_DIR` as scope | PASS |
| Newly violating file detected without test modification | `test/application-boundaries.test.ts:63` — writes temp file to `src/application/` and verifies detection | PASS |
| Guard rejects `node:sqlite` builtin | `test/fixtures/application-boundary/reject-node-sqlite.ts` imports `node:sqlite`; `test/application-boundaries.test.ts:81` | PASS |
| Guard permits `src/adapters/sqlite/` adapter path | `test/fixtures/application-boundary/accept-sqlite-adapter.ts:7` imports real file `../../../src/adapters/sqlite/database-adapter.js` (correct relative depth); `test/application-boundaries.test.ts:85-93` asserts resolved target exists via `fs.existsSync()` and passes `APPLICATION_DIR` scope so transitive walk stays within application layer | PASS |
| `px active` and `px stats-backfill` behaviours preserved | `test/application-services.test.ts` — active service tests launch-record-handoff order, cancellation, adapter failure; stats service tests query/mutation boundary | PASS |
| Build emits both canonical esbuild bundle and transitional CommonJS rollback | `npm run bundle` produces `build/px.mjs` (2.7 MB) and `dist/` tree; `npm run test:reproducible-output` passes (499 files) | PASS |
| Package-content audit passes | `npm run test:package-content` — 18 files, checksums verified | PASS |
| Relocated-module dist loading tests use new paths | `test/application-contracts.test.ts:4` — `require('../dist/application/contracts')`; `test/application-services.test.ts:4-5` — `require('../dist/application/stats-backfill-service')` and `require('../dist/application/active-service')` | PASS |
| Default suite completes green without reducing test count | `./scripts/verify-local.sh all` — 1356 tests pass, 0 failures | PASS |
| No focused or unannotated skipped tests | `./scripts/verify-local.sh static-analysis` — test-hygiene check passes | PASS |
| ADR 0051 amended with corrected dependency direction | `docs/adr/0051-ui-neutral-application-boundary.md:261-270` — "Canonical application home (TASK-2314)" paragraph added in dependency direction section | PASS |
| Static-analysis gate passes (ESLint + tsc + test-hygiene) | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: Submit round resolution with ADR amendment, domain-ports.ts fix, and complete CP-4 evidence.
