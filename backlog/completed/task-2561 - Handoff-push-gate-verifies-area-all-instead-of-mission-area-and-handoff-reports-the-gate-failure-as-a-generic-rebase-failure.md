---
id: TASK-2561
title: >-
  Unblock the mission lifecycle after TASK-2521.03: draft bounce-back, worktree
  provisioning, push-gate area and diagnostic, integration-gate re-review,
  px status speed, and a real-agent smoke that no longer masks them
status: done
assignee: [claude]
created_date: '2026-09-23 08:54'
labels:
  - workflow
  - handoff
  - draft
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 98008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why this is one mission

Since TASK-2521.03 moved the mission contract into typed Mission state, no mission can reliably get from the backlog to integration. Each defect below stops a mission at a different stage. Filed as separate tickets they block each other, because the mission that would fix one is itself stopped by another. This mission fixes the whole chain. It absorbs TASK-2550, TASK-2556, TASK-2562 and TASK-2563, which have been archived.

The real-agent smoke (`test/e2e-real-agent-smoke.test.ts`) exists to stop this kind of stall, and it passed throughout. It passed because the harness covers for the product at each point where the product fails (see section 6).

## 1. Draft ends as a hard failure on an incomplete contract (was TASK-2563)

Observed: `px draft task-2561 --agent claude`, 2026-09-23, claude session 3db9e492-b0e2-4aeb-b66a-597ddd5cc107.

- The agent recorded goal/why/scope (version 3), then chained the remaining 13 writes in one Bash call. Each write read `--expected-version $(px status ...)`, and `px status` takes ~60s, so the call ran past the 120s tool timeout and moved to the background. The agent ended its turn to wait. In `-p` mode that ends the session, and the background task was killed.
- `finalTransition` in `src/adapters/cli/commands/draft-stats.ts` called `recordDraftRefinement`, which threw from `requireDraftedContract` (`src/domain/mission-workflow.ts`). `px draft` exited 1 with "Repair: ensure the operator-local database is reachable, then re-run the draft". That message is wrong for a contract violation. Re-running the draft starts a new agent and discards the research.
- There is no bounce-back at the draft -> refined boundary. Handoff has a rebound/repair loop; draft does not.
- `prompts/draft-core.md` states the required fields inconsistently. "Drafting requirements" demands out-of-scope; the completeness paragraph and `requireDraftedContract` treat it as optional. `px repro set` appears only in the bug section. Nothing tells the agent to run each write in the foreground, or not to finish while `px` commands are still running.

## 2. Mission worktrees have no dependencies (was TASK-2562)

Mission worktrees are created without `node_modules`, so any gate that needs `tsx` fails in the worktree (`sh: 1: tsx: not found`). task-2553 hung after the active phase because of this. No configuration point exists to prepare a worktree. The existing command hooks are integrate-only (`adapters.integrate.preCommitCommand` and `postIntegrateCommand`, run via `src/adapters/process/post-integrate-hook.ts` and validated in `src/adapters/config/product-config.ts`). Add a pre-draft hook (for example `adapters.draft.preDraftCommand`). It runs in the new worktree after creation and before any agent or gate. A failure is reported as an environment failure and does not use the implementer repair budget. Parallix's own `workflow.config.json` sets it to install dependencies.

## 3. Handoff push gate runs the wrong area and loses its diagnostic (original TASK-2561)

Observed on task-2553, 2026-09-23: handoff verification ran `./scripts/verify-local.sh docs` and passed. Then `px rebase task-2553 --push` failed with `sh: 1: tsx: not found`, `Pre-review push gate failed for area "docs"`, and "Rebase failed before handoff". Both auto-send-back repair attempts ran plain `px rebase`, which passed, and used up the 2/2 budget.

- `performPush` in `src/application/rebase-workflow.ts` calls `port.createPr(branch, user, token, { rootDir, forceWithLease: true })` without `verificationArea`. `createPr` in `src/adapters/forgejo/forgejo-pr.ts` then falls back to `defaultArea` (`all`). Meanwhile `buildPushGateEvidence` in `src/adapters/review/rebase.ts` reports the mission area, so the evidence label does not match the command that ran.
- In `src/application/handoff-command-use-case.ts`, a non-conflict `rebaseResult` failure is reduced to a fixed "Rebase failed before handoff" string. The `rebaseResult.failure` gate evidence (kind, operation, command, exit code, output) never reaches `HandoffResult.gateFailure`, repair classification, or the repair prompt.

## 4. Integration-gate repair needs a human to finish (was TASK-2550)

