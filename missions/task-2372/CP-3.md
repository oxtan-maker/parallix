# CP-3: Final sweep and gates

## Summary

Ran the final reference sweep, the zero-behavior-change diff checks, and both
mission-declared gates against the final tree. Parent SHA for every diff below:
`c51cc7d70f000b1d18342a44eee4d437ef64f390`.

### Commands run and outcomes

- `git grep -nE "integrate-command\.(ts|js)" -- src test scripts workflow.config.json package.json`
  → **no output** (grep exit 1 = zero matches). The duplicate module has no live
  reference anywhere in `src/`, `test/`, `scripts/`, `workflow.config.json`, or
  `package.json`.
- `git grep -n "integrate-command" -- src test scripts workflow.config.json package.json`
  → four hits, all for the unrelated, explicitly out-of-scope
  `src/application/integrate-command-use-case.ts`
  (`src/composition/create-cli.ts`, `src/interfaces/cli/integrate.ts`,
  `test/cli-command-use-cases.test.ts`, `test/current-work-publication.test.ts`).
  This is why SC1 is verified with the module-precise pattern (see CP-0).
- `git diff --name-only c51cc7d70f000b1d18342a44eee4d437ef64f390 -- src/composition/create-cli.ts src/interfaces/cli/integrate.ts src/application/integrate-command-use-case.ts src/adapters/rebase/rebase-workflow-adapter.ts`
  → **no output** (SC3: production wiring byte-identical).
- `git diff --name-only --diff-filter=M c51cc7d70f000b1d18342a44eee4d437ef64f390 -- src/`
  → **no output** (SC7: no modified `src/` file).
- `git diff --name-only --diff-filter=D c51cc7d70f000b1d18342a44eee4d437ef64f390`
  → `src/adapters/cli/commands/integrate-command.ts` — the sole deletion.
- `git grep -nE "\.(only|skip)\(" -- test/forgejo-independence.test.ts test/task-2203-publish-proof-refresh-order.test.ts test/task-2204-integrate-no-variant-a.test.ts test/task-2242-backlog-drift.test.ts`
  → **no output** (no `.only`, no bare `.skip` introduced).
- **Gate 1** `git diff --check` → exit 0, no output.
- **Gate 2** `./scripts/verify-local.sh all` → **exit 0**; full suite
  `tests 2267 / pass 2267 / fail 0 / skipped 0 / todo 0`, plus
  `PASS: authored documentation contains no volatile implementation evidence and relative links resolve`
  and `[bundle-size] PASS: 3.1 MB within 5 MB stop rule`.
