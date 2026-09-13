# CP-2 — Positive tier membership, stable commands, and enforcement tests

## Summary

CP-2 implemented the command contract fixed in CP-1.

- Added `test/lib/test-categories.ts`, the single authority for verification-tier
  membership. It declares `INTEGRATION_CI_TESTS` (154 files), `INTEGRATION_LOCAL_TESTS`
  (3 files) with a mandatory `INTEGRATION_LOCAL_REASONS` entry each, `AGENT_E2E_TESTS`,
  and `PROHIBITED_CI_DEPENDENCY_MARKERS`.
- Taught `buildTestRunPlan` in `test/lib/test-run-plan.ts` the `--integration-ci` and
  `--integration-local` selectors. Both select **positively** from the registry;
  `--integration` still runs the whole integration layer, so the existing
  `integration-suite` gate in `config/integration-pipelines.json` keeps its coverage
  unchanged.
- Added the `test:integration:ci`, `test:integration:local`, `test:agent-e2e`,
  `test:lifecycle-e2e`, and `test:ci` scripts to `package.json`. `npm test` and
  `npm run test:integration` are untouched.
- Added `test/test-categories.test.ts` with seven focused guards.

The three local-only classifications and their recorded reasons:

| File | Recorded reason |
|---|---|
| `test/bubblewrap-worktree-git.test.ts` | spawns the real `bwrap` binary |
| `test/task-2270-graphify-exclusion.test.ts` | spawns the `uv`-installed `graphify` CLI |
| `test/task-2286-native-sea-smoke.test.ts` | needs a Node ≥ 25 SEA toolchain and per-OS native packaging |

### Enforcement, demonstrated

Adding a throwaway `test/task-0000-tier-probe.integration.test.ts` (since removed)
turned `"every integration-layer test file carries an explicit verification category"`
red with the message *"each file listed above crosses a real boundary but has no
category. Add it to INTEGRATION_CI_TESTS … or to INTEGRATION_LOCAL_TESTS plus
INTEGRATION_LOCAL_REASONS … in test/lib/test-categories.ts"*, and also turned
`"the CI and local integration lanes partition the integration layer"` red. The probe
file never appeared in the `--integration-ci` selection, so the GitHub-safe lane did
not grow by default.

Prepending a `childProcess.spawnSync('bwrap', [])` call to a CI-lane file (since
reverted) turned `"prohibited workstation dependencies cannot enter the GitHub-safe
lane"` red with `status.test.ts: bubblewrap is not in the GitHub-hosted runner image`.

### Measured tier runs

| Command | Result |
|---|---|
| `npm run test:integration:ci` | `tests 2122 / pass 2097 / fail 0`, `duration_ms 53869`, wall clock 56.41 s, exit 0 |
| `npm run test:integration:local` | `tests 21 / pass 20 / fail 1`, wall clock 43.32 s |

The single local-tier failure is `"Graphify excludes configured mission documents
before extraction while retaining source relationships"`, which aborts on this
workstation with `Read-only file system (os error 30) at path "/home/magnus/.cache/uv/..."`.
That is this checkout's sandbox denying `uv` its cache, and it is precisely the
workstation dependency that put the file in the local tier; the classification is
unaffected.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CI membership is positive, not a negative filter | `INTEGRATION_CI_TESTS` in `test/lib/test-categories.ts`; `--integration-ci` resolves through `declaredTier` in `test/lib/test-run-plan.ts`; test `"an unclassified integration test cannot enter the GitHub-safe lane"` | PASS |
| A new integration test requires an explicit classification decision | test `"every integration-layer test file carries an explicit verification category"`, shown red against a throwaway `*.integration.test.ts` probe and green after its removal | PASS |
| Prohibited dependencies cannot enter the CI lane by default | test `"prohibited workstation dependencies cannot enter the GitHub-safe lane"` over `PROHIBITED_CI_DEPENDENCY_MARKERS`, shown red against an injected `spawnSync('bwrap', ...)` | PASS |
| The two integration tiers partition the integration layer with no overlap or gap | test `"the CI and local integration lanes partition the integration layer"` | PASS |
| Each local-only test records its environmental boundary | `INTEGRATION_LOCAL_REASONS` in `test/lib/test-categories.ts`; test `"every local-only integration test records why a clean runner cannot run it"` | PASS |
| Stable npm commands exist for all four lanes | `npm run test:integration:ci`, `npm run test:integration:local`, `npm run test:agent-e2e`, `npm run test:lifecycle-e2e`, `npm run test:ci` in `package.json`; test `"the verification tiers have stable npm commands"` | PASS |
| Local and real-agent lanes keep their coverage | `npm run test:integration` still selects the full integration layer (`test/default-test-suite.test.ts`, `"default test runner routes every moved group to integration and excludes it from default"`, still green); the `workflow` and `custom-agent-smoke` gates in `config/integration-pipelines.json` are unchanged; test `"the real-agent and lifecycle suites stay out of the unit and integration lanes"` | PASS |
| The CI integration subset is runnable and green | `npm run test:integration:ci` → `tests 2122 / fail 0`, exit 0 | PASS |

Next action: CP-3 — run `npm run test:ci` end to end on this checkout to confirm
the aggregate covers build, typecheck, hermetic unit tests, the deterministic
integration subset, and portable package/bundle validation; record its measured
runtime; and write the three-guarantee trust-model documentation as a new ADR
with its `docs/adr/index.md` entry.
