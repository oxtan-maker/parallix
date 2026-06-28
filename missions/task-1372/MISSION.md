# Mission: Convert 12 agent launcher and telemetry modules from CJS to ESM/TypeScript (task-1372)

## Goal

Convert the 12 agent launcher and telemetry modules in `lib/agents/` from CommonJS (`require`/`module.exports`) to ES Module syntax (`import`/`export`) with TypeScript type annotations. Files are renamed `.js` → `.ts`. The conversion preserves runtime behavior, public APIs, and test pass rates. `stage-telemetry.js` has an internal dependency on `codex.js` — both convert within this mission. `agents.js` is the aggregator that imports most other agent files and converts last within this wave.

## Why Now

This is Wave 3 of the repository-wide CJS→ESM migration (following task-1365 infrastructure setup, task-1366 core foundation conversion). These 12 modules sit in `lib/agents/` — they are the agent launcher layer that every mission execution path imports through. Converting them removes the CJS barrier for the agent subsystem, allowing downstream consumers (commands, tools, telemetry pipelines) to import from `.ts` ESM sources without `require()` workarounds. The infrastructure and core foundation waves already established the tsconfig, test infrastructure, and verification gates needed for this conversion.

## Refinement Signals

- Estimated agent % usage limit: 50-75%
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency-wave heuristic (ADR 0036), tsconfig.json already configured with strict mode, all 12 files have good JSDoc coverage reducing type annotation effort

## Scope

### Files converted (12 modules in `lib/agents/`)

1. **`lib/agents/agents.js` → `lib/agents/agents.ts`** (~932 lines)
   - Agent aggregator. Imports: `claude`, `codex`, `limit-hit`, `mistral`, `opencode`, `core/fmt`, `core/persistent-data-migration`, `core/product-config`, `core/storage`, `tools/sessions`
   - Converts last within this wave due to widest import footprint
   - Test coverage: `test/agents.test.js`

2. **`lib/agents/claude.js` → `lib/agents/claude.ts`**
   - Imports: `claude-telemetry`, `core/spawn-tee`, `tools/sessions`
   - Test coverage: `test/claude.test.js`

3. **`lib/agents/codex.js` → `lib/agents/codex.ts`**
   - Imports: `codex-telemetry`, `core/spawn-tee`, `tools/sessions`
   - Test coverage: `test/codex.test.js`

4. **`lib/agents/mistral.js` → `lib/agents/mistral.ts`**
   - Imports: `core/spawn-tee`
   - Test coverage: `test/mistral.test.js`

5. **`lib/agents/opencode.js` → `lib/agents/opencode.ts`**
   - Imports: `core/spawn-tee`, `limit-hit`, `opencode-export`, `opencode-telemetry`, `tools/sessions`
   - Test coverage: `test/opencode.test.js`

6. **`lib/agents/limit-hit.js` → `lib/agents/limit-hit.ts`**
   - Limit detection logic
   - Test coverage: `test/limit-hit.test.js`

7. **`lib/agents/claude-telemetry.js` → `lib/agents/claude-telemetry.ts`**
   - Claude usage telemetry
   - Test coverage: `test/claude-telemetry.test.js`

8. **`lib/agents/codex-telemetry.js` → `lib/agents/codex-telemetry.ts`**
   - Codex usage telemetry
   - Test coverage: `test/codex-telemetry.test.js`

9. **`lib/agents/mistral-telemetry.js` → `lib/agents/mistral-telemetry.ts`**
   - Mistral usage telemetry
   - Test coverage: `test/mistral-telemetry.test.js`

10. **`lib/agents/opencode-export.js` → `lib/agents/opencode-export.ts`**
    - OpenCode export helper
    - Test coverage: `test/opencode-export.test.js`

11. **`lib/agents/opencode-telemetry.js` → `lib/agents/opencode-telemetry.ts`**
    - OpenCode usage telemetry
    - Test coverage: `test/opencode-telemetry.test.js`