- `./scripts/verify-local.sh static-analysis` → exit 0:
  `PASS: ESLint clean`, `PASS: tsc typecheck clean`, `PASS: test-hygiene clean`,
  `PASS: test typecheck clean`, `=== Static Analysis Gate: ALL STAGES PASSED ===`
  (covers Definition of Done #2 for the changed files).
- **Mandatory integration gate** `./scripts/verify-local.sh integrate` → **exit 0** on
  the committed final tree (`5e76b9c48`); all four resolved gates `=== PASS ===`:
  `integration:build`, `integration:integration-suite` (`npm run test:integration`),
  `integration:workflow` (`test/e2e-mission-lifecycle.test.ts`),
  `integration:custom-agent-smoke` (`test/e2e-real-agent-smoke.test.ts`,
  `pass 1 / fail 0`). An earlier in-flight run of the same gate showed two transient
  single-test failures (`test/agents.test.ts` under parallel load, and
  `test/test-hygiene.test.ts` `test hygiene rejects .only in TypeScript tests` with a
  SIGPIPE exit); both reproduced green in isolation (`tests 100 pass / 0 fail`;
  `tests 6 pass / 0 fail`) and inside the final green `integration:integration-suite`
  run. Neither file is touched by this mission's diff.

### Checkpoint commits

Resolved: the git directory was remounted read-write and the full mission payload
(four `test/` retargets, the `src/` deletion, and `CP-0.md`–`CP-3.md`) landed as commit
`5e76b9c48` (`execute(task-2372): capture agent output`). The working tree is clean and
the mandatory integration gate ran green on that committed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — duplicate module gone, zero live references | `src/adapters/cli/commands/integrate-command.ts` deleted in `5e76b9c48` (sole `src/` entry vs `c51cc7d`); zero live references confirmed by green `test/integrate.test.ts` and `test/task-2369-regressions.test.ts` inside `./scripts/verify-local.sh integrate` | Met |
| SC2 — canonical export surface intact | `src/adapters/cli/commands/integrate.ts` unchanged in `5e76b9c48`; `test/forgejo-independence.test.ts` test `integrate printIntegrationPreflight gates Forgejo checks` passes | Met |
| SC3 — production wiring byte-identical | No modified `src/` file in `5e76b9c48` (sole `src/` entry is the SC1 deletion); `test/task-2369-regressions.test.ts` test `R2: an approved normal integration completes exactly once and a retry stays at one` passes | Met |
| SC4 — four test references retargeted, assertions unchanged | `test/forgejo-independence.test.ts` test `integrate gates syncMerged behind isForgejoReviewEnabled`; `test/task-2203-publish-proof-refresh-order.test.ts` test `Variant B: post-integrate hook runs before proof capture (task-2203 fix)`; `test/task-2204-integrate-no-variant-a.test.ts`; `test/task-2242-backlog-drift.test.ts` — all pass in the green integration-suite run | Met |
| SC5 — focused integration regressions incl. review-origin approval and failed landing | `npm test -- test/task-2369-regressions.test.ts` passes, incl. `R1: backlog promotion cannot complete the Mission when landing fails`, `R3: a review-origin integration completes only after the commit has landed`, `R4: a resumed integration is stamped with the landed commit time, not the retry time`; `test/integrate.test.ts` passes | Met |
| SC6 — full gate green, no focused/bare-skipped tests | `./scripts/verify-local.sh all` exit 0 (`pass 2267 / fail 0 / skipped 0`); `test/test-hygiene.test.ts` passes (incl. `test hygiene rejects .only in TypeScript tests`) | Met |
| SC7 — zero behavior change | `5e76b9c48` touches only the SC1 `src/` deletion, the four SC4 `test/` retargets, and `missions/task-2372/` docs; `./scripts/verify-local.sh integrate` exit 0 | Met |
| Gate: `./scripts/verify-local.sh all` | Exit 0 (`pass 2267 / fail 0 / skipped 0`, docs and bundle-size checks `PASS`) | Passed |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` exit 0 on committed tree `5e76b9c48`: `=== PASS ===` for integration:build, integration:integration-suite, integration:workflow (`test/e2e-mission-lifecycle.test.ts`), integration:custom-agent-smoke (`test/e2e-real-agent-smoke.test.ts`) | Passed |
| Gate: `git diff --check` | Exit 0 (no whitespace or conflict-marker output); paired with `./scripts/verify-local.sh integrate` exit 0 | Passed |
| DoD #2 — lint and static analysis clean | `./scripts/verify-local.sh static-analysis` exit 0 (`PASS: ESLint clean`, `PASS: tsc typecheck clean`, `PASS: test-hygiene clean`) | Met |
| Checkpoint commits | Payload committed (`5e76b9c48`; this revision `85ba19106`), working tree clean: `missions/task-2372/CP-0.md`, `missions/task-2372/CP-1.md`, `missions/task-2372/CP-2.md`, `missions/task-2372/CP-3.md`, deleted `src/adapters/cli/commands/integrate-command.ts`, `test/forgejo-independence.test.ts`, `test/task-2203-publish-proof-refresh-order.test.ts`, `test/task-2204-integrate-no-variant-a.test.ts`, `test/task-2242-backlog-drift.test.ts` | Met |

Next action: submit for review with `px review task-2372 --submit`.
