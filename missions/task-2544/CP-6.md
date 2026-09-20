# CP 6 — Run the verification gate and complete the Goal Check

## Goal
Run both mission gates and complete the final Goal Check table mapped to the
mission Success Criteria (SC1–SC7).

## Work done
Both gates pass on the final tree:

- `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint clean,
  tsc typecheck clean, test-hygiene clean, test typecheck clean).
- `./scripts/verify-local.sh all` → exit 0, 2869 pass / 0 fail.

The full-suite gate initially failed once on `default-test-suite.test.ts`
because its hardcoded `expectedIntegrationFiles` list did not yet include the new
isolation test; the test was registered in `test/lib/test-categories.ts`
(`INTEGRATION_CI_TESTS`; both queried worktrees created before resolution) but the mirror list in
`test/default-test-suite.test.ts` was not updated. Added it and re-ran green.
Retained the failure diagnostic while repairing (no compaction on a failed gate).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: two worktree analyses do not overwrite each other | `scripts/sonar-local.ts` `resolveSonarProjectKey` (parallix-<sanitized, bounded>-<sha256>, collision-free suffix; total key <= 400 chars); `test/task-2544-sonar-worktree-isolation.test.ts`, "task-2544: branch normalization is collision-free", "task-2544: over-long branch key stays within SonarQube 400-char limit" | PASS |
| SC2: verification queries resolve against current worktree identity, not literal `parallix` | `scripts/sonar-local.ts` `assertNewIssuesFail` uses `resolveSonarProjectKey(rootDir)`; `test/task-2544-sonar-worktree-isolation.test.ts`, `"task-2544: querying one branch analysis targets only that branch identity"` | PASS |
| SC3: `main` retains a dedicated identity distinct from every feature/mission worktree | `scripts/sonar-local.ts` `MAIN_PROJECT_KEY = 'parallix'` for branch `main`; ADR 0060; focused test asserts `resolveSonarProjectKey(main) === 'parallix'` | PASS |
| SC4: local no-token path unchanged; runSonar still pins newCode to main | `scripts/sonar-local.ts` `setupSonar`/`readSonarToken` unchanged; `-Dsonar.newCode.referenceBranch=main` retained; `test/task-2527-local-sonar.test.ts` (3 pass) | PASS |
| SC5: CI step and pre-integration gate invoke the isolated scan command | `.github/workflows/ci-required.yml` coverage+sonar step `npm run sonar`; `workflow.config.json` `adapters.gates.preIntegration[3]` `quality-gate`; `test/task-2525.03-sonar-enforcement.test.ts` (6 pass) | PASS |
| SC6: focused test asserts two distinct analyses independently queryable | `test/task-2544-sonar-worktree-isolation.test.ts`, registered `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS` | PASS |
| SC7: static analysis clean, no `.only`/bare `.skip` | `./scripts/verify-local.sh static-analysis` (test-hygiene clean); `./scripts/verify-local.sh all` exit 0, 2869 pass / 0 fail | PASS |
| Mission gate: verify-local all | `./scripts/verify-local.sh all` exit 0 | PASS |
| Mission gate: verify-local static-analysis | `./scripts/verify-local.sh static-analysis` ALL STAGES PASSED | PASS |

## Next action
All six checkpoints committed, both gates green. Verify no mission or checkpoint
documents are uncommitted, then confirm the backlog task file is intact; hand
off (Parallix performs the lifecycle transition).
