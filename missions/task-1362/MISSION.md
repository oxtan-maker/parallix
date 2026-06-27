---
id: TASK-1362
title: Wire the static-analysis gate into the integration pipeline as a required gate
status: done
assignee: []
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

# Mission: Wire the static-analysis gate into the integration pipeline as a required gate (task-1362)

## Goal

Make the static-analysis gate (`./scripts/verify-local.sh static-analysis`) a mandatory integration gate for any mission that modifies files under `lib/`, so that ESLint + tsc --checkJs + test-hygiene failures block the `px integrate` merge. Achieve this by creating `config/integration-pipelines.json` with a `lib` area entry and extending the area-detection logic in `lib/commands/integrate.js` to recognize `lib` as a known top-level area.

## Why Now

Task-1353 (task-1360) and task-1361 cleaned ESLint and tsc errors respectively, meaning `./scripts/verify-local.sh static-analysis` now exits 0 on main. The gate was intentionally built to catch deterministic LLM defects before they land, but `config/integration-pipelines.json` does not yet exist, so `px integrate` skips integration gates entirely. Without this wiring, every future mission touching `lib/` can merge code that bypasses static analysis — the exact risk the gate was designed to prevent.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: TASK-1360 and TASK-1361 are complete (gate is green on main); the integration-pipelines config seam is already coded but unpopulated; existing tests exercise the gate-loading and execution path end-to-end

## Scope

- Add `'lib'` to the `knownAreas` array in `lib/commands/integrate.js` (line ~272) so file changes under `lib/` are detected as belonging to the `lib` area
- Create `config/integration-pipelines.json` with a `lib` gate entry mapping to the command `./scripts/verify-local.sh static-analysis`
- Add unit tests covering: `lib` as a known area in `parseFilesToAreas`, the `lib` gate appearing in `getIntegrationGatePlan` output for a `lib/`-touching mission, and the gate aborting integration when the command fails
- Update `AGENTS.md` (Section 2 — "The core workflow" or the integration-gates subsection) to document that static-analysis is now a required gate for `lib/` changes
- Update `docs/adr/0041-integration-pipeline-gates.md` Deliverables section to reflect that `config/integration-pipelines.json` now includes a `lib` entry

## Out of Scope

- Adding static-analysis gates for other areas (`server`, `auth-server`, `web-client`, etc.) — those belong in separate missions
- Modifying `scripts/verify-local.sh` or the static-analysis subcommand itself
- Adding Forgejo Actions / CI integration for the gate (deferred per ADR 0041 follow-up trigger)
- Changing the `--no-integration-gates` opt-out behavior or adding new flags
- Running `./scripts/verify-local.sh static-analysis` manually to verify — the gate is verified indirectly through the integration-pipelines test suite

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `config/integration-pipelines.json` exists, is valid JSON, and contains a `gates.lib` entry with `command` set to `./scripts/verify-local.sh static-analysis`
2. `parseFilesToAreas` (in `lib/commands/integrate.js`) returns `'lib'` as a detected area when given a file path under `lib/` (e.g., `lib/commands/integrate.js`)
3. `getIntegrationGatePlan` for a mission with `changedAreas=['lib']` returns a gate plan containing exactly one gate with `key='lib'` and `command='./scripts/verify-local.sh static-analysis'`
4. `getIntegrationGatePlan` for a mission with `changedAreas=['docs']` does NOT include the `lib` gate
5. `executeIntegrationGates` aborts (returns `{ok:false, failedGate:'lib'}`) when the `lib` gate command exits non-zero
6. `executeIntegrationGates` succeeds (returns `{ok:true, failedGate:null}`) when the `lib` gate command exits zero
7. `npm test` passes with no failures (all 1724+ existing tests still pass)
8. `AGENTS.md` documents that static-analysis is a required integration gate for `lib/` changes

## Risks and Assumptions

- **Assumption:** `./scripts/verify-local.sh static-analysis` exits 0 on main. If TASK-1360 or TASK-1361 regressed after the gate wiring, enabling the gate would block all `lib/` missions. Mitigation: verify exit-0 before creating the config entry.
- **Risk:** Adding `lib` to `knownAreas` could widen gate triggering if future missions change `lib/` files but are classified under a different area. Mitigation: `lib` is the core library directory and missions touching it inherently affect the framework; the gate is appropriately scoped.
- **Risk:** The gate command runs on the workstation during integration, increasing wall time. Mitigation: ESLint + tsc + test-hygiene typically complete in under 60 seconds on a clean repo.
- **Assumption:** TASK-1360 and TASK-1361 are both marked complete before this mission starts. The backlog task explicitly states this as a hard prerequisite.

## Checkpoints

- CP 1: Verify `./scripts/verify-local.sh static-analysis` exits 0 on main (confirm TASK-1360 + TASK-1361 green state)
- CP 2: Add `'lib'` to `knownAreas` in `lib/commands/integrate.js` and confirm `parseFilesToAreas` detects it
- CP 3: Create `config/integration-pipelines.json` with the `lib` gate entry
- CP 4: Add unit tests for `lib` area detection and gate execution in `test/integration-pipelines.test.js`
- CP 5: Update `AGENTS.md` and `docs/adr/0041-integration-pipeline-gates.md` to reflect the new gate
- CP 6: Run `npm test` — all tests pass

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas

- Do not modify `scripts/verify-local.sh` or any of its subcommands
- Do not modify any `lib/` source files beyond adding `'lib'` to the `knownAreas` array in `integrate.js`
- Do not create or modify any files outside `config/`, `test/`, `AGENTS.md`, and `docs/adr/0041-integration-pipeline-gates.md`
- Do not change the `assignee` field on the backlog task

## Stop Rules

- Stop if `./scripts/verify-local.sh static-analysis` exits non-zero on main — the prerequisite is not met, and enabling the gate would block all `lib/` missions
- Stop if `npm test` reveals a pre-existing test failure unrelated to this mission's changes
- Stop if the `knownAreas` change causes unexpected gate triggering for existing missions (detected via dry-run gate plan tests)
