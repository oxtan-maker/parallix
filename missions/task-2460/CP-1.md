# CP-1: Config drift investigation and gap inventory

## Summary

Read `docs/config.md` against the effective runtime (`validateWorkflowConfig`,
`loadEffectiveConfig`, `resolveTaskProvider`, `resolveTaskStorage`,
`resolveReviewArtifactDir`, `resolveMissionAdapter`, `loadPhaseGates`) and against
`config/workflow.config.schema.json`. Produced the inventory below. No file was
edited in this checkpoint.

### Inventory: "Known configuration gaps" entries vs current runtime effect

| Doc claim (current text) | Current runtime effect | Verdict |
|---|---|---|
| `adapters.tasks.provider` listed as having no end-to-end runtime effect (TASK-2455.02) | `resolveTaskProvider` throws `adapters.tasks.provider must be one of: backlog-md` for any other value, and `resolveTaskStorage` calls it before resolving any directory; `validateWorkflowConfig` reports the same issue. TASK-2455.02 is `status: done` in `backlog/completed/`. | **Stale — close.** The doc's own "Tasks" section already describes the enforced behavior, so the gap entry contradicts the same file. |
| "`px config` currently does not validate individual schema field types, enums, or unknown properties (except `adapters.tasks.provider` and `agents.maxConcurrentCustom`)" (TASK-2455.03) | `validateAdapterSections` enforces string types for `tasks.provider/stateMap`, `missions.baseDir/branchPrefix/worktreePattern/primaryBranch`, `verification.command/defaultArea`, `integrate.postIntegrateCommand`, `review.baseUrl/remote/repo`; enum for `review.provider` (`forgejo`/`none`/`null`); `tasks.storage` string-or-string-valued-object; `agents.models.*` strings; `agents.runners` and `agents.subagents` as closed objects with enum/range checks; plus `validateRepositoryGates` for `adapters.gates`. TASK-2455.03 is `status: done`. | **Stale — close.** Also makes the doc header line "Field-level schema enforcement is not complete yet" false. |
| "Malformed JSON also currently reports a failure while the real CLI process exits zero" (TASK-2455.04) | The `config` command calls `exitFn(1)` on both the parse-error branch and the structural-invalid branch; the default `exitFn` sets `process.exitCode = 1`. TASK-2455.04 is `status: done`. | **Stale — close.** Also makes the intro clause "the real CLI currently exits zero for those failures" false. |
| All three gap links target `../backlog/tasks/task-2455.0X - ....md` | Those files now live under `backlog/completed/`, so every link in the section is broken. | **Broken link — removed with the closed gaps.** |

### Inventory: documented fields vs effective constraints

| Section | Documented | Effective constraint | Verdict |
|---|---|---|---|
| `adapters.tasks` | `provider` enum `backlog-md`; `storage` string or object with `tasksDir`/`completedDir`; `stateMap` string default `state-map.json` | matches; object form additionally honours `archiveTasksDir` | **Add** `archiveTasksDir` to the storage object description |
| `adapters.missions` | `baseDir`/`branchPrefix`/`worktreePattern`/`primaryBranch` strings, listed defaults, trailing-slash normalisation, `<repo>`/`<slug>` tokens | matches `missionAdapterDefaults` and `normalizeBranchPrefix` | accurate |
| `adapters.verification` | `command` optional string with `{{area}}`; `defaultArea` optional string default `docs` | matches | accurate |
| `adapters.review` | `provider` `forgejo`/`none`/`null`; `baseUrl`/`remote`/`repo` optional strings | matches; `tmpDir` is additionally effective (review artifact directory, defaulting to the OS temp directory) and is schema-valid because the review section sets `additionalProperties: true` | **Add** `tmpDir` |
| `adapters.agents` | `maxConcurrentCustom` positive integer; `models` string map; `runners.custom` `opencode`/`pi`; `subagents.maxParallel` integer or `null`, zero = no limit | matches | accurate; **add** that `runners` and `subagents` reject unknown keys |
| `adapters.integrate` | `postIntegrateCommand` optional string plus four `INTEGRATE_HOOK_*` env values | matches | accurate |
| `adapters.gates` | phases, gate object shape, env contract, `requirePreIntegration` default `false` | matches | accurate; **add** that the section and each gate object are closed shapes |
| intro | "Invalid ... report a failure and print fallback defaults; the real CLI currently exits zero" | invalid config: failure reported, built-in defaults printed, exit status 1, and `loadEffectiveConfig` discards the file's overrides entirely | **Rewrite** |

No new gap with a confirmed end-to-end runtime effect was found, so the
"Known configuration gaps" section becomes empty and is removed rather than
restated with fabricated entries (mission Scope: "do not fabricate new gap links").

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every stale gap entry mapped to its current runtime effect | `src/adapters/config/product-config.ts` (`validateWorkflowConfig`, `validateAdapterSections`, `resolveTaskProvider`), `src/adapters/cli/commands/config.ts` (`exitFn(1)` branches) | PASS |
| Closed-gap claim corroborated by backlog state, not by title alone | `backlog/completed/task-2455.02 - make-task-provider-config-effective.md`, `backlog/completed/task-2455.03 - enforce-workflow-config-schema-validation.md`, `backlog/completed/task-2455.04 - preserve-config-command-failure-exit-status.md` all carry `status: done` | PASS |
| Documented adapter fields cross-checked against the schema contract | `config/workflow.config.schema.json`, `src/adapters/config/repository-gates.ts` (`validateRepositoryGates`, `loadPhaseGates`, `loadRequirePreIntegration`) | PASS |
| Gap-section links confirmed broken | `rg -n 'backlog/tasks/task-2455' docs/config.md` matches three links whose targets exist only under `backlog/completed/` | PASS |
| No file outside the mission scaffold modified in CP-1 | `git status --porcelain docs/ src/ config/` reports no change from CP-1 | PASS |
| Behavioural check available for the doc claims | `test/product-config.test.ts`, `test/config-command.test.ts` | PASS |

Next action: rewrite `docs/config.md` per the inventory — replace the intro's
"exits zero"/"enforcement is not complete" claims with the enforced behavior,
delete the "Known configuration gaps" section (all three entries closed, all
three links broken), and add `adapters.tasks.storage.archiveTasksDir`,
`adapters.review.tmpDir`, and the closed-shape notes for `adapters.gates`,
`adapters.agents.runners`, and `adapters.agents.subagents`.
