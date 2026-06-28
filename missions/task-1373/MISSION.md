# Mission: Tools module JS→TS migration (task-1373)

## Goal

Convert all 6 JavaScript files in `lib/tools/` to TypeScript (`.ts`) while preserving every exported function, helper name, JSDoc annotation, and runtime behavior. After conversion, `tsc --noEmit` must be clean and all 6 existing test suites must still pass.

## Why Now

TASK-1366 (core foundation modules), TASK-1367, TASK-1368, and TASK-1372 (agents) are complete, removing all dependency blockers. The `lib/tools/` directory is the last remaining `lib/` sub-directory with unconverted `.js` files. Converting it now eliminates the final JS→TS technical debt across the entire `lib/` tree and enables strict type-checking of all runtime code through `tsc --noEmit`.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency chain cleared (core + agents converted); `forgejo.js` is the largest file at ~1794 lines and has extensive JSDoc that maps cleanly to TypeScript interfaces; all 6 files have dedicated test suites providing safety nets.

## Scope

- **`lib/tools/backlog.js`** (834 lines) → `lib/tools/backlog.ts`. Replace `require()` with ES `import` from converted modules (`../core/git`, `../core/fmt`, `../core/product-config`, `../agents/agents`). Add `@type` annotations where JSDoc is sparse. Preserve all 21 exported names.
- **`lib/tools/forgejo.js`** (~1794 lines) → `lib/tools/forgejo.ts`. Replace `require()` with ES `import` from converted modules. Leverage extensive `@param`/`@returns` JSDoc for type inference. Preserve export shape, helper names, and formatting. Do not rewrite logic.
- **`lib/tools/gatekeeper.js`** (124 lines) → `lib/tools/gatekeeper.ts`. Replace `require()` with ES `import`. Add type annotations for return shapes consumed by callers.
- **`lib/tools/redgreen.js`** (220 lines) → `lib/tools/redgreen.ts`. Replace `require()` with ES `import`. Type the `verifyRedGreenProof` return object and CLI argument parsing.
- **`lib/tools/sessions.js`** (81 lines) → `lib/tools/sessions.ts`. Replace `require()` with ES `import`. Add types for session payload objects.
- **`lib/tools/setup-review.js`** (1153 lines) → `lib/tools/setup-review.ts`. Replace `require()` with ES `import`. Type the wizard answer shapes, config builder return types, and API request/response objects.

## Out of Scope

- Converting any files outside `lib/tools/` (those belong to other missions).
- Modifying `tools/setup-forgejo-docker.sh` (shell script, left untouched).
- Adding new features or refactoring logic beyond the JS→TS conversion.
- Updating test files — all 6 existing test suites must pass without modification.
- Changing `tsconfig.json` compiler options (already configured with `allowJs: false`, `strict: true`, targeting `lib/**/*.ts`).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is independently verifiable.

