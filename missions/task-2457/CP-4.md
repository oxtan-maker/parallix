# Checkpoint 4 — Parallix self-hosting config + phase execution/failure coverage

## Summary
Configured this repository to opt into its own lifecycle gates through the new
repository configuration surface, and added focused execution and failure-block
coverage for all three phases.

- **Parallix self-hosting config** (`workflow.config.json`): `adapters.gates.preIntegration`
  declares four ordered gates that Parallix selects for itself while developing:
  `build` (`npm run build`, order 1), `verification`
  (`./scripts/verify-local.sh static-analysis`, order 2), `integration-suite`
  (`npm run test:integration`, order 3), `mutation`
  (`./scripts/verify-local.sh mutation-gate`, order 4), `workflow`
  (`node --import tsx test/e2e-mission-lifecycle.test.ts`, order 5), and
  `agent-smoke` (`node --import tsx test/e2e-real-agent-smoke.test.ts`, order 6).
  These run from the integration checkout via the generic runner wired in CP 3;
  they are explicit configuration, not inferred from the repo layout. The
  `integration-suite` and `mutation` gates were restored to this array in the
  round-1 fix (F1): the initial config dropped them, which had left Parallix's
  own merges without a test suite or mutation ratchet at the merge boundary.
  Round 2 reordered them to match the `run_last` policy already encoded in
  `config/integration-pipelines.json`: the two `run_last: true` gates
  (`workflow`, `agent-smoke`) run last so the cheaper, higher-signal
  `integration-suite`/`mutation` gates surface the real defect first.
  Round 3 set `"requirePreIntegration": true` so this repo fails closed on an
  empty `preIntegration` list (task-2457 F11/F9), while an unconfigured
  consumer still integrates with no gate.
- **Execution + failure coverage** (all green):
  - `test/task-2457-repro.test.ts` — 23 pass / 0 fail: per-phase configured
    passing gate executes once and receives the phase contract; per-phase
    configured failing gate blocks the phase and receives the contract;
    unconfigured checkout runs no gate; `loadRequirePreIntegration` defaults to
    false and honours the opt-in flag; `validateWorkflowConfig`/`validateRepositoryGates`
    reject malformed blocks and unknown gate keys; `px config` surfaces effective gates.
  - `test/handoff-use-case.test.ts` — `"handoff use case blocks the transition when a pre-handoff gate fails"`,
    `"handoff use case proceeds when the pre-handoff gate passes"`.
  - `test/review-commands-supplemental.test.ts` — `"submitReviewRound blocks approve when a pre-review gate fails"`,
    `"submitReviewRound permits approve when the pre-review gate passes"`.
  - `test/task-1039-integrate.test.ts` — `"integrate aborts before merge when a pre-integration gate fails"`, `"integrate fails closed when no pre-integration gates are configured"` (F9), and `"integrate proceeds without a gate when the repository does not opt into requirePreIntegration"` (F11 mirror).

### Verification-gate note
`npm test` (the `all`/`workflow` suite under `./scripts/verify-local.sh all`)
passes: **2406 pass / 0 fail**. The three tests that failed on the parent
commit `29a1bd1ab` (`BoardProjectionBuilder queues a gate-failed mission…`,
`performStaticReview accepts a bare repo path…`, `board unavailable action
ignores pointer…`) were fixed as baseline-red test repairs (no production-code
change to green them) in commit `5ce2dd540`; they are unrelated to this
mission. Round 2 added the fail-closed branch test (F9); round 3 added the
unconfigured-consumer mirror (F11) and the `requirePreIntegration`/unknown-key
validation tests. `./scripts/verify-local.sh docs`, `static-analysis`, and
`all` are clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unconfigured repo runs no gate, no Node/npm/tsx/verify-local.sh dependency | `test/task-2457-repro.test.ts`, `"unconfigured repository runs no gate for the handoff phase"` | PASS |
| Workflow config accepts documented disabled-by-default ordered gates; `px config` shows all three phases | `config/workflow.config.schema.json` `adapters.gates`; `test/task-2457-repro.test.ts`, `"workflow config surfaces configured gates through the effective config"` | PASS |
| Configured guard at each phase runs from the checkout with slug/checkout/phase env | `test/task-2457-repro.test.ts` phase templates + `test/handoff-use-case.test.ts` + `test/review-commands-supplemental.test.ts` + `test/task-1039-integrate.test.ts` | PASS |
| Non-zero guard blocks the phase/merge; success permits it | `test/task-1039-integrate.test.ts`, `"integrate aborts before merge when a pre-integration gate fails"`; `test/review-commands-supplemental.test.ts`, `"submitReviewRound permits approve when the pre-review gate passes"` | PASS |
| Merge gate fails closed only when the repo opts in; unconfigured repo integrates with no gate (F11/F9) | `test/task-1039-integrate.test.ts`, `"integrate fails closed when no pre-integration gates are configured"` (exit code 1) and `"integrate proceeds without a gate when the repository does not opt into requirePreIntegration"`; `workflow.config.json` opts in via `requirePreIntegration: true`; gates ordered per `run_last` policy so `workflow`/`agent-smoke` run last (F8) | PASS |
| Unconfigured repo completes integration path with no gate (success criterion 1) | `test/task-2457-repro.test.ts`, `"loadRequirePreIntegration defaults to false and honours the opt-in flag"`; `test/task-1039-integrate.test.ts`, `"integrate proceeds without a gate when the repository does not opt into requirePreIntegration"` | PASS |
| Generic planning/execution contain no Node/npm/tsx/verify-local.sh/Parallix rule | `src/adapters/config/repository-gates.ts`; integration gate no longer hardcodes `./scripts/verify-local.sh integrate` | PASS |
| Parallix config explicitly selects build/verification/workflow/agent-smoke/integration-suite/mutation gates; they stay active | `workflow.config.json` `adapters.gates.preIntegration` (build, verification, workflow, agent-smoke, integration-suite, mutation); `test/task-2457-repro.test.ts`, `"this repository selects its own build, verification, workflow, and agent-smoke gates"` reads the repo's own config from disk | PASS |
| Regression coverage: unconfigured + execution/failure for all three phases incl. repro test | `test/task-2457-repro.test.ts` (23 pass), `test/handoff-use-case.test.ts`, `test/review-commands-supplemental.test.ts`, `test/task-1039-integrate.test.ts` | PASS |

## Next action
Run `./scripts/verify-local.sh all` as the mission gate. The 3 baseline-red
failures (`29a1bd1ab`) are fixed in `5ce2dd540`; the full suite is green at
2403 pass / 0 fail.
