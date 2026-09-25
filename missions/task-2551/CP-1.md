# Checkpoint 1 — Post-integration SonarQube Cloud mission branch deletion (ADR 0060)

## Goal
After a mission is confirmed integrated, delete exactly that mission's SonarQube Cloud branch analysis so integrated missions do not accumulate dead branch analyses. Failed, closed, and review-only missions keep their analysis, and a deletion failure is surfaced without changing the confirmed integration result.

## Work Done

### SonarQube Cloud branch deletion (`scripts/sonar-local.ts`)
- `deleteSonarBranch`: issues `DELETE /api/project_branches/delete?project=parallix&branch=<branch>` on SonarQube Cloud with a Basic-auth header derived from `SONAR_TOKEN`. An already-absent branch (HTTP 404) is a no-op, so the cleanup is idempotent; any other status throws. The request function is injectable, keeping the tests hermetic.
- `deleteMissionBranch`: the post-integration entrypoint. Resolves the Cloud branch as `<branchPrefix><slug>` from the hook slug (`INTEGRATE_HOOK_SLUG`) and the repo-configured mission branch prefix (`workflow.config.json` → `adapters.missions.branchPrefix`). Every failure path (missing slug/prefix, missing `SONAR_TOKEN`, failed HTTP deletion) is returned as a surfaced `{ ok: false, error }` result and emitted to stderr — never thrown — because a cleanup failure must not change a confirmed integration outcome.
- New `delete-branch` subcommand on the CLI plus an `npm run sonar:delete-branch` script entry. The subcommand always exits 0; failures are surfaced on stderr.

### Post-integrate hook wiring
- `workflow.config.json` post-integrate command is now `./scripts/refresh-global-px.sh && npm run sonar:delete-branch`. The `&&` chain means a global-px refresh failure aborts the hook before any SonarQube call; the deletion step itself never fails the hook. Deletion is reachable only through this confirmed-integration hook, which is what keeps failed, closed, and review-only mission analyses intact.

### ADR 0060 documentation
- `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` gains a "Post-integration branch cleanup" section recording the policy: only the integrated mission's own branch is deleted (`main` and `github-publish/<sha>` untouched), failed/closed/review missions keep their analysis, a failed or unauthenticated deletion never changes the confirmed integration result and is manually retryable, and the cleanup is idempotent. Also clarifies the distinction from the retired one-project-per-mission deletion mechanism, and updates the positive-consequences line accordingly.

### Tests and classification
- `test/task-2551-sonar-branch-cleanup.test.ts` (new, 7 tests): request-injected coverage of the exact delete URL/headers, the 404 idempotent no-op, non-404 failure surfacing, slug/prefix branch resolution, missing-token behavior (no request invoked), non-throwing failure results, plus one real subprocess proving the `delete-branch` subcommand exits 0 with a surfaced error when `SONAR_TOKEN` is missing (no network reached).
- `test/refresh-global-px-script.test.ts`: the hook-wiring test now asserts the full `refresh && sonar:delete-branch` command, and a new test asserts the refresh step precedes the deletion step in the chain.
- Classification: `task-2551-sonar-branch-cleanup.test.ts` crosses a process boundary (one real `node --import tsx` subprocess), so it is registered in the integration layer — `test/lib/test-categories.ts` (`INTEGRATION_CI_TESTS`) and the expected integration list in `test/default-test-suite.test.ts`.

### Gates (run on the final tree)
- `./scripts/verify-local.sh docs` → `PASS: authored documentation contains no volatile implementation evidence and relative links resolve`
- `./scripts/verify-local.sh static-analysis` → `=== Static Analysis Gate: ALL STAGES PASSED ===`
- `npx tsx --test test/task-2551-sonar-branch-cleanup.test.ts` → 7 pass, 0 fail

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| AC#1: A confirmed integration deletes exactly the matching mission branch analysis | `test/task-2551-sonar-branch-cleanup.test.ts`, `"deleteSonarBranch issues project_branches/delete for the parallix project and exactly the mission branch"`; `"deleteMissionBranch resolves the branch from the hook slug and the configured branch prefix"`; `test/refresh-global-px-script.test.ts`, `"workflow.config.json wires the generic post-integrate hook to the checked-in script"`; `ADR 0060` | PASS |
| AC#2: Failed, closed, and review-only missions retain their analysis | `ADR 0060` ("Post-integration branch cleanup" — deletion reachable only through the confirmed-integration hook); `test/refresh-global-px-script.test.ts`, `"the post-integrate hook chain runs the global px refresh before the SonarQube mission branch deletion"` | PASS |
| AC#3: A deletion failure is surfaced without changing the confirmed integration result | `test/task-2551-sonar-branch-cleanup.test.ts`, `"deleteMissionBranch surfaces a failed deletion without throwing so the hook chain stays green"`; `"the delete-branch subcommand exits 0 with a surfaced error when SONAR_TOKEN is missing"` | PASS |
| Verification gate passed on the final tree | `./scripts/verify-local.sh docs` → PASS; `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |
| New boundary test explicitly classified | `test/lib/test-categories.ts` (`INTEGRATION_CI_TESTS`), `test/default-test-suite.test.ts` | PASS |

## Next action
All acceptance criteria met and both verification gates pass on the final tree. Commit this checkpoint document and re-run the handoff; no further implementation remains.
