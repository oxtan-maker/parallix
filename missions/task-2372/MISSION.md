# Mission: Consolidate duplicate integrate command implementations (task-2372)

## Goal

Make `src/adapters/cli/commands/integrate.ts` the single canonical implementation of the integration orchestration and delete the diverging inactive copy `src/adapters/cli/commands/integrate-command.ts`, retargeting the four stale test references to the canonical module — with zero behavior change to the production CLI.

## Why Now

TASK-2369.04 was supposed to extract the command flow out of `integrate.ts` into a self-contained `integrate-command.ts`, but it left the full orchestration in both files: 1262 lines vs 1156 lines, with `integrate()`, `buildIntegrationContext()`, `parseIntegrateArgs()`, `evaluateTaskStatusForIntegration()`, `printMergedPrRecoveryGuidance()`, `promoteTaskForIntegrationIfNeeded()`, and `printIntegrationPreflight()` duplicated in both. TASK-2371 then had to apply the same review→integration lifecycle fix to both copies in one commit (9c62de844), and its checkpoint evidence cites the inactive copy as if it were production. The copies already diverge in observable ways (one-line `if` formatting, extra `IntegrateFn` members, disjoint export surfaces). Every future lifecycle, gate, or landing change must be applied twice; consolidation removes that class of error now, while the divergence is still small enough to delete mechanically.

## Refinement Signals

- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is — the size is deletion-driven (≈1156 lines removed from one file, ≈9 test-reference lines touched, no new logic), so there is no decomposable wave to split; ADR 0047 buckets are triage signals, not gates
- Main drivers: wholesale deletion of the 1156-line inactive module; retargeting 4 test references (2 source-reading paths, 2 dead `mockModule` registrations); zero production logic changes

## Scope

- Delete `src/adapters/cli/commands/integrate-command.ts` (not imported by any production `src/` file; `src/composition/create-cli.ts` and `src/adapters/rebase/rebase-workflow-adapter.ts` import `integrate.ts`).
- Retarget the two source-reading tests to read `src/adapters/cli/commands/integrate.ts` instead, keeping their assertions byte-identical:
  - `test/task-2203-publish-proof-refresh-order.test.ts` (path at line 88; test `Variant B: post-integrate hook runs before proof capture (task-2203 fix)` — verified during drafting that `runPostIntegrateHookOrAbort` first occurs before `captureVerifiedTreeProof` in `integrate.ts`).
  - `test/forgejo-independence.test.ts` (paths at lines 142 and 220; tests `integrate gates syncMerged behind isForgejoReviewEnabled` and `integrate printIntegrationPreflight gates Forgejo checks` — verified during drafting that `isForgejoReviewEnabled` appears in the `printIntegrationPreflight` section of `integrate.ts`).
- Remove the dead `mockModule` registration of `../src/adapters/cli/commands/integrate-command.js` from `test/task-2204-integrate-no-variant-a.test.ts` (line 9) and `test/task-2242-backlog-drift.test.ts` (line 13); neither test uses the facade, and `test/lib/module-mock.ts` documents "Only declare modules you actually patch."
- Keep `integrate.ts` untouched as the canonical module, including its default export, CJS-shape property attachments (consumed by `rebase-workflow-adapter.ts` via `(integrate as any).resolveConflictsForMission`), and its full named-export and re-export surface (`integrate-gates.js`, `integrate-conflict.js`, `integrate-post.js`).

## Out of Scope

