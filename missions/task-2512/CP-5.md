# CP-5: Unblock the agent-smoke merge gate

The `agent-smoke` integration gate failed twice in a row, on this branch and on
main, with `[parallix-workflow-failure] draft left placeholder markers (phantom
draft)`. The cause was not the step split and not model quality: the configured
local model backend was unreachable, and two layers reported success anyway.

- The Pi launcher resolved its session normally when the provider never
  answered. The SDK settles such a turn with an errored assistant message and
  zero tokens instead of throwing, so the launcher returned status 0 with empty
  output and `px draft` committed the unfilled MISSION.md scaffold. The launcher
  now treats a session that settles on a provider error as the failure it is,
  which restores the existing non-zero-status handling in every stage that runs
  through Pi (draft, active, review).
- The smoke harness judged its pre-flight probe on exit status alone, so an
  unreachable backend passed the probe and surfaced later as a misattributed
  phantom draft. The probe now has to return the `OK` it asks for, which routes
  the failure to the `local-model-environment` bucket up front.

No new end-to-end test: the launcher regression is covered by a mocked agent
session in `test/pi-runner.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A Pi session that never got a model response fails instead of reporting success | `npm test -- test/pi-runner.test.ts`, `"startPiAgent fails when the session settles on a provider error instead of a response"` | PASS |
| The agent-smoke gate passes on the final tree | `node --import tsx test/e2e-real-agent-smoke.test.ts` (exit 0, 1 pass, 0 fail, 2 skipped) | PASS |
| The mission's other declared gates still pass | `./scripts/verify-local.sh static-analysis` (exit 0), `npm test` (exit 0, 2629 pass), `npm run test:integration` (exit 0, 2139 pass), `node --import tsx test/e2e-mission-lifecycle.test.ts` (exit 0, 9 pass) | PASS |
| Operator-facing failure interpretation matches the harness | `docs/real-agent-smoke.md` | PASS |

Next action: re-run `px integrate task-2512`; the agent-smoke gate no longer
fails on an unreachable local backend without naming it.
