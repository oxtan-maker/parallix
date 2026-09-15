# CP-4: Validate and package the declared trusted version

Added `scripts/release-publish.ts`, invoked by the release job. It validates
normal SemVer and matching manifest/lockfile metadata, refuses a stale version,
checks npm and tag collisions against the trusted SHA, rejects stored npm
credentials, then runs `prepack` and `prepublishOnly` before an OIDC provenance
publish to npmjs.org. It never calculates or writes a replacement version.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Invalid or unequal source metadata fails closed | `test/task-2509-release-publish.test.ts`, test `task-2509: release metadata accepts only matching normal SemVer versions` | PASS |
| Proposed normal release must advance when not already trusted-published | `test/task-2509-release-publish.test.ts`, test `task-2509: normal releases must advance the current normal release` | PASS |
| Deterministic install, package lifecycle, OIDC provenance publish are wired | `.github/workflows/ci-required.yml`, `scripts/release-publish.ts`, `package.json` script `release:publish` | PASS |
| Release script typechecks | `npm run typecheck` | PASS |

Next action: Expand collision/rerun coverage around `gitHead` and release tags, then ensure tag creation and GitHub Release creation preserve the trusted SHA or abort.