- Any behavior, lifecycle, gate, landing, or formatting change in `integrate.ts` (deletion-only mission; `integrate.ts` must not appear in the final diff).
- The export names that only `integrate-command.ts` exposed (`printMergedPrRecoveryGuidance`, `REAL_AGENT_OPTION`, `REAL_AGENT_MODEL_OPTION`, `INTEGRATE_VALUE_OPTIONS`, `CODEX_REAL_AGENT_MODEL`) — verified during drafting that no file outside the two integrate modules references them; do not re-export them.
- Replacing the deletion with a thin delegating shim module (strictly worse: same NEL, extra file, and the source-reading tests still need retargeting).
- Further TASK-2369 structural extraction of `integrate.ts` into submodules.
- Changes to `IntegrateCommandUseCase` (`src/application/integrate-command-use-case.ts`), `src/interfaces/cli/integrate.ts`, or the `px integrate` flag contract.
- Renaming `integrate.ts` or moving the production import route.
- Authored documentation or ADR changes (internal refactor with unchanged behavior and invariants; run `./scripts/verify-local.sh docs` only if a doc edit becomes necessary, which it should not).
- Integration-time gates beyond the general suite (mutation gate, E2E workflow suite) — owned by the integrate phase via `config/integration-pipelines.json`.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/cli/commands/integrate-command.ts` is absent from the final tree, and case-sensitive `git grep "integrate-command" -- src test scripts workflow.config.json package.json` returns zero matches (frozen records under `missions/**` and `backlog/completed/**` are historical evidence and excluded from the sweep).
- SC2: The canonical export surface of `integrate.ts` survives intact: default export `integrate` with CJS property attachments (including `resolveConflictsForMission` and `runPostIntegrateHookOrAbort`), named exports `parseIntegrateArgs`, `buildIntegrationContext`, `evaluateTaskStatusForIntegration`, `promoteTaskForIntegrationIfNeeded`, `printIntegrationPreflight`, `VARIANT_B_AUTOMATION_SUMMARY`, `isIntendedPayloadAtHead`, `getPrimaryWorktree`, plus the re-export groups from `integrate-gates.js`, `integrate-conflict.js`, and `integrate-post.js`.
- SC3: Production wiring is byte-identical to the mission parent: `git diff --name-only <parent> -- src/composition/create-cli.ts src/interfaces/cli/integrate.ts src/application/integrate-command-use-case.ts src/adapters/rebase/rebase-workflow-adapter.ts` prints nothing.
- SC4: The four retargeted test files pass with unchanged assertion logic: `test/task-2203-publish-proof-refresh-order.test.ts` (test `Variant B: post-integrate hook runs before proof capture (task-2203 fix)`) and `test/forgejo-independence.test.ts` (tests `integrate gates syncMerged behind isForgejoReviewEnabled`, `integrate printIntegrationPreflight gates Forgejo checks`) read `integrate.ts`; `test/task-2204-integrate-no-variant-a.test.ts` and `test/task-2242-backlog-drift.test.ts` contain no `integrate-command.js` `mockModule` registration.
- SC5: Focused integration regressions pass, including review-origin approval and failed landing: `test/task-2369-regressions.test.ts` tests `R1: backlog promotion cannot complete the Mission when landing fails`, `R2: an approved normal integration completes exactly once and a retry stays at one`, `R3: a review-origin integration completes only after the commit has landed`, `R4: a resumed integration is stamped with the landed commit time, not the retry time`; plus the suites in `test/integrate.test.ts` and `test/forgejo-independence.test.ts`.
- SC6: `./scripts/verify-local.sh all` exits 0 on the final tree, and no `.only` or unannotated `.skip` is introduced in any changed test file.
- SC7: Zero behavior change: `git diff --name-only --diff-filter=M <parent> -- src/` prints nothing — the only `src/` change in the final diff is the deletion of `integrate-command.ts`.

## Risks and Assumptions

- Risk: an undiscovered runtime importer of `integrate-command.js` (dynamic `import(` or `require(`). Mitigation: CP 0 sweeps `src/`, `test/`, `scripts/`, and config files for `integrate-command` including dynamic-import syntax; if any production importer is found, Stop (see Stop Rules) rather than deleting blindly.
- Assumption: `integrate.ts` already contains the TASK-2371 lifecycle fix — the `approve` transition inside `promoteTaskForIntegrationIfNeeded` — because commit 9c62de844 applied the identical 38-line change to both files. CP 0 verifies this in-tree.
- Risk: the retargeted tests use string-based source-ordering assertions (`indexOf` on call text). Verified during drafting that both invariants hold in `integrate.ts` today; if a future mission reorders calls inside `integrate.ts`, those textual assertions will need updating — that is not this mission's concern.
- Assumption: the build does not enumerate `integrate-command.ts` explicitly — `npm run build` bundles from entry points and `tsconfig.json` includes the `src/**/*.ts` glob, so deleting the file removes it from compilation without config changes. Verified during drafting.
- Assumption: the Large NEL bucket (≈1165, deletion-dominated) does not imply high review risk here: no logic is added, and the surviving production path is byte-identical (SC3, SC7).

## Checkpoints

- CP 0: Record baseline. Run `git rev-parse HEAD` and `git status --short`; record the parent SHA. Sweep the repo for `integrate-command` references in `src/`, `test/`, `scripts/`, `workflow.config.json`, and `package.json` (including dynamic `import(`/`require(` forms), excluding `node_modules/`, `.test-runtime/`, `graphify-out/`, and frozen `missions/**` / `backlog/completed/**` records. Confirm (a) no production `src/` file imports `integrate-command.js`, (b) `integrate.ts` contains the TASK-2371 `approve` lifecycle transition inside `promoteTaskForIntegrationIfNeeded`, (c) no file outside the two integrate modules references `printMergedPrRecoveryGuidance`, `REAL_AGENT_OPTION`, `REAL_AGENT_MODEL_OPTION`, `INTEGRATE_VALUE_OPTIONS`, or `CODEX_REAL_AGENT_MODEL`. Enumerate both files' export surfaces for the Goal Check record.
- CP 1: Retarget the four test references BEFORE deleting anything: point the source-reading paths in `test/task-2203-publish-proof-refresh-order.test.ts` and `test/forgejo-independence.test.ts` at `integrate.ts` (assertions unchanged), and delete the `integrate-command.js` `mockModule` lines from `test/task-2204-integrate-no-variant-a.test.ts` and `test/task-2242-backlog-drift.test.ts`. Run those four test files; they must pass both before and after retargeting, proving the retarget preserves the invariants.
- CP 2: Delete `src/adapters/cli/commands/integrate-command.ts`. Rerun the four retargeted test files plus `test/task-2369-regressions.test.ts` and `test/integrate.test.ts`.
- CP 3: Final sweep and gate. Verify SC1 (zero live references via `git grep`), SC3 and SC7 (no modified `src/` files in the diff), run `git diff --check`, then `./scripts/verify-local.sh all`. Record the exact commands and outcomes in CP-3.md.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST lead its evidence with the durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repo commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged, because line numbers rot.

Every checkpoint document MUST include:

- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |` with at least one durable evidence row per applicable success criterion (SC1–SC7).
- Mission-specific durable evidence:
  - Deletion evidence: the parent SHA and `git diff --name-only --diff-filter=D` output paired with the path `src/adapters/cli/commands/integrate-command.ts`.
  - Reference-sweep evidence: the exact sweep command, e.g. `git grep -n "integrate-command" -- src test scripts`, with its empty result quoted.
  - Retarget evidence: the test file paths `test/task-2203-publish-proof-refresh-order.test.ts`, `test/forgejo-independence.test.ts`, `test/task-2204-integrate-no-variant-a.test.ts`, `test/task-2242-backlog-drift.test.ts`, plus the exact test names they run, e.g. `Variant B: post-integrate hook runs before proof capture (task-2203 fix)` and `integrate gates syncMerged behind isForgejoReviewEnabled`.
  - Lifecycle regression evidence: `test/task-2369-regressions.test.ts` with test names `R1: backlog promotion cannot complete the Mission when landing fails` and `R3: a review-origin integration completes only after the commit has landed`.
  - The verification command actually run: `./scripts/verify-local.sh all`.
- A non-generic `Next action:` line at the bottom.

Weak-agent failure mode to avoid: raw `stat`/`ls` output or generic prose alone is NOT sufficient evidence. Shell output may supplement, but it must be paired with one of the accepted references above (exact test name, test file path, ADR reference, or recognized command/path).

## Gates

- [ ] git diff --check
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify `src/adapters/cli/commands/integrate.ts` in any way (behavior, exports, or formatting) — SC7 makes any such change a gate failure.
- Do not modify `src/composition/create-cli.ts`, `src/interfaces/cli/integrate.ts`, `src/application/integrate-command-use-case.ts`, or `src/adapters/rebase/rebase-workflow-adapter.ts`.
- Do not change the assertion logic of the four retargeted test files — only the file paths they read and the dead `mockModule` registrations.
- Do not introduce a delegating shim or any new abstraction to replace the deletion.
- Do not edit authored documentation or ADRs; if a change is genuinely needed, stop and request direction instead.
- Do not modify the task assignee or backlog status; workflow ownership and state changes remain harness-managed.
- Do not push a mission branch to `origin`; only `main` may be pushed there.
- Do not introduce focused tests or bare skips, and do not call Forgejo, agents, mission runners, or the network from unit tests.

## Stop Rules

- Stop and request direction if CP 0 finds any production `src/` importer (static or dynamic) of `integrate-command.js` — re-scope to a thin delegating adapter instead of deletion.
- Stop and request direction if a retargeted source-ordering test fails against `integrate.ts` — do not weaken or rewrite the assertion to make it pass.
- Stop and report if `test/task-2369-regressions.test.ts` (R1–R4) or `test/integrate.test.ts` fails after the deletion — the deletion leaked a behavior change; revert and investigate.
- Stop and report if any `src/` file other than the deleted `integrate-command.ts` must be modified to keep the suite green.
- Stop and request direction if `./scripts/verify-local.sh all` fails for a cause unrelated to the deletion or the four test files.