- **SC-1:** `tsc --noEmit` produces zero errors on the final tree (verified by running `npx tsc --noEmit` at the mission's parent commit vs. final commit).
- **SC-2:** All 6 existing test suites pass unchanged: `test/backlog.test.js`, `test/forgejo.test.js`, `test/gatekeeper.test.js`, `test/redgreen.test.js`, `test/sessions.test.js`, `test/setup-review.test.js` (verified via `npm test` or `node --test test/{backlog,forgejo,gatekeeper,redgreen,sessions,setup-review}.test.js`).
- **SC-3:** `git diff -M --summary <parent-commit> -- lib/tools/` reports a rename (≥50% similarity) for each of the 6 files. `forgejo.js` converted in-place must show ≥50% rename similarity.
- **SC-4:** `grep -c 'module.exports' lib/tools/*.ts` returns zero for all 6 files — no CommonJS exports remain.
- **SC-5:** `grep -rn 'require(' lib/tools/*.ts` returns zero for all 6 files — no CommonJS requires remain (except in `require.main === module` guard in redgreen.js which becomes `import.meta.url` check).
- **SC-6:** Every exported name from the original JS files is present in the corresponding TS file: `backlog.ts` exports 21 names, `forgejo.ts` exports ~30+ names, `gatekeeper.ts` exports 4 names, `redgreen.ts` exports 4 names, `sessions.ts` exports 7 names, `setup-review.ts` exports 22 names.
- **SC-7:** `lib/tools/*.js` files no longer exist on disk (removed via `git rm --cached` after `npm run build:cjs` regenerates them as compiled output).
- **SC-8:** `./scripts/verify-local.sh static-analysis` passes green with compiled `lib/tools/*.js` present.

## Risks and Assumptions

- **Risk:** `forgejo.js` (~1794 lines) has deep inter-module dependencies with subtle side effects. Mitigation: convert file-by-file with `npm test` after each, leveraging the existing test suite as a safety net.
- **Risk:** `setup-review.js` uses `module.exports = setupReview` (default export pattern) with named exports appended (`module.exports.setupReview = ...`). Mitigation: convert to a `export default setupReview` plus `export { setupWizard, apiRequest, ... }` pattern.
- **Assumption:** All `require()` targets in the tools files are already converted to `.ts` (core modules, agents) — verified by TASK-1366 and TASK-1372 being complete.
- **Assumption:** `tsc --noEmit` with `allowJs: false` will compile `.ts` files but ignore remaining `.js` files — the `.eslintignore`/`.gitignore` strategy handles the compiled `.js` output.
- **Risk:** `redgreen.js` has a `require.main === module` CLI guard that needs conversion to `import.meta.url` check. This is a minor behavioral edge case.

## Checkpoints

- **CP 1:** `backlog.ts` converted — `tsc --noEmit` clean, `test/backlog.test.js` passes.
- **CP 2:** `gatekeeper.ts` converted — `tsc --noEmit` clean, `test/gatekeeper.test.js` passes.
- **CP 3:** `sessions.ts` converted — `tsc --noEmit` clean, `test/sessions.test.js` passes.
- **CP 4:** `redgreen.ts` converted — `tsc --noEmit` clean, `test/redgreen.test.js` passes.
- **CP 5:** `forgejo.ts` converted — `tsc --noEmit` clean, `test/forgejo.test.js` passes.
- **CP 6:** `setup-review.ts` converted — `tsc --noEmit` clean, `test/setup-review.test.js` passes.
- **CP 7:** All 6 files converted — `tsc --noEmit` globally clean, `npm test` passes, `.gitignore`/`.eslintignore` updated, rename proofs captured.

## Gates

- [ ] `tsc --noEmit` clean (zero errors)
- [ ] `npm test` passes (all existing tests)
- [ ] `./scripts/verify-local.sh static-analysis` green
- [ ] `git ls-files lib/tools/*.js` empty (all source JS converted)
- [ ] `grep -c 'module.exports' lib/tools/*.ts` returns 0 for each file
- [ ] Rename similarity ≥50% for all 6 files via `git diff -M --summary`

## Restricted Areas

- **Do not modify** any file outside `lib/tools/` except `.gitignore` and `.eslintignore` for the ignore-listing strategy.
- **Do not modify** `tsconfig.json` — it already has the correct settings (`allowJs: false`, `strict: true`, `include: ["lib/**/*.ts"]`).
- **Do not modify** any test files in `test/`.
- **Do not modify** `tools/setup-forgejo-docker.sh`.
- **Do not rewrite** any module's logic — this is a faithful rename-and-type annotation conversion only.
- **Do not** convert `forgejo.js` by splitting into multiple files — keep it as one file.

## Stop Rules

- Stop immediately if `tsc --noEmit` errors cannot be resolved within 30 minutes of effort on a single file — escalate the blocker.
- Stop if any existing test suite begins failing due to the conversion (not a pre-existing flake) — revert that file's conversion and investigate.
- Stop if `forgejo.js` conversion requires rewriting more than 10% of existing logic to achieve `tsc --noEmit` clean — the JSDoc should be sufficient, flag this as a risk.
- Stop the draft phase once MISSION.md is complete and `npm test` passes on the current tree — do not begin implementation.
