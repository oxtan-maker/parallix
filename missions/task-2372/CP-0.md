# CP-0: Baseline and reference sweep

## Summary

Recorded the mission parent SHA, swept the repo for every live reference to
`src/adapters/cli/commands/integrate-command.ts`, confirmed the TASK-2371
lifecycle fix is present in the canonical module, and enumerated both export
surfaces before any edit.

- Parent SHA: `c51cc7d70f000b1d18342a44eee4d437ef64f390` (`git rev-parse HEAD`).
- `git status --short` at baseline: only ` M package-lock.json` (pre-existing,
  not mission-owned; no `src/` or `test/` modifications).
- Sweep command: `git grep -n "integrate-command" -- src test scripts workflow.config.json package.json`.
  Live hits on the duplicate module (5 total, all under `test/`):
  - `test/forgejo-independence.test.ts` — two `fs.readFileSync(... 'integrate-command.ts')`
    source reads plus one assertion message string.
  - `test/task-2203-publish-proof-refresh-order.test.ts` — one `path.join(... 'integrate-command.ts')`.
  - `test/task-2204-integrate-no-variant-a.test.ts`, `test/task-2242-backlog-drift.test.ts` —
    one dead `mockModule<typeof import('../src/adapters/cli/commands/integrate-command.js')>` each.
- **Sweep-pattern note (SC1 refinement):** the bare string `integrate-command` also
  matches the unrelated, explicitly out-of-scope module
  `src/application/integrate-command-use-case.ts` (imported by
  `src/composition/create-cli.ts`, `src/interfaces/cli/integrate.ts`,
  `test/cli-command-use-cases.test.ts`, `test/current-work-publication.test.ts`).
  SC1 is therefore verified with the module-precise pattern
  `git grep -nE "integrate-command\.(ts|js)" -- src test scripts workflow.config.json package.json`,
  which must return zero matches; the use-case hits are expected to remain.
- (a) No production importer: `git grep -nE "(import|require)\([^)]*integrate-command" -- src test scripts`
  returns only the two `test/` `mockModule` lines — zero `src/` importers, static or
  dynamic. Stop rule 1 does not fire.
- (b) TASK-2371 lifecycle fix present in canonical module: `promoteTaskForIntegrationIfNeeded`
  in `src/adapters/cli/commands/integrate.ts` calls `recoverMissionForIntegration`,
  which issues the `{ type: 'approve' }` lifecycle transition with
  `operationId: \`integrate-approve:${context.slug}\``. Commit `9c62de844` applied the
  fix to `integrate.ts`; the in-tree shape has since moved the transition body into
  `recoverMissionForIntegration` (reached only from `promoteTaskForIntegrationIfNeeded`),
  so the canonical path is at least as current as the copy.
- (c) Facade-only exports referenced nowhere else:
  `git grep -nE "printMergedPrRecoveryGuidance|REAL_AGENT_OPTION|REAL_AGENT_MODEL_OPTION|INTEGRATE_VALUE_OPTIONS|CODEX_REAL_AGENT_MODEL" -- src test scripts`
  hits only `src/adapters/cli/commands/integrate.ts` and
  `src/adapters/cli/commands/integrate-command.ts`. Nothing outside the two modules
  consumes them, so the deletion needs no re-export (mission Out of Scope).

### Export surfaces enumerated

- `src/adapters/cli/commands/integrate.ts` (1324 lines): `export default integrate`
  plus named exports `integrate, detectChangedAreas, parseFilesToAreas,
  loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan,
  buildIntegrationGateEnv, captureFinalIntegrationTree, parseIntegrateArgs,
  resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation,
  executeIntegrationGates, orderIntegrationGates, gateMatchesChangedAreas,
  buildIntegrationContext, getPrimaryWorktree, VARIANT_B_AUTOMATION_SUMMARY,
  evaluateTaskStatusForIntegration, promoteTaskForIntegrationIfNeeded,
  recoverMissionForIntegration, printIntegrationPreflight, isIntendedPayloadAtHead`,
  the `IntegrateFn` interface, and re-export groups from `./integrate-gates.js`,
  `./integrate-conflict.js`, `./integrate-post.js`.
- `src/adapters/cli/commands/integrate-command.ts` (1156 lines): single export line
  `integrate, parseIntegrateArgs, buildIntegrationContext,
  evaluateTaskStatusForIntegration, printMergedPrRecoveryGuidance,
  promoteTaskForIntegrationIfNeeded, printIntegrationPreflight,
  VARIANT_B_AUTOMATION_SUMMARY, REAL_AGENT_OPTION, REAL_AGENT_MODEL_OPTION,
  INTEGRATE_VALUE_OPTIONS, CODEX_REAL_AGENT_MODEL` — no default export, no
  re-export groups.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (baseline reference inventory) | `git grep -n "integrate-command" -- src test scripts workflow.config.json package.json` lists 5 duplicate-module hits, all in `test/`: `test/forgejo-independence.test.ts`, `test/task-2203-publish-proof-refresh-order.test.ts`, `test/task-2204-integrate-no-variant-a.test.ts`, `test/task-2242-backlog-drift.test.ts` | Baseline recorded |
| SC2 (canonical export surface enumerated) | `grep -n "^export" src/adapters/cli/commands/integrate.ts` — default export `integrate` plus the named/re-export list above, incl. `resolveConflictsForMission` via the `./integrate-conflict.js` group | Recorded |
| SC3 / SC7 (parent baseline for the zero-behavior-change diff) | Parent SHA `c51cc7d70f000b1d18342a44eee4d437ef64f390` from `git rev-parse HEAD`; `git status --short` shows no `src/` or `test/` modifications at baseline | Recorded |
| Stop rule 1 (no production importer) | `git grep -nE "(import|require)\([^)]*integrate-command" -- src test scripts` returns only the two `mockModule` lines in `test/task-2204-integrate-no-variant-a.test.ts` and `test/task-2242-backlog-drift.test.ts` | Not triggered |
| Assumption (b): TASK-2371 fix in canonical module | `promoteTaskForIntegrationIfNeeded` → `recoverMissionForIntegration` in `src/adapters/cli/commands/integrate.ts` performs the `command: { type: 'approve' … }` transition (`operationId: integrate-approve:<slug>`); commit `9c62de844` is the origin | Confirmed |
| Out of Scope: facade-only exports unused | `git grep -nE "printMergedPrRecoveryGuidance\|REAL_AGENT_OPTION\|REAL_AGENT_MODEL_OPTION\|INTEGRATE_VALUE_OPTIONS\|CODEX_REAL_AGENT_MODEL" -- src test scripts` hits only the two integrate modules | Confirmed |

Next action: CP 1 — retarget the source-reading paths in `test/task-2203-publish-proof-refresh-order.test.ts` and `test/forgejo-independence.test.ts` to `integrate.ts` and drop the dead `integrate-command.js` `mockModule` lines from `test/task-2204-integrate-no-variant-a.test.ts` and `test/task-2242-backlog-drift.test.ts`, running those four files before and after the retarget.
