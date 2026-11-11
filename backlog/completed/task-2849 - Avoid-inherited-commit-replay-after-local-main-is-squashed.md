---
id: TASK-2849
title: Avoid inherited commit replay after local main is squashed
status: done
assignee: [codex]
created_date: '2026-11-11 07:27'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix unnecessary inherited-commit replay after local main is squashed. This is one bounded bug mission: improve the existing workflow and its prompt, and prove the exact-snapshot case with real Git. Do not turn it into a history-management platform or split off speculative infrastructure.

## Concrete incident and required result

On 2026-11-11, px-0055.01's rebase onto local main 2eba543eaa0ad9ce48a1e65dee336941b410fce2 selected 91 commits and stopped on old shared-file conflicts. Original mission tip: 607ca62a999978a7a7b0988945869f74a0c7aa7e. The inherited boundary 2b584b6db41d5f6d5dac680f25ee88dee0fd6411 and target main had the same Git tree, 9c54ddbb727fb804497682f8a8410e1001762a93. Replaying only boundary..original-tip with git rebase --onto <target> <boundary> <mission-branch> applied all 15 mission commits without conflicts. Final tip 1a0f0bca3ab94596cfb39faaecb6e493bc9fd110 had exactly the original tip's tree; range-diff marked all 15 patches unchanged. Treat these as historical evidence, not runtime constants or required fixture refs.

TASK-2812 deliberately rejected a broad squash-aware implementation and retained prompt-only guidance. This follow-up authorizes only the narrow exact-snapshot fast path described here. It does not authorize resurrecting that rejected machinery.

## Find the owners before editing

Query the active worktree graph when available, then verify against current source. Trace standalone px rebase, pre-review rebase and integration rebase into their actual shared owners. Start with startRebaseRound in src/application/rebase-continuation.ts, runRebaseWorkflow in src/application/rebase-workflow.ts, buildRebasePrompt in src/application/rebase-prompt.ts, RebaseWorkflowPort.git and the existing Git adapter. Confirm the production caller chain before deciding where code belongs; filenames here are investigation leads, not permission to create parallel owners.

Read the existing ownership, mutation admission, worktree selection, paused-operation recovery, freshness, branch/ancestry postconditions, observation and publication contracts. Briefly record which owner is extended and which existing callers exercise it in the implementation evidence. Reuse the existing Git runner, results, context, diagnostics, failure handling and recovery facilities. No second replay selector in a CLI, review or integration adapter. No shelling out from application policy around its typed port.

## Bounded behavior

Before starting a new rebase, inspect the relevant mission ancestry and the pinned local target snapshot. Only select a narrower replay boundary when full Git tree equality proves the candidate snapshot is already represented by that target, the ancestry/range is established, and the supported history shape is unambiguous. Replay the complete suffix after that boundary through the existing workflow. Keep the initial implementation limited to the exact-target-snapshot case seen here. A target that has advanced to a different tree is not proof, even if it once shared a snapshot.

Use a finite, output-bounded Git inspection through existing facilities; partial, truncated or failed reads establish no proof. Explicitly handle repeated matching snapshots and merge topology conservatively. Do not choose boundaries from titles, authors, timestamps, task IDs, commit counts or patch-id similarity. Do not squash mission commits into a net patch, silently discard suffix commits or rewrite the target. When proof is unavailable, retain the established rebase and semantic conflict-resolution behavior, explaining the uncertainty without introducing a new mandatory refusal gate.

Move unexpected inherited-replay diagnosis ahead of per-file repair in the existing agent prompt. Give the concrete inspect/prove-boundary/preserve-original-tip/rebase--onto/verify recipe without hardcoding incident refs. An agent must establish the range before dropping commits or restarting a paused rebase. Preserve the original tip through existing recovery facilities, stop competing ownership through existing mechanisms before any agent-initiated restart, and preserve all normal conflict pauses, hooks, current base behavior, target-advance handling, review effects and success postconditions. Reuse existing facilities; this is not permission to build a new ownership or backup subsystem.

## Mandatory anti-slop and duplication guardrails

