# CP-2 — migrate and preserve package-owned asset targets

## Summary of work done

Validated the committed phase-T2 migration. `packageRoot(__dirname)` is the sole
package-root anchor for all discovered package-owned lookups: prompts, templates,
config, data, and the bootstrap executable. The inventory recorded in CP-1 also
confirms there are no runtime package-owned `docs/` or `examples/` lookups to
migrate; the remaining relative and workspace-root paths are intentionally
outside this mission's scope.

The focused temporary-CWD suite passed 7/7. Its asset inventory asserts each
migrated target remains rooted at the same package-relative location in the
current source layout. The phase commit changes call sites and resolver code
only; it does not move asset contents or introduce the T3 `dist/` layout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A single `lib/core/` `packageRoot()` helper walks upward from a module `__dirname`, returns the nearest dir whose `package.json` names `@magnusekdahl/parallix`, and does not consult `process.cwd()` | `lib/core/package-root.ts:33-68`; test `packageRoot does not consult process.cwd()` in `test/task-2225-package-root.test.js` | Pass |
| All package-owned lookups for prompts/, templates/, config/, data/, docs/, examples/, and executable scripts use paths derived from `packageRoot()`; no migrated lookup retains a fixed count of `..` to reach the package root | `lib/review/review-prompts.ts:16-19`, `lib/commands/draft.ts:18-19`, `lib/commands/active.ts:18`, `lib/agents/agent-config.ts:18`, `lib/core/runtime-matrix.ts:6`, `lib/core/state-map.ts:7`, `lib/commands/mutation-gate.ts:27`, `lib/commands/stats.ts:123`, `lib/review/review-loop.ts:710`; documented `docs/`/`examples/` inventory in `missions/task-2225/CP-1.md:34-42` | Pass |
| A test changes the process CWD to a temporary dir outside the checkout and proves each migrated resolution path still finds its intended package asset | Test `every migrated asset resolves under the package root from a temp CWD` in `test/task-2225-package-root.test.js`; test `migrated call sites resolve their assets at module load from a temp CWD` in `test/task-2225-package-root.test.js` | Pass |
| Existing behavior in the current source layout is retained for every migrated command or script: its resolved asset remains the same package-owned asset as before the refactor | `test/task-2225-package-root.test.js:77-105`; test `every migrated asset resolves under the package root from a temp CWD` | Pass |
| `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully on the final mission tree | Required commands are declared in `missions/task-2225/MISSION.md:80-83`; final execution is CP-3's next checkpoint | Pending CP-3 |
| Phase remains revertible as one focused commit sequence: reverting its changes restores the prior asset-lookup expressions without requiring asset-content or distribution-layout changes | Focused phase commit `a51feeee`; `git diff --check` passed for the commit; changed paths are limited to `lib/core/package-root.ts`, migrated call sites, and `test/task-2225-package-root.test.js` | Pass |

Next action: run `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis`, then record their results in `missions/task-2225/CP-3.md`.
