# CP-3: Directory-scoped boundary guard and SQLite fixtures

## Summary

Changed the application boundary suite from a hardcoded 9-entry list to directory discovery over `src/application/`, added fixtures proving automatic coverage of newly violating files, and narrowed the SQLite rule to distinguish `node:sqlite` from `src/adapters/sqlite/`.

### Boundary guard scope parameter

Added optional `scopeDir` parameter to `findForbiddenApplicationDependencies()` in `src/platform/runtime/lib/architecture/boundary-guards.ts`. When provided, the transitive walk stays within the scope directory, preventing violations in adapter/infrastructure modules from polluting the application-layer check.

### Directory discovery

Rewrote `test/application-boundaries.test.ts` to:
- Walk `src/application/` recursively and check every `.ts` file (matching the `test/domain-import-boundary.test.ts` pattern)
- Assert all expected canonical modules are present in the scan
- Pass `APPLICATION_DIR` as the scope parameter so transitive imports stay within the application layer

### SQLite token narrowing

Changed the `forbidden` array in `boundary-guards.ts` from bare `'sqlite'` to `'node:sqlite'` and `'sqlite3'` (two separate tokens). This:
- Rejects the `node:sqlite` Node.js built-in (the actual forbidden import)
- Rejects `sqlite3` (the npm package)
- Permits `src/adapters/sqlite/` paths (the repository's own adapter directory)

### New fixtures and tests

- `test/fixtures/application-boundary/reject-node-sqlite.ts` — imports `node:sqlite`; guard rejects it
- `test/fixtures/application-boundary/accept-sqlite-adapter.ts` — imports from `../../adapters/sqlite/`; guard permits it (non-resolving local import avoids transitive violations)
- New test: `"application import guard detects a newly added violating file without modifying the test"` — writes a temporary file to `src/application/` with a forbidden import and verifies it's detected by directory discovery
- New test: `"boundary guard rejects node:sqlite builtin import"` — explicit reject fixture
- New test: `"boundary guard permits src/adapters/sqlite/ repository adapter path"` — explicit accept fixture

### Related test update

- `test/sqlite-adapter-cp1.test.ts` — updated SC2 negative check to use regex for import statements (`/from\s+['"]node:sqlite['"]/`) instead of raw string search, because `boundary-guards.ts` now contains `'node:sqlite'` as a configuration value (not an import)

### Verification

- `test/application-boundaries.test.ts` — 10 tests, all pass
- Full default suite: **1366 tests pass, 0 failures**
- Bundle size: 2.7 MB (within 5 MB stop rule)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Boundary guard walks src/application/ by directory | `test/application-boundaries.test.ts:33` — `applicationFiles()` walks directory; test passes `APPLICATION_DIR` as scope | PASS |
| Newly violating file detected without test modification | `test/application-boundaries.test.ts:63` — `"application import guard detects a newly added violating file without modifying the test"` writes temp file to `src/application/` and verifies detection | PASS |
| Guard rejects node:sqlite builtin | `test/fixtures/application-boundary/reject-node-sqlite.ts` imports `node:sqlite`; `test/application-boundaries.test.ts:81` — `"boundary guard rejects node:sqlite builtin import"` | PASS |
| Guard permits src/adapters/sqlite/ adapter path | `test/fixtures/application-boundary/accept-sqlite-adapter.ts` imports from `adapters/sqlite/`; `test/application-boundaries.test.ts:87` — `"boundary guard permits src/adapters/sqlite/ repository adapter path"` | PASS |
| Forbidden tokens narrowed from 'sqlite' to 'node:sqlite' + 'sqlite3' | `src/platform/runtime/lib/architecture/boundary-guards.ts:4` — `forbidden` array contains `'node:sqlite'` and `'sqlite3'` | PASS |
| Transitive walk scoped to application directory | `src/platform/runtime/lib/architecture/boundary-guards.ts:19` — `scopeDir` parameter limits `visit()` to files within scope | PASS |
| SQLite SC2 negative test updated for boundary-guards.ts | `test/sqlite-adapter-cp1.test.ts:349` — regex import check `/from\s+['"]node:sqlite['"]/` | PASS |

Next action: CP-4 — Amend ADR 0051, run all required distribution, package, reproducibility, default-suite, lint/static-analysis, and hygiene checks, then record final evidence against every success criterion.