Observed integrating task-2547: the integration gate `quality-gate` was repaired by the implementer and re-ran green (2/2 rebounds spent). Integrate then refused: "The integration-gate repair changed task-2547 from the approved revision da85fd50 to 43ae53df ... must go back through review: run px review task-2547 --start". A following `px integrate` failed with "Mission task-2547 has a stored approval without the required provider approval. Refresh provider review state before integration." The automatic rebound fixes the gate but cannot complete. It should send the repaired revision back through review automatically, without auto-approving it and without deleting review history. The follow-up integrate must then be able to proceed on the new approval. This is the minimal unblock only. The general staleness model and the operator commands stay in TASK-2555 and TASK-2543.

## 5. `px status` takes about 60 seconds (was TASK-2556)

`px status task-2561` takes 58.8s wall time but only about 3s of CPU. strace shows it runs about 20 `curl` calls to Forgejo (port 3300) one after another, 1-2.5s each, and it reports "no PR found" at the end anyway. The draft prompt requires a status read for every `--expected-version`, so this slowness directly caused the draft failure in section 1. Target from the original ticket: `px status <slug>` runs in under 200ms on a normal mission, found by profiling `npm run dev -- status <slug>`, without losing any reported fact.

## 6. The real-agent smoke masks each of these (defence restoration)

`test/e2e-real-agent-smoke.test.ts`:

- Since commit 4be263065 (TASK-2521.03), the test accepts `px draft` exiting non-zero with "mission contract is incomplete" (`contractRefused`) and re-runs `px draft` up to 3 times. The harness does the bounce-back the product lacks. Its `missingContract` check covers only goal, why, scope and gates, not criteria, checkpoint plan, NEL or repro.
- The harness replaces the drafted gates with `./scripts/verify-local.sh all` (`PINNED_GATE`).
- `scripts/verify-local.sh` is a stub that exits 0 for any area, and the fixture has no dependencies. A wrong area or a missing `node_modules` cannot fail it.
- `px integrate --no-integration-gates` with `PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS`: the integration-gate repair and re-review path never runs.

Forgejo stays out of the smoke (review provider `none`), so the push-gate area is covered by unit and integration tests, not the smoke. For everything else, the smoke has to fail when the product fails. Remove the draft retry and the `contractRefused` tolerance. Assert the full contract that `requireDraftedContract` demands. Make the fixture gate record the area it was invoked with and fail if dependencies are not provisioned, so the worktree hook and the area routing are exercised for real.

## Deliberately not included

TASK-2560 (MISSION.md scaffold removal): handoff still requires `missions/<slug>/MISSION.md`, and the scaffold satisfies that, so the scaffold does not block a mission. TASK-2555, TASK-2543 and TASK-2514 are approval-management features; section 4 is the minimal unblock. TASK-2553 (web cancel), TASK-2554 (test DB leak), TASK-2558 (integration speed) and TASK-2559 (cosmetic) do not stop a mission from landing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When refine is rejected with an incomplete-contract MissionRuleViolation, px draft sends the missing-parts list back to the drafting agent with a bounded retry budget and hard-fails only after the budget is spent; the failure message names the missing parts instead of the database-unreachable text
- [ ] #2 prompts/draft-core.md has one list that marks every contract field required, required for bug missions, or optional, consistent with requireDraftedContract, and tells the agent to run each px write in the foreground and never finish while px commands are still running
- [ ] #3 A validated pre-draft hook in workflow.config.json runs in the new mission worktree before any agent or gate; a failure stops the draft as an environment failure without using the repair budget; generated config includes the entry; Parallix's own config installs dependencies through it
- [ ] #4 performPush and the handoff Forgejo PR step pass the mission area as verificationArea to createPr, covered by a test where the mission area differs from defaultArea
- [ ] #5 A handoff push-gate failure returns gateFailure with the gate command, exit code and bounded output, and is routed through the gate-failure repair path instead of the generic rebase message
- [ ] #6 An integration-gate repair that changes the approved revision sends the mission back through review automatically, never auto-approves, keeps the superseded approval in history, and the following integrate can proceed on the new approval without a manual provider-state refresh
- [ ] #7 px status <slug> runs in under 200ms on a normal mission with every fact it reports today still reported, with the profile before and after recorded as evidence
- [ ] #8 test/e2e-real-agent-smoke.test.ts no longer re-runs px draft or tolerates a contract-refused draft, asserts the full required contract, and its fixture gate fails on a wrong area or unprovisioned worktree
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
