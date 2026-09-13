# CP-4 — Mission gate, trust-gate weakening review, and final goal check

## Summary

CP-4 ran the mission-declared gate, reviewed the whole branch diff for accidental
weakening of local trust gates, and records the final evidence against the
mission's Success Criteria.

### Gates

| Gate | Result |
|---|---|
| `./scripts/verify-local.sh all` (mission-declared) | exit 0 — `PASS: authored documentation contains no volatile implementation evidence and relative links resolve`, `tests 2528 / pass 2528 / fail 0`, 40.74 s |
| `./scripts/verify-local.sh static-analysis` (repo integration gate for code changes) | exit 0 — `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint, `npm run typecheck`, `scripts/test-hygiene.sh`, test typecheck) |
| `npm run test:ci` (the new GitHub-safe aggregate) | exit 0, 119.25 s |
| `npm run test:integration:ci` | exit 0, `tests 2122 / fail 0` |

### Pre-integration repair

The `integration-suite` gate later exposed a host npm cache configured at the
read-only `/home/magnus/.npm`. The shared test bootstrap now assigns
`NPM_CONFIG_CACHE` a registered temporary directory, keeping `npm pack` and its
package smoke tests inside the same disposable boundary as `HOME`. Test
`"bootstrap forces a temp PARALLIX_HOME with an isolated agents.local.json"`
asserts the cache setting. The repaired gate reached and passed all package
smoke tests; its remaining failure is the declared local-only Graphify test,
whose `uv --offline --with graphifyy` invocation cannot lock the read-only host
`/home/magnus/.cache/uv`. That host mount is outside this mission's worktree and
cannot be repaired by a repository change.

### Weakening review

`git diff main...HEAD --stat` touches 13 files. Reviewed for trust-gate impact:

- **`config/integration-pipelines.json`, `workflow.config.json`, `scripts/`** — not
  in the diff at all. The `build`, `integration-suite`, `workflow`, and
  `custom-agent-smoke` gates and the `adapters.gates.preIntegration` merge-gate
  array are byte-for-byte unchanged, so the pre-merge authority is untouched.
- **`package.json`** — five added script entries only. `test`,
  `test:integration`, `typecheck`, `test:bundle`, `test:package-content`,
  `prepack`, and `prepublishOnly` are unchanged, so the `integration-suite` gate
  still runs `npm run test:integration` over the whole integration layer.
- **`test/lib/test-run-plan.ts`** — the `--integration` branch still resolves to
  the same `[...integrationTestFiles, ...subdirIntegrationFiles]` set; the two new
  branches only add narrower selections. No file left the integration layer and no
  file entered the hermetic default suite.
- **`test/task-2236-pi-e2e-repro.test.ts`** — one assertion converted from a
  source-text pin to a behavioural assertion over `buildTestRunPlan`. The other
  six assertions in that test are unchanged, and the converted one still fails if
  a control flag reaches `node --test` or a requested file does not.
- **`AGENTS.md`, `docs/adr/`, `missions/`** — documentation additions.

Nothing was reclassified into the GitHub-safe tier to avoid an environmental
dependency: the movement went the other way, with three files named and excused
out of the CI tier while remaining in the full integration layer.

The Backlog task file's frontmatter diff (`status`, `assignee`, `labels`) is
Parallix's own lifecycle transition, committed by the harness before this session
began; no checkpoint edited that file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A maintained classification records every current test family with its environmental boundary | `test/lib/test-categories.ts` (`INTEGRATION_CI_TESTS` 154 entries, `INTEGRATION_LOCAL_TESTS` 3 entries with `INTEGRATION_LOCAL_REASONS`, `AGENT_E2E_TESTS`); `unit` is the complement selected by `npm test`; tests `"every integration-layer test file carries an explicit verification category"` and `"the CI and local integration lanes partition the integration layer"` keep it exhaustive | PASS |
| The GitHub-safe aggregate and its CI-integration command use positive membership | `npm run test:ci` and `npm run test:integration:ci` resolve through `declaredTier(INTEGRATION_CI_TESTS)` in `test/lib/test-run-plan.ts`; test `"an unclassified integration test cannot enter the GitHub-safe lane"` | PASS |
| A newly authored integration test cannot enter the CI-safe command without an explicit decision, enforced by automated coverage | test `"every integration-layer test file carries an explicit verification category"`, demonstrated red in CP-2 against a throwaway `*.integration.test.ts` probe; test `"prohibited workstation dependencies cannot enter the GitHub-safe lane"`, demonstrated red against an injected `spawnSync('bwrap', …)` | PASS |
| On a clean checkout with no local AI, model configuration, Forgejo credentials/state, pre-existing worktree, workstation state, or private service, the GitHub-safe command completes build, typecheck, hermetic unit tests, deterministic integration tests, and portable package/bundle validation | `npm run test:ci` exit 0, running `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration:ci`, `npm run test:bundle`, `npm run test:package-content`; isolation is supplied by the `test/bootstrap-parallix-home.ts` preload (temp `HOME`/`PARALLIX_HOME`/`FORGEJO_HOME`, unreachable `FORGEJO_URL`, request guard); test `"the verification tiers have stable npm commands"` pins the composition | PASS |
| Stable npm commands exist and are documented for all four lanes, and the local/agent lanes remain runnable outside GitHub CI | `npm run test:integration:ci`, `npm run test:integration:local`, `npm run test:agent-e2e`, `npm run test:lifecycle-e2e` in `package.json`; documented in the `## Verification tiers` section of `AGENTS.md` and in `docs/adr/0057-verification-tiers-and-trust-model.md`; `npm run test:integration:local` ran here and selected its 3 declared files | PASS |
| Existing local Parallix and real-agent obligations retain their coverage and were not reclassified into the GitHub-safe tier | `config/integration-pipelines.json` and `workflow.config.json` absent from `git diff main...HEAD --stat`; `npm run test:integration` unchanged in `package.json`; test `"the real-agent and lifecycle suites stay out of the unit and integration lanes"`; `test/default-test-suite.test.ts`, `"default test runner routes every moved group to integration and excludes it from default"`, still green | PASS |
| The trust-model documentation distinguishes what GitHub CI, local Parallix verification, and real-agent/local-AI verification each prove | `docs/adr/0057-verification-tiers-and-trust-model.md`, section "What each tier proves", with a paired does-not-prove statement for the first two lanes; indexed in `docs/adr/index.md`; `./scripts/verify-local.sh docs` passes | PASS |
| The CI-safe suite runtime is recorded, and any tuning removed no meaningful coverage | `npm run test:ci` 119.25 s wall clock, per-stage `duration_ms 45928` (unit, 2528 tests) and `duration_ms 53365` (CI integration, 2122 tests), recorded in `missions/task-2500.04/CP-3.md`; no tuning applied and no test deleted — the branch diff adds test files and adds no deletions to `test/` | PASS |
| The mission-declared gate passes | `./scripts/verify-local.sh all` exit 0, `tests 2528 / pass 2528 / fail 0` | PASS |

Next action: hand off TASK-2500.04 for review, flagging for TASK-2500.05 that the
GitHub workflow it owns should invoke `npm run test:ci` as the single required
check and must not add `npm run test:integration`, `npm run test:integration:local`,
`npm run test:agent-e2e`, or `npm run test:lifecycle-e2e` to the hosted runner.
