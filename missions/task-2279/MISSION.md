# Mission: Move runtime to ESM src tree and canonical bundle (task-2279)

## Goal
Move the authored runtime and build-tool source into the ADR 0044 ESM TypeScript `src/` architecture, make `tsc --noEmit` the authoritative typecheck, and ship `build/px.mjs` as the deterministic canonical runtime bundle while retaining the current CommonJS `dist/` runtime as an explicit, removable rollback shim.

## Why Now
TASK-2278 and TASK-2290 establish prerequisites for this migration. The current mixed runtime/build layout prevents the ADR 0044 distribution model from having one authoritative ESM artifact, and the UI-neutral boundaries required by ADR 0051 must be consumed before the bundle entry can safely serve headless commands without initializing Ink.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: Requires the documented dependency seams from TASK-2278 and TASK-2290; activate once they are available on the mission base.
- Main drivers: ESM TypeScript source-tree migration, canonical bundling and manifests, deterministic clean builds, UI-neutral headless CLI loading, asset resolution, source-map validation, and an explicit CommonJS rollback path.

## Scope
- Establish the ADR 0044 `src/` domain, application, adapters, interfaces, platform, and entry boundaries for authored runtime and build-tool modules, using `.ts` and `.tsx` files and explicit `.js` source specifiers where ESM requires them.
- Change the TypeScript/build configuration so `tsc --noEmit` typechecks runtime source and the bundler is the only production JavaScript emitter.
- Produce the declared canonical artifacts under `build/`: `px.mjs`, its source map, asset manifest, and a sorted SHA-256 manifest.
- Add clean-build and repeated-build determinism coverage for the canonical manifest.
- Preserve headless CLI behavior, JSON output, and exit codes without statically importing or initializing Ink from the bundle entry.
- Route runtime asset access through `AssetStore`, validate source-map TypeScript locations in representative errors, and document the CommonJS `dist/` shim's owner and deletion gate.
- Keep generated output ignored and confined to owned output directories while retaining a phase reversal that restores the existing `dist/` package behavior.

## Out of Scope
- Removing the CommonJS `dist/` rollback shim before npm package migration has passed its compatibility gate.
- Changing user-facing command semantics, JSON schemas, or documented exit-code contracts beyond changes required to preserve them through the new entry path.
- Introducing a new Ink UI, changing UI presentation, or allowing headless commands to initialize Ink.
- Publishing packages, changing release versions, or deleting historical runtime artifacts outside the owned migration output and shim lifecycle.
- Unrelated TypeScript modernization, dependency upgrades, or broad architecture changes not required by ADR 0044 or the ADR 0051 seams.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The authored runtime and build-tool source is located under `src/` at the ADR 0044 domain/application/adapters/interfaces/platform/entry boundaries, with runtime implementation files using `.ts` or `.tsx` and ESM imports using explicit `.js` specifiers where applicable.
- `tsc --noEmit` completes successfully for runtime source, and no TypeScript configuration emits production JavaScript; the configured bundler is the sole producer of runtime JavaScript.
- From a clean tree, the build creates exactly `build/px.mjs`, its source map, an asset manifest, and a sorted SHA-256 manifest; no additional declared runtime artifact is required to execute the canonical bundle.
- Two clean builds from the identical tree produce byte-identical canonical bundle manifests.
- Compatibility tests cover existing headless commands and verify their JSON output and exit codes while proving the canonical bundle entry does not statically import or initialize Ink.
- Runtime assets are resolved through `AssetStore`; the canonical bundle contains no first-party runtime filesystem-module lookup and requires no runtime `node_modules` dependency.
- Representative runtime errors mapped through the canonical bundle source map identify a TypeScript source file and line.
- The CommonJS `dist/` rollback shim remains executable until the npm package migration compatibility gate passes, and repository documentation records its owner plus the exact deletion gate.
- Full repository verification and static analysis pass with no tracked generated JavaScript; generated output is ignored and confined to its owned output directories.
- Reverting this migration restores the current `dist/` runtime and package behavior without requiring a published-package rollback.

