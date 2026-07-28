# Mission: Invert the application-layer dependency and make the boundary guard directory-scoped (task-2314)

## Goal
Move the shared application contracts, ports, and services out of `src/platform/runtime/lib/application/` into `src/application/`, reverse all remaining legacy consumers to depend on that canonical home, and replace the hardcoded application-boundary entry list with a directory-scoped guard that correctly distinguishes `node:sqlite` from `src/adapters/sqlite/`.

## Why Now
The canonical application and adapter layers currently import their vocabulary from the legacy runtime tree, so every new migration slice can recreate the dependency direction ADR 0051 prohibits. The existing boundary test checks only nine named files instead of the entire 18-file application directory, leaving new and existing files unprotected. TASK-2285 must integrate first because both missions edit `scripts/build-canonical-bundle.js` in the same emit-list region.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: relocate four shared modules (163 LOC), remove nine reverse imports, cover every canonical application file, preserve `px active` and `px stats-backfill` behaviour, and keep both distribution trees buildable

## Scope
- Relocate `contracts.ts`, `ports.ts`, `active-service.ts`, and `stats-backfill-service.ts` from `src/platform/runtime/lib/application/` to their canonical homes under `src/application/`.
- Update canonical, adapter, legacy-runtime, composition, command, build, and test consumers required by that relocation.
- Remove the forwarding-only modules `src/application/services/index.ts` and `src/adapters/legacy/index.ts`, unless a concrete documented reason requires retaining either module.
- Make the application import-boundary test discover and evaluate every file beneath `src/application/`.
- Narrow the SQLite rule to reject the `node:sqlite` builtin while allowing imports associated with `src/adapters/sqlite/`, with fixtures for both cases.
- Preserve ADR 0051 behavioural invariants for `px active` and `px stats-backfill`, update relocated-module `dist` loading tests, amend ADR 0051 in place, and verify canonical plus transitional distribution outputs.

## Out of Scope
- Retiring the transitional CommonJS rollback tree or flattening `src/platform/runtime/lib/` (TASK-2288 owns that work).
- Changes to the CommonJS emitter beyond the specific emit-list/path updates required by relocating these four modules.
- New CLI features, changes to the JSON contract of `px active`, or changes to task-state semantics.
- Any work from TASK-2307 except conflict-aware coordination if it begins editing `src/application/board-command.ts` or `src/application/board-controller.ts`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/platform/runtime/lib/application/` no longer contains `contracts.ts`, `ports.ts`, `active-service.ts`, or `stats-backfill-service.ts`; each has one canonical implementation under `src/application/`; and no file beneath `src/application/` or `src/adapters/` imports `src/platform/runtime/lib/application`.
- `legacy-active-adapter`, `legacy-stats-backfill-adapter`, `composition/application-services`, and `commands/stats-backfill` import the relocated application modules from their canonical paths, with no legacy-to-canonical reverse import introduced.
- `src/application/services/index.ts` and `src/adapters/legacy/index.ts` are absent, or each retained file has a documented non-forwarding purpose and a consumer-level test proving that purpose.
- The application-boundaries suite walks `src/application/` rather than a hardcoded entry-point list, and its test proves that a newly created violating application file is detected without modifying a list of paths.
- The boundary guard rejects a `node:sqlite` import and permits the legitimate repository SQLite adapter path, with an explicit accept fixture and reject fixture in the boundary-guard tests.
- Existing `px active` and `px stats-backfill` behaviours remain covered: failed active launch restores status and assignee, `transitionTask` ordering remains intact, stats-backfill builds its projection before any write, and `px active` does not gain a JSON contract.
- `scripts/build-canonical-bundle.js` emits both the canonical esbuild bundle and transitional CommonJS rollback tree after relocation; the package-content audit and reproducible-dist checks pass.
- Tests that load relocated modules through `dist` paths use the new paths; the default suite completes green without reducing its executed-test count and without introducing focused or unannotated skipped tests.
- `docs/adr/0051-ui-neutral-application-boundary.md` records the corrected dependency direction by amending the ADR in place, without superseding or dated-history clauses.

## Risks and Assumptions
- TASK-2285 currently overlaps `scripts/build-canonical-bundle.js`; do not begin implementation until it integrates or its build-script overlap is removed.
- Moving modules can break the dual ESM/CommonJS emit layout and tests that import generated `dist` paths; validate both build products before declaring the relocation complete.
- A broad `sqlite` token match would falsely reject the legitimate SQLite adapter; test both the builtin and repository-path cases.
- Assume TASK-2278 and TASK-2290 remain the authoritative completed design groundwork, and re-check TASK-2307 only if it begins touching the guarded application entry points.

## Checkpoints
- CP 1: Confirm TASK-2285 is integrated or no longer overlaps the bundle script; map all four legacy module exports, nine canonical/adapter reverse imports, legacy consumers, forwarding shims, `dist` import tests, and relevant ADR 0051 invariants before editing.
- CP 2: Relocate the four application modules, update all production and build-script imports, remove or justify the two forwarding shims, and add/update tests for canonical and generated `dist` module paths.
- CP 3: Change the application boundary suite to directory discovery; add fixtures proving automatic coverage of a newly violating file and the `node:sqlite` reject versus SQLite-adapter accept distinction.
- CP 4: Amend ADR 0051, run all required distribution, package, reproducibility, default-suite, lint/static-analysis, and hygiene checks, then record final evidence against every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include a summary of work done, the exact heading `## Goal Check`, and this exact 3-column pipe-delimited table header:

| Criterion | Evidence | Status |

Include at least one evidence row per applicable criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized command/path above.
- End with a concrete `Next action:` line that identifies the next file, test, command, or decision.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not begin implementation while TASK-2285 has an overlapping active change to `scripts/build-canonical-bundle.js`.
- Do not retire or flatten the transitional CommonJS tree, alter unrelated runtime architecture, or modify `dist/` generated outputs directly.
- Do not change `px active` output into a JSON contract or change active-launch/task-transition semantics beyond preserving existing behaviour during import relocation.
- Keep the ADR change limited to an in-place correction of dependency direction in ADR 0051.

## Stop Rules
- Stop and report if TASK-2285 has not integrated and still modifies the required `scripts/build-canonical-bundle.js` emit-list area.
- Stop and request direction if relocation requires changing public CLI behaviour, task-state semantics, or the scope of TASK-2288's CommonJS retirement.
- Stop and investigate before proceeding if directory-wide boundary discovery rejects legitimate imports other than the explicitly addressed SQLite adapter case.
- Stop before completion if any required build, package-content, reproducible-dist, default-suite, lint/static-analysis, or hygiene check fails; record the failing command and the affected criterion in the checkpoint.
