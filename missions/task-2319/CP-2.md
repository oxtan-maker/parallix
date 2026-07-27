# CP-2: Verification — build, git status, and packaging tests

## Summary

Verified that removing `NOTICES` from git tracking does not break packaging. Three
focused test suites confirm the generated `NOTICES` file is still produced by the build
and remains required in the published package artifact.

### Build + git status
- `npm run build` regenerates `NOTICES` on disk (confirmed: file present, version 1.4.43)
- `git status --short` does not list `NOTICES` as dirty (ignore rule at `.gitignore:33` takes effect)

### Packaging test results (all pass)

| Test file | Tests | Key NOTICES assertions |
|---|---|---|
| `test/task-2285-release-metadata.test.ts` | 13 pass | `"task-2285 files allowlist ships only the bundle payload and release metadata"` (line 40: `NOTICES` in `files[]`), `"task-2285 SBOM and NOTICES describe the same bundled package set"` (line 89) |
| `test/task-2285-pack-install-smoke.test.ts` | 11 pass | `"task-2285 install: the tarball contains only the bundle payload and release metadata"` (line 74: `NOTICES` in tarball entries) |
| `test/task-2228-distribution-verification.test.ts` | 6 pass | `"package-content audit requires the release-metadata artifacts"` (line 53: requires `NOTICES`), `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"` (line 26: `NOTICES` in required set) |
| `test/task-2285-rollback.test.ts` | 7 pass | `"task-2285 rollback: package-root assets resolve in the CommonJS layout"` (line 38: checks `NOTICES` in rollback) |
| `test/task-2319-notices-git-tracking.test.ts` | 5 pass | `"task-2319: NOTICES is not tracked in git"` (verifies `git ls-files --error-unmatch` exits non-zero), `"task-2319: .gitignore contains root-anchored /NOTICES entry"` (verifies `/NOTICES` rule), `"task-2319: .gitignore does NOT contain a bare (unanchored) NOTICES rule"` (regression against round-1 defect), `"task-2319: /NOTICES pattern matches only the root artifact (not nested)"` (root-anchor check), `"task-2319: NOTICES is listed in package.json files[] (published artifact)"`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `NOTICES` no longer tracked in git | `git ls-files --error-unmatch NOTICES` exits 1 | PASS |
| `.gitignore` exact root-level ignore; `git status --short` clean after build | `.gitignore:33` — `/NOTICES` (root-anchored); `npm run build` then `git status --short` omits NOTICES | PASS |
| Release verification treats `NOTICES` as required published metadata | `test/task-2285-release-metadata.test.ts` (13 pass, incl. line 40 + line 89); `test/task-2285-pack-install-smoke.test.ts` (11 pass, incl. line 74); `test/task-2228-distribution-verification.test.ts` (6 pass, incl. line 53) | PASS |
| `./scripts/verify-local.sh all` completes successfully | Pending in CP-3 | PENDING |

## Next action: Run `./scripts/verify-local.sh all` (CP-3) and document final gate results for every success criterion.