- Zero new production files, packages, dependencies, database migrations, tables, columns, persisted fields, configuration keys, retained base refs, tracking services or ref-cleanup lifecycles. No edits to web/UI, integration landing, domain authority, architecture principles or architecture guards. No new public command, flag, port or parallel result/context type. Existing gitFn can supply the Git observations.
- Keep implementation in the existing rebase owners. Search for matching helpers and callers before adding even a local helper; explain why reuse does not fit if adding one. Do not copy a Git wrapper, ancestry inspector, replay planner, prompt builder, completion checker or fixture builder. Any superseded path must lose all production callers and be removed while distinct assertions survive. No legacy/new dual path beyond the existing fallback required for unsupported proof.
- No blanket ours/theirs, skip-all-conflicts rule, swallowed errors, success based only on agent exit status, or assertion weakening. No automatic task-metadata resurrection or changes to already completed tasks. Do not modify TASK-2812 to manufacture prior authorization.
- No generic history framework, persisted fork-point model, speculative historical-target matching, repository-wide refactor, unrelated cleanup or new internal documentation catalog. No arbitrary commit-count limit that drops work. Keep source under 500 lines and tests under 1,000; do not split files merely to evade caps. rebase-workflow.ts was already near the cap at investigation time: use the existing continuation owner rather than expanding the orchestrator.
- Do not add, restore, disable, bypass or weaken operator-owned verification gates, categories, budgets or guards. Do not add a production dependency or alter existing interfaces to make a test easy. If these bounds genuinely prevent the fix, present concrete evidence and a minimal scope alternative before dependent implementation.

## Verification owned by the behavior

Read ADR 0057 and inspect nearby assertions first. Extend existing owning suites: investigate test/integration/rebase/pre-review-launcher-configuration.test.ts for the real-Git workflow, test/integration/rebase/rebase.test.ts for rebase behavior/prompt assertions, and test/unit/application/rebase-agent-completion-contract.test.ts for completion/prompt coverage. Keep them cohesive; no task-ID filenames, dedicated new fixture framework or duplicate test inventory in guidance. Preserve the existing semantic repair/relocation/completed-task assertions.

Retain a small self-contained real-Git regression with several inherited commits aggregated into a rewritten/squashed target snapshot plus unique mission suffix commits. It must be red on parent behavior and green with the fix. Exercise the production workflow; a fake agent must not choose the correct boundary or repair the expected result for the automatic-path assertion. Assert the suffix is retained, obsolete inherited work is not replayed, no conflict resolver is launched in the proven case, target ref/tree is unchanged, the selected mission branch remains checked out and Git is clean with no active operation. Cover unsupported/different-target-tree or ambiguous evidence without dropping work, and real suffix conflicts through the established fallback. Extend existing freshness/recovery checks rather than duplicating them when their contract changes.

Run focused checks first. Every new/modified integration case and suite must remain at or below 3.5 seconds with finite CPU budgets; do not raise budgets or change tier membership. Unit checks must meet the 500 ms headroom requirement. Do not run full gates merely for this mission. Manually exercise the built CLI end to end against a disposable repository and PARALLIX_HOME with no real model traffic; retain actual results. Cleanup must own children and temporary state on success, failure and interruption. Never rewrite or migrate live main, running missions, real review refs or operator databases as a test. Update only live documentation whose public behavior actually changes; keep proof and ownership notes in mission/checkpoint evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The exact-target-snapshot squash regression fails on the parent and passes through the production workflow, replaying all unique suffix work without invoking a conflict agent or replaying obsolete inherited commits.
- [ ] #2 Boundary selection uses complete tree equality and established ancestry against a pinned local target; ambiguous, unsupported, truncated or failed evidence preserves the existing fallback and never silently drops work.
- [ ] #3 One existing rebase owner serves standalone, pre-review and integration callers; no duplicated planner, wrapper, type, state owner, new production file or forbidden persistence/infrastructure is introduced.
- [ ] #4 The resolver prompt diagnoses inherited replay before per-file repair and explains safe proven-boundary recovery; existing semantic conflict, relocation, completed-task, recovery, freshness and postcondition assertions remain intact.
- [ ] #5 Focused owning-suite checks and a disposable built-CLI manual exercise prove branch/suffix preservation, unchanged target and clean completed Git state; integration runtime stays within 3.5 seconds and operator gates/budgets remain untouched.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review the final diff against the anti-duplication and scope guardrails; identify the reused production owner and all affected entry paths in mission evidence.
- [ ] #2 Retain red-to-green reproduction evidence, focused check results and the disposable manual CLI observation; no fabricated proof, skipped assertions or live-state testing.
<!-- DOD:END -->
