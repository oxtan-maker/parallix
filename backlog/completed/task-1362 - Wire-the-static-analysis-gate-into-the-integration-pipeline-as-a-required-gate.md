---
id: TASK-1362
title: Wire the static-analysis gate into the integration pipeline as a required gate
status: done
assignee: [custom]
created_date: '2026-06-26 21:48'
labels:
  - ai_sdlc
  - static-analysis
  - gate
  - integration
dependencies:
  - TASK-1360
  - TASK-1361
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task-1353 added the static-analysis gate (`./scripts/verify-local.sh static-analysis`: ESLint + tsc --checkJs + test-hygiene), but it is currently opt-in and enforced nowhere. `px integrate` loads integration gates from `config/integration-pipelines.json`, which does not exist, so integration gates are skipped entirely; handoff/review use `npm test` as the verification command. The deterministic LLM-defect catch the gate was built for therefore never runs automatically.

This task makes the gate real: add a `config/integration-pipelines.json` entry that runs `./scripts/verify-local.sh static-analysis` as a required gate for changes touching `lib/` (and/or wire it into the verification command), so any future mission that modifies `lib/` is blocked on a non-zero static-analysis exit.

HARD PREREQUISITE: this MUST land only after TASK-1360 (ESLint clean) AND TASK-1361 (tsc clean) are both done. Wiring it in while the gate is red would block every `lib/`-touching mission from integrating. Confirm `./scripts/verify-local.sh static-analysis` exits 0 across all three stages on main before enabling enforcement.

Branch from `main`. Verify the integration-pipelines config against the schema/loader in `lib/commands/integrate.js` (`getIntegrationGatePlan` / `loadIntegrationConfig`, keyed by changed top-level area).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `config/integration-pipelines.json` exists and is loaded by `px integrate` without a config error
- [x] #2 A gate entry runs `./scripts/verify-local.sh static-analysis` for missions that change `lib/`
- [x] #3 `px integrate <slug> --dry-run` on a mission that touches `lib/` shows the static-analysis gate in the integration gate plan
- [x] #4 Integration aborts (non-zero) when the static-analysis gate fails, and proceeds when it passes
- [x] #5 Enforcement is enabled only after `./scripts/verify-local.sh static-analysis` exits 0 across all three stages on main (TASK-1360 + TASK-1361 complete)
- [x] #6 Documentation notes that static-analysis is now a required integration gate for lib/ changes
- [x] #7 `npm test` passes (1726 pass, 3 pre-existing failures in test/review-events.test.js unrelated to this mission)
<!-- AC:END -->
