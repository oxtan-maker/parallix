# Mission: TS migration phase T1 — test typecheck project (task-2224)

## Goal

Add a check-only TypeScript compiler project (`tsconfig.test.json`) that brings all `test/**/*.js` files into the type boundary as checked JavaScript, wire it as a named stage in `./scripts/verify-local.sh static-analysis`, and fix or `@ts-expect-error`-annotate any revealed test-type defects. No runtime, layout, or behavioral change.

## Why Now

ADR 0044 §9 (2026-07-11 update, task-2223) accepted the repository-wide TypeScript model and decomposed the migration into reviewable phases. Phase T1 is the first migration step — it has no prerequisites and establishes the test-side type boundary before any layout change (T3–T5). Completing T1 unblocks T2 (asset-resolution hardening) independently and proves the typecheck infrastructure works across the 156 test files before the runtime tree moves to `dist/`.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 156 CommonJS test files enter typecheck for the first time; defects surfaced by `checkJs` must be fixed or annotated; one new config file and one gate-stage wiring change

## Scope

- Create `tsconfig.test.json` with `noEmit: true`, `allowJs: true`, `checkJs: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2024`, including `test/**/*.js` (per ADR 0044 §4)
- Add a new stage (Stage 4) to `./scripts/verify-local.sh static-analysis` that runs `tsc --noEmit --project tsconfig.test.json` and reports named PASS/FAIL
- Fix type errors revealed by the new stage (e.g., missing type annotations, incorrect implicit-any usage)
- Annotate remaining type errors with `// @ts-expect-error <reason>` where the fix is not in scope (e.g., untyped third-party runtime shapes)
- Ensure `npm test` continues to pass unchanged (no behavioral regression)
- Convert the 6 pre-existing `@ts-expect-error` directives that become unused (TS2578) under the non-`strict` test config to `@ts-ignore` in `lib/commands/integrate.ts` and `lib/tools/setup-review.ts` — comment-only, no runtime change (see Restricted Areas exception and Tradeoffs)

## Out of Scope

- Converting any `test/**/*.js` file to `.ts` (ADR 0044 §5 explicitly rejects wholesale conversion)
- Changing `tsconfig.json` (the emit project) — that is a later phase
- Modifying the runtime source tree (`lib/`, `index.ts`, `px.ts`) — **except** the narrow, comment-only conversion of the 6 pre-existing `@ts-expect-error` suppression directives to `@ts-ignore` in `lib/commands/integrate.ts` and `lib/tools/setup-review.ts` that become unused-directive errors (TS2578) once `strict` is dropped per ADR 0044 §4 (see Scope and Tradeoffs). No runtime, control-flow, or behavioral change to `lib/` is permitted.
- Changing test runners, preload behavior, or `pretest` wiring
- Adding type declarations (`.d.ts`) or enabling `declaration: true`
- Modifying `config/integration-pipelines.json` (T1 is a static-analysis gate change only)

## Success Criteria

- **SC1:** `tsconfig.test.json` exists at the repository root with `noEmit: true`, `allowJs: true`, `checkJs: true`, and `include` covering `test/**/*.js`.
- **SC2:** `./scripts/verify-local.sh static-analysis` runs a named Stage 4 (`tsc --noEmit --project tsconfig.test.json`) that exits 0 on the final tree.
- **SC3:** `npm test` passes with the same test count and exit code as the parent commit (no behavioral regression).
- **SC4:** Every TypeScript error originally revealed by the new test typecheck is either (a) fixed inline or (b) annotated with `// @ts-expect-error` carrying a one-line reason.
- **SC5:** Reverting the phase commit restores the previous static-analysis behavior (3 stages, no test typecheck) with no runtime impact.

## Tradeoffs

- **`@ts-ignore` in `lib/` (parked):** 6 `@ts-expect-error` directives in `lib/commands/integrate.ts` and `lib/tools/setup-review.ts` were converted to `@ts-ignore` because without `strict` they become unused directives (TS2578). This is an acceptable tradeoff to keep T1 scoped to test files only. Proper type resolution (optional types, guards) is deferred to task-2260.

## Risks and Assumptions

- **Risk — volume of type errors:** 156 test files may surface many implicit-any or missing-annotation errors under `checkJs`. Mitigation: `@ts-expect-error` is the accepted escape hatch per ADR 0044 §5; the criterion is that every error is accounted for, not that every error is fixed.
- **Risk — test bootstrap preloads:** `test/bootstrap-parallix-home.js` is preloaded via `--require` and may reference runtime modules whose types are not visible to the test project. Mitigation: include `lib/**/*.ts` in `tsconfig.test.json` references so test files can resolve runtime types.
- **Assumption:** The existing `tsc` binary supports `--project tsconfig.test.json` with the installed TypeScript version.
- **Assumption:** No test file depends on global types that are not already available through the base `tsconfig.json` compiler options.

## Checkpoints

- **CP 1:** Create `tsconfig.test.json` with the correct compiler options and include/exclude rules; run `tsc --noEmit --project tsconfig.test.json` manually to inventory the initial error count.
- **CP 2:** Fix or annotate all revealed type errors across `test/**/*.js`; re-run the typecheck until it exits 0.
- **CP 3:** Wire the test typecheck as a named Stage 4 in `./scripts/verify-local.sh static-analysis`; confirm the full gate passes.
- **CP 4:** Run `npm test` to confirm no behavioral regression; run `./scripts/verify-local.sh all` as the final verification.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `tsconfig.test.json:1` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/active.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `tsc --noEmit --project tsconfig.test.json` ``, `` `npm test` ``, or `` `./scripts/verify-local.sh static-analysis` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| tsconfig.test.json exists with correct options | `tsconfig.test.json:1-12` (noEmit, allowJs, checkJs, include test/**/*.js) | PASS |
| Stage 4 runs in static-analysis | `scripts/verify-local.sh:72-80` (Stage 4: Test typecheck, `tsc --noEmit --project tsconfig.test.json`) | PASS |
| npm test passes unchanged | `` `npm test` `` exits 0, 156 tests run | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `lib/` — no changes to runtime source files, **with one authorized exception**: the 6 pre-existing type-suppression comments in `lib/commands/integrate.ts` (`:1179`) and `lib/tools/setup-review.ts` (`:932`, `:936`, `:1011`, `:1015`, `:1022`, `:1028`) may be converted from `@ts-expect-error` to `@ts-ignore` because, with `strict` dropped per ADR 0044 §4, they otherwise become unused-directive errors (TS2578). These are comment-only edits with no runtime or behavioral effect; proper type resolution is deferred to task-2260. No other `lib/` changes are permitted.
- `tsconfig.json` — the emit project is not modified in this phase
- `package.json` scripts — `pretest`, `test`, `build:cjs` remain unchanged
- `config/integration-pipelines.json` — T1 modifies the static-analysis gate script only, not the integration pipeline config
- `.gitignore` — no changes (tracked compiled files are handled in T4)

## Stop Rules

- Stop if `npm test` exits nonzero after wiring the new stage — the test typecheck must not affect runtime behavior.
- Stop if any test file must be converted to `.ts` to resolve types — that is deferred to optional phase T6 per ADR 0044 §5.
