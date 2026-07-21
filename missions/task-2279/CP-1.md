# CP-1: Architecture inventory and migration boundary

TASK-2278 is complete and orders TASK-2289 → TASK-2290 → TASK-2279; TASK-2290 is complete with the approved UI-neutral composition seam. The current authored runtime is CommonJS-oriented TypeScript at the repository root and under `lib/`: `index.ts` is the legacy command dispatcher, `px.ts` is the auxiliary executable, `lib/commands/` is the CLI interface layer, `lib/application/` and `lib/adapters/` contain the two landed ADR 0051 proof slices, `lib/composition/application-services.ts` is their sole concrete composition point, and `lib/core/`, `lib/agents/`, `lib/review/`, and `lib/tools/` provide platform/adapters that must move in dependency order.

The target mapping is `src/entry/px.ts` for the canonical ESM bundle entry and composition root; `src/interfaces/cli/` for dispatch and command rendering; `src/application/{services,ports}/` for the landed application contracts; `src/adapters/` for legacy integrations and external effects; and `src/platform/{assets,paths,runtime}/` for package location, assets, and runtime helpers. Existing mixed `lib/` areas will be placed under these boundaries based on their imports rather than mechanically renamed. `src/domain/` remains empty until a module contains policy independent of application/use-case and infrastructure dependencies, as ADR 0051 requires.

The CommonJS `dist/` tree remains the executable rollback shim. Its owner is the npm package migration compatibility gate; removal is prohibited until that gate has passed and the package owner authorizes removal. This phase remains reversible by restoring the current `package.json` CommonJS entrypoints and `tsc` build configuration, leaving persisted task and mission data unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Prerequisite UI-neutral seams and ordering were confirmed before behavior moves | `backlog/completed/task-2278 - Establish-UI-neutral-application-architecture-and-ADR-0051.md:52`, `backlog/completed/task-2278 - Establish-UI-neutral-application-architecture-and-ADR-0051.md:54`, `backlog/completed/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:42` | PASS |
| Source inventory and ADR 0044 target-boundary mapping are recorded | `index.ts:8`, `px.ts:3`, `lib/composition/application-services.ts:1`, ADR 0044 | PASS |
| Entry/composition plan preserves headless UI neutrality | `docs/adr/0044-workflow-distribution-model.md:153`, `docs/adr/0044-workflow-distribution-model.md:262`, `docs/adr/0051-ui-neutral-application-boundary.md:293` | PASS |
| Existing CommonJS shim and exact deletion gate are recorded before migration | `docs/adr/0044-workflow-distribution-model.md:79`, `package.json:7`, `package.json:53` | PASS |
| Current typecheck/emission configuration is identified for CP-2 conversion | `tsconfig.json:5`, `tsconfig.json:16`, `package.json:53` | PASS |

Next action: create the `src/` boundary tree, migrate the initial entry/platform/application modules with explicit `.js` specifiers, and convert TypeScript to no-emit checking.