12. **`lib/agents/stage-telemetry.js` → `lib/agents/stage-telemetry.ts`**
    - Stage-level telemetry. Internal dep: `codex`
    - Test coverage: `test/stage-telemetry.test.js`

### Conversion rules

- Rename `.js` → `.ts` for each converted module
- Replace `const x = require('node:...')` with `import x from 'node:...';` (Node.js builtins use `node:` protocol)
- Replace `const x = require('relative/path')` with `import x from './path.js';` (ESM requires explicit `.js` extension even for `.ts` sources)
- Replace `module.exports = { ... }` with named `export` statements
- Replace `module.exports.foo = bar` / `module.exports.FOO = FOO` with `export const foo = bar; export const FOO = FOO;`
- Preserve all JSDoc `@param`, `@returns`, `@type` annotations
- Add `@type` annotations where JSDoc is sparse
- Export TypeScript interfaces/types for any return shapes consumed by callers
- Delete the original `.js` file only after the `.ts` file compiles and tests pass
- Minimal lazy `require()` is allowed only to break a real circular dependency (e.g., the `agents` aggregator importing from other agent files)

### No-committed-`.js` guardrails

- Faithful rename per file: `git diff -M --summary <merge-base> -- lib/agents/X.js lib/agents/X.ts` reports a `rename` ≥ 50%. Convert in place; preserve names, helpers, formatting, comments, export shape.
- After converting each file: `git rm --cached lib/agents/X.js` (regenerated by `npm run build:cjs`; no `package.json` change needed).
- Add `lib/agents/*.js` to `.gitignore` and `.eslintignore`. Since this wave converts all 12 listed files, no `!lib/agents/<file>.js` negation in `.eslintignore` is needed — all 12 are being converted.
- Compile and ship all 12: `npm run prepublishOnly && npm pack --dry-run | grep 'lib/agents/'` shows compiled `.js` files for all 12 modules.

## Out of Scope

- Converting any files outside `lib/agents/` — core modules, commands, tools, and tests are handled in separate missions.
- Writing new tests — only existing tests are preserved and must pass.
- Modifying `index.js` (main entry point) or `px.js` (CLI entry point).
- Changing the public API of any agent launcher or telemetry module.
- Converting telemetry consumers in `lib/commands/` that import from agent modules — those convert in downstream missions.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic phrases are not sufficient.

- SC 1: All 12 `.js` source files in `lib/agents/` are converted to ES module syntax (`import`/`export` replacing all `require()`/`module.exports`). Verified by `grep -c 'module.exports' lib/agents/*.ts` returning zero for every file.

- SC 2: `npm test` passes with identical pass/fail counts to the pre-conversion baseline. No new failures introduced by the conversion.

- SC 3: `npm run typecheck` (`tsc --noEmit`) reports zero errors across the entire project.

- SC 4: All exported symbols from each of the 12 modules are still accessible to importing code. Verified by confirming that every file in `lib/` and `test/` that imports from the converted agent modules still loads without `ERR_REQUIRE_ESM` or `MODULE_NOT_FOUND` errors.

- SC 5: No behavioral regression in the 12 modules' public APIs. Specifically: `agents.launcherStatus()` returns identical structure, `claude.run()` produces identical spawn output, `limit-hit.detect()` returns identical boolean, all telemetry modules emit identical data shapes.

- SC 6: `git ls-files lib/agents/*.js` returns empty — no committed `.js` files remain in `lib/agents/`.

- SC 7: Each `.js`→`.ts` conversion is a faithful rename with at most 50% change relative to the original `.js` file. Verified by computing `git diff --shortstat <merge-base>..HEAD -- lib/agents/X.ts` for each of the 12 files and confirming additions+deletions combined are ≤ 50% of the original line count.

- SC 8: `./scripts/verify-local.sh static-analysis` passes green with compiled `lib/agents/*.js` present.

- SC 9: `npm run prepublishOnly && npm pack --dry-run | grep 'lib/agents/'` shows compiled `.js` files for all 12 modules in the published package.

