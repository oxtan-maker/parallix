# CP-2: Allocate the version inside the landed commit

Moved local patch allocation into Variant B closeout before its explicit squash
commit. The closeout validates that `package.json` and `package-lock.json` agree,
stages both files, and adds them to the commit's explicit payload. The
post-integrate hook now retains only build, pack, install, and version-display
work, so it cannot create a second version-only commit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One logical mission commit includes matching version metadata | `test/task-2509-local-version-allocation.test.ts`, test `task-2509: local allocation is staged into the landed squash commit, not committed by the refresh hook` | PASS |
| Local allocation remains authoritative and post-hook rebuild behavior survives | `src/adapters/cli/commands/integrate.ts`, `scripts/refresh-global-px.sh`, `test/refresh-global-px-script.test.ts` | PASS |
| Tarball installation still handles lifecycle output and fails closed | `test/task-2206-post-integrate-hook-errors.test.ts`, test `refresh-global-px.sh passes a real tarball path to npm install even when npm pack prints lifecycle output` | PASS |
| Changed code passes static analysis | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Add the trusted-SHA release job to `.github/workflows/ci-required.yml`, with push-to-main eligibility, explicit `github.sha` checkout, read-only verification, and release-only OIDC/write permissions.
