# CP-3: Establish the trusted GitHub release boundary

Added a release job to the existing literal `ci-required` workflow. It can run
only after a successful `ci-required` job on a `push` to `main`, checks out the
triggering SHA explicitly, and grants write/OIDC authority only to that job.
The release runner uses Node 24, npm 11.5.1, npmjs.org, and deterministic
dependency installation; it has no version-mutation step.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Release is eligible only after successful `main` push verification | `.github/workflows/ci-required.yml`, test `task-2509: release trusts only the successful main-push SHA with release-only OIDC permissions` | PASS |
| Trusted checkout is the triggering SHA | `.github/workflows/ci-required.yml`, `test/task-2509-release-workflow.test.ts` | PASS |
| Verification remains read-only; release has only contents-write and OIDC | `.github/workflows/ci-required.yml`, `test/task-2509-release-workflow.test.ts` | PASS |
| Node/npm and npmjs.org publishing boundary are explicit | `.github/workflows/ci-required.yml`, `test/task-2509-release-workflow.test.ts` | PASS |

Next action: Implement `npm run release:publish` as a fail-closed trusted-checkout validator for SemVer, matching manifests, npm freshness, normal-release ordering, and forbidden credentials before it can publish.