- SC 10: `node -e "require('./lib/agents/agents')"` loads with exports intact (verifies the compiled CJS wrapper works correctly).

## Risks and Assumptions

- **Risk**: Circular dependencies between agent modules (e.g., `stage-telemetry.js` imports `codex`, `agents.js` imports all others). Mitigation: convert within this mission together; use minimal lazy `require()` only when a real circular dependency is confirmed by `tsc --noEmit` or runtime errors.

- **Assumption**: All 12 files have sufficient JSDoc annotations to guide type inference. The backlog task notes "good coverage in these files" — if JSDoc is sparse on specific modules, add inline `@type` annotations during conversion.

- **Risk**: `agents.js` is the aggregator importing most other agent files. Converting it before its dependencies could temporarily break imports. Mitigation: convert leaf modules first (`claude-telemetry`, `codex-telemetry`, `mistral-telemetry`, `opencode-telemetry`, `limit-hit`, `opencode-export`, `mistral`, `codex`, `claude`, `opencode`, `stage-telemetry`), then `agents.js` last.

- **Assumption**: Existing tests do not rely on CJS-specific behavior (e.g., `require.cache` manipulation). Tests that import from `lib/agents/` must use ESM-compatible import paths pointing to the `.ts` sources (via `tsx` or compiled `.js` output).

- **Risk**: `stage-telemetry.js` has an internal dependency on `codex.js` — both convert in this mission, so the interdependency resolves cleanly.

- **Assumption**: The `.gitignore` and `.eslintignore` changes are additive and do not affect other parts of the project. Since all 12 `lib/agents/*.js` files are converted in this wave, no `.eslintignore` negation entries are needed.

## Checkpoints

- CP 1: Leaf telemetry modules converted — `claude-telemetry.ts`, `codex-telemetry.ts`, `mistral-telemetry.ts`, `opencode-telemetry.ts`, `limit-hit.ts`, `opencode-export.ts` switched to ESM syntax, individual tests pass.

- CP 2: Launcher modules converted — `claude.ts`, `codex.ts`, `mistral.ts`, `opencode.ts`, `stage-telemetry.ts` switched to ESM syntax. `stage-telemetry.ts` resolves its internal dep on `codex.ts` within this wave.

- CP 3: Aggregator `agents.ts` converted last, resolving all internal imports from the 11 other converted modules. Full `npm test` suite passes. `tsc --noEmit` clean.

## Gates

> Each bullet is executed verbatim as `bash -c <line>` by the handoff gate runner
> (ADR: gates must be runnable commands, not prose). Exit 0 = pass.

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test
- [ ] npm run typecheck
- [ ] test -z "$(git ls-files lib/agents/*.js)"
- [ ] ! grep -rl 'module.exports' lib/agents/*.ts
- [ ] npm run prepublishOnly && npm pack --dry-run 2>&1 | grep -q 'lib/agents/'
- [ ] node -e "require('./lib/agents/agents')"

## Restricted Areas

- Do not modify any files outside `lib/agents/` except `.gitignore` and `.eslintignore` for the `lib/agents/*.js` exclusion pattern.
- Do not modify `package.json` — the `"type": "module"` and build configuration are already set by prior waves.
- Do not modify `tsconfig.json` — its current settings are the target configuration.
- Do not write new test files — only preserve and pass existing tests.
- Do not modify the public API shape of any agent launcher or telemetry module.

## Stop Rules

- Stop if `npm test` introduces any new failures after conversion of a single module — investigate and fix before proceeding to the next module.
- Stop if `tsc --noEmit` reports more than 5 new errors attributable to the conversion — escalate for manual review.
- Stop if converting `agents.ts` requires changes to files outside `lib/agents/` — this indicates scope creep beyond the 12-module set.
- Stop if the circular dependency between agent modules cannot be resolved with lazy `require()` — escalate with the dependency graph for architectural decision.
- Stop if any exported symbol from the 12 modules becomes inaccessible to importing code (import path or name mismatch) — fix before continuing.