## Risks and Assumptions
- TASK-2278 and TASK-2290 may not expose the expected base changes or UI-neutral seams; inspect their landed interfaces before moving dependent modules.
- ESM conversion can alter module resolution, executable entry behavior, asset paths, and error stacks; preserve compatibility tests for CLI output, exit codes, assets, and source maps while migrating in dependency order.
- Deterministic bundle output can be affected by timestamps, absolute paths, dependency ordering, and manifest sorting; clean-build repetition must run from the same commit and compare the canonical manifest.
- The `dist/` shim can accidentally become a second primary runtime; its ownership, package compatibility gate, and deletion condition must be explicit.
- Assumption: ADR 0044 defines the accepted ESM tree and artifact model, and ADR 0051 provides UI-neutral composition seams sufficient for headless loading.
- Node v22.23.1 is the accepted L3 development and npm-bundle baseline. The Node 25/26-or-newer requirement in ADR 0044 applies only to the later ESM SEA binary work in TASK-2286. A failed canonical-bundle smoke on Node 22 caused by first-party `createRequire` paths is a migration defect to fix in this mission, not a reason to defer CP-3/CP-4 or substitute a CommonJS bundle.

## Checkpoints
- CP 1: Inspect TASK-2278/TASK-2290 outcomes and ADR 0044/0051 constraints; record the source-module inventory, target `src/` boundary mapping, entry/composition-root plan, and the `dist/` shim owner/deletion gate before moving behavior.
- CP 2: Migrate runtime and build-tool modules in dependency order into the ESM TypeScript tree; configure typecheck-only TypeScript, preserve explicit ESM specifiers, and add source-level hermetic tests for migrated behavior.
- CP 3: Implement the canonical bundle, asset manifest, sorted SHA-256 manifest, source maps, and clean/repeated-build determinism tests; confirm only the declared `build/` artifacts are emitted.
- CP 4: Validate package and CLI compatibility: execute headless command, JSON, exit-code, AssetStore, no-Ink-load, source-map, rollback, full-test, and static-analysis checks; finalize the evidence needed to retire the shim only after the npm migration gate passes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not accepted evidence; it may appear as supplemental context only when paired with one of the accepted file:line references, exact test names, ADR references, test file paths, or recognized repository commands/paths above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- `dist/` is a rollback shim, not a second migration target: do not delete it until the npm package migration compatibility gate has passed and its documented owner authorizes removal.
- Preserve package names, command names, JSON output contracts, and exit codes exercised by existing CLI compatibility tests.
- Do not statically import or initialize Ink from the canonical bundle entry; headless commands must remain on the ADR 0051 UI-neutral path.
- Do not add tracked generated JavaScript or emit production JavaScript outside the owned canonical `build/` output.
- Do not publish packages or alter release/versioning state as part of this migration.

## Stop Rules
- Stop before moving dependent runtime modules if TASK-2278 or TASK-2290 is unavailable or its delivered interfaces do not provide the expected ADR 0044/0051 seams; document the missing contract and request a rebase or dependency resolution.
- Stop if a clean/repeated build cannot produce the declared artifact set or byte-identical canonical manifests; do not replace determinism evidence with a single successful build.
- Stop if any headless compatibility test imports or initializes Ink, changes expected JSON output, or changes an established exit code; restore the UI-neutral boundary before continuing.
- Stop if runtime asset resolution bypasses `AssetStore`, the bundle relies on runtime `node_modules`, or representative errors cannot map to TypeScript file-and-line locations.
- Stop if the remaining first-party `createRequire` paths cannot be replaced by static ESM imports or an in-bundle static registry; record that as an ADR 0044 reassessment. Do not treat the Node 25/26 SEA prerequisite as a blocker for the Node 22 canonical ESM bundle.
- Stop before deleting or disabling the `dist/` shim unless the npm package migration compatibility gate has passed and the recorded deletion gate is satisfied.
