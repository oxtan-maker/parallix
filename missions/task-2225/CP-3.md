# CP-3 — final verification and scope confirmation

## Summary of work done

Ran every mission-declared gate on the final phase-T2 tree. The focused
temporary-CWD coverage continues to exercise the module-anchored resolver and
the migrated prompt, template, config, data, and executable-script paths. The
committed migration remains limited to resolver and call-site changes; it does
not alter package asset contents or introduce the phase-T3 `dist/` layout.

Review round 1 expanded the temporary-CWD test to invoke every migrated call
site, including the provider-unavailable bootstrap branch, and removed
unrelated dry-run prompt and verifier-environment changes from this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A single `lib/core/` `packageRoot()` helper walks upward from a module `__dirname`, returns the nearest dir whose `package.json` names `@magnusekdahl/parallix`, and does not consult `process.cwd()` | `lib/core/package-root.ts:33`; test `packageRoot does not consult process.cwd()` in `test/task-2225-package-root.test.js` | Pass |
| All package-owned lookups for prompts/, templates/, config/, data/, docs/, examples/, and executable scripts use paths derived from `packageRoot()`; no migrated lookup retains a fixed count of `..` to reach the package root | `lib/review/review-prompts.ts:16`, `lib/commands/draft.ts:18`, `lib/commands/active.ts:18`, `lib/agents/agent-config.ts:18`, `lib/core/runtime-matrix.ts:6`, `lib/core/state-map.ts:7`, `lib/commands/mutation-gate.ts:27`, `lib/commands/stats.ts:123`, `lib/review/review-loop.ts:710`; documented `docs/`/`examples/` inventory in `missions/task-2225/CP-1.md:34` | Pass |
| A test changes the process CWD to a temporary dir outside the checkout and proves each migrated resolution path still finds its intended package asset | Test `every migrated asset resolves under the package root from a temp CWD` and test `every migrated call site resolves its package asset from a temp CWD` in `test/task-2225-package-root.test.js:117`; the latter invokes `review-prompts`, `draft`, `active`, `state-map`, `agent-config`, `runtime-matrix`, `mutation-gate`, `stats`, and the `review-loop` bootstrap branch | Pass |
| Existing behavior in the current source layout is retained for every migrated command or script: its resolved asset remains the same package-owned asset as before the refactor | `test/task-2225-package-root.test.js:77`; test `every migrated asset resolves under the package root from a temp CWD` | Pass |
| `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully on the final mission tree | `npm test`; `node test/e2e-mission-lifecycle.test.js`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` — executed successfully during CP-3 | Pass |
| Phase remains revertible as one focused commit sequence: reverting its changes restores the prior asset-lookup expressions without requiring asset-content or distribution-layout changes | `lib/core/package-root.ts:33`; `test/task-2225-package-root.test.js`; focused phase commit `0973d81a` | Pass |

Next action: run the reviewer handoff for task-2225.
