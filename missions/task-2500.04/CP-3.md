# CP-3 — Clean-checkout CI coverage, measured runtime, and the trust-model record

## Summary

CP-3 confirmed the GitHub-safe aggregate really covers its five mandated areas,
measured it end to end, and wrote the trust-model documentation the Backlog task
names as its deliverable.

- `npm run test:ci` now runs, in order: `npm run typecheck`, `npm run build`,
  `npm test`, `npm run test:integration:ci`, `npm run test:bundle`, and
  `npm run test:package-content`. Every step executed and passed in one
  invocation, exit 0.
- Added `docs/adr/0057-verification-tiers-and-trust-model.md` and its
  `docs/adr/index.md` entry. It fixes the four tiers and their permitted
  dependencies, records that GitHub-safe membership is positive rather than an
  exclusion list, requires a written reason for every local-only classification,
  and states separately what GitHub CI proves, what it does **not** prove, what
  local Parallix verification additionally proves, what it does not prove, and
  what only real-agent/local-AI verification proves.
- Added a `## Verification tiers` section to `AGENTS.md` naming the tier commands
  and the classification obligation for new integration tests.
- Repaired `test/task-2236-pi-e2e-repro.test.ts`, which pinned the exact source
  text of the runner's control-flag filter. The tier selectors changed that line,
  so the assertion is now behavioural: `buildTestRunPlan` is called with a
  requested file plus a control flag, and the flag must not reach `node --test`.
  The test's intent — an explicitly requested e2e file is forwarded, control
  flags are not — is unchanged and still enforced.

### Measured runtime of the CI-safe suite

`npm run test:ci` on this workstation (Linux, Node v24.15.0), one uncontended run:

| Stage | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` | `tests 2528 / pass 2528 / fail 0`, `duration_ms 45928` |
| `npm run test:integration:ci` | `tests 2122 / pass 2097 / fail 0`, `duration_ms 53365` |
| `npm run test:bundle` | pass, prints `@magnusekdahl/parallix 1.5.109` |
| `npm run test:package-content` | `Package-content audit passed (ADR 0044 §8): 45 files, checksums verified.` |
| **Whole aggregate** | **119.25 s wall clock, exit 0** |

No runtime tuning was applied and no test coverage was removed. One
non-pathological redundancy is recorded for a future decision rather than acted
on: `test/run-default-tests.ts` rebuilds the canonical bundle at the start of
every suite, so a single `npm run test:ci` builds three times (once explicitly,
once inside `npm test`, once inside `npm run test:integration:ci`). At ~10 s per
build against a 119 s total this is not a pathological case, and the runner's
self-build is deliberate protection for direct runner invocations, so removing it
would weaken a guarantee to save time the mission does not need saved.

### Local and real-agent lanes after the change

`npm run test:integration` still selects the whole integration layer (154 CI-tier
files plus the 3 local-tier files), and the `workflow` and `custom-agent-smoke`
gates in `config/integration-pipelines.json` plus the `workflow` and `agent-smoke`
entries in `workflow.config.json` are untouched. Nothing was moved out of local
verification: the three local-tier files are excluded from GitHub CI only, and
each is still selected by `npm run test:integration` and by
`npm run test:integration:local`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The GitHub-safe command completes build, typecheck, hermetic unit tests, selected deterministic integration tests, and portable package/bundle validation | `npm run test:ci` exit 0; its six stages are `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration:ci`, `npm run test:bundle`, `npm run test:package-content`; test `"the verification tiers have stable npm commands"` pins that composition | PASS |
| The CI tier runs without local AI, model configuration, Forgejo credentials/state, pre-existing worktrees, or private services | `npm run test:integration:ci` → `tests 2122 / fail 0` under the `test/bootstrap-parallix-home.ts` isolation preload, with no `PARALLIX_REAL_AGENT*` and no Forgejo credentials; test `"prohibited workstation dependencies cannot enter the GitHub-safe lane"` keeps such dependencies out | PASS |
| Portable package/bundle validation is included, with a justified exclusion where no portable command exists | `npm run test:package-content` (`scripts/package-content-audit.ts`) and `npm run test:bundle` run in the CI aggregate; `test/task-2285-pack-install-smoke.test.ts` and `test/web-package-smoke.integration.test.ts` are CI-tier; the native single-executable smoke `test/task-2286-native-sea-smoke.test.ts` is excluded with its reason recorded in `INTEGRATION_LOCAL_REASONS` | PASS |
| Local and real-agent lanes keep their coverage | `npm run test:integration` unchanged; `workflow` and `custom-agent-smoke` gates in `config/integration-pipelines.json` unchanged; `npm run test:agent-e2e` and `npm run test:lifecycle-e2e` added as explicit commands; `docs/real-agent-smoke.md` remains the blocking-gate record | PASS |
| The trust model distinguishes exactly what each lane proves | `docs/adr/0057-verification-tiers-and-trust-model.md`, section "What each tier proves", with an explicit does-not-prove statement for GitHub CI and for local verification; indexed in `docs/adr/index.md` | PASS |
| The CI-safe suite runtime is recorded | `npm run test:ci` wall clock 119.25 s; per-stage `duration_ms 45928` (unit) and `duration_ms 53365` (CI integration), table above | PASS |
| Documentation gate accepts the new records | `./scripts/verify-local.sh docs` → `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |

Next action: CP-4 — run the mission gate `./scripts/verify-local.sh all`, diff the
whole branch against `main` to confirm no local trust gate, gate command, or
integration-suite membership was weakened, and write the final goal-check
evidence against the mission's Success Criteria.
