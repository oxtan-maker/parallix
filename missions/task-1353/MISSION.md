# Mission: Add deterministic static-analysis stage to the gate (task-1353)

## Goal

Add a fast, deterministic pre-test verification stage to `scripts/verify-local.sh` that runs three checks before the test suite — ESLint on changed JavaScript files, `tsc --checkJs --noEmit` on `lib/core` and `lib/commands`, and a test-hygiene scanner for `it.only`/`describe.only`/`test.only` and unannotated `.skip`/`xit` — and integrates them into the gate so any failure aborts before `npm test` runs.

## Why Now

The only gate today is monolithic `npm test`. There is no ESLint, no TypeScript `checkJs`, and no guard against disabled or focused tests. This lets the full class of LLM-produced defects (undefined variables, unused bindings, wrong arity, unreachable code, typos) reach the test phase, and lets `it.only`/`describe.only`/orphan `.skip` silently shrink the suite. TASK-1333 recorded 15 silently-broken tests caused by this gap. This is the cheapest catch in the pipeline: no tokens, no agent, deterministic, and estimated at ~15-20% pipeline-wide bug reduction.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: bug-reduction initiative #1, silent test-shrinkage (TASK-1333), LLM defect leakage into tests

## Scope

- Create `.eslintrc.cjs` in the repo root with rules: `no-undef`, `no-unused-vars`, `valid-typeof`, `no-unreachable`, `no-async-promise-executor`, `eqeqeq`, `curly`, `no-var` — all set to `error`; configure `--max-warnings 0`; configure `--ext .js` targeting `lib/**/*.js`
- Create `tsconfig.json` in the repo root with `"allowJs": true`, `"checkJs": true`, `"noEmit": true`, `"strict": true` (or a minimal strict subset: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`), `"include": ["lib/core/**/*.js", "lib/commands/**/*.js"]`
- Create `scripts/test-hygiene.sh` that scans `test/**/*.test.js` for `it.only`, `describe.only`, `test.only` (fails the gate) and `.skip`/`xit`/`fit` without an inline comment annotation containing `skip-reason:` or `reason:` (fails the gate)
- Add a new `gate_static_analysis()` function to `scripts/verify-local.sh` that runs all three stages sequentially and fails the gate on any non-zero exit
- Add a `static-analysis` area to the `verify-local.sh` case statement
- Ensure the combined gate runtime (lint + tsc + hygiene + test) stays within the TASK-1133 sub-30s gate budget by keeping each stage targeted and fast
- Ensure existing repos with no declared gate are unaffected: the static-analysis stage is gated behind the `static-analysis` area selector, not run by default on `verify-local.sh` with no arguments

## Out of Scope

- ESLint or TypeScript configuration for the `test/` directory (test files use Node.js built-in `node:test` and are not part of the checkJs scope)
- Adding ESLint or TypeScript to the CI/CD pipeline (local-only gate for now)
- Fixing pre-existing type errors or lint violations in `lib/core` or `lib/commands` (the gate fails on them; a follow-up task cleans them)
- Prettier or formatter enforcement
- Coverage gates or performance benchmarks
- Changes to `px.js`, `index.js`, or `templates/` (outside `lib/core` and `lib/commands`)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" is not sufficient.

1. **ESLint gate exists and runs:** `./scripts/verify-local.sh static-analysis` executes ESLint with `--max-warnings 0` against `lib/**/*.js`. The `.eslintrc.cjs` contains at least these 8 rules set to `error`: `no-undef`, `no-unused-vars`, `valid-typeof`, `no-unreachable`, `no-async-promise-executor`, `eqeqeq`, `curly`, `no-var`. The command exits 0 when no lint errors exist in `lib/`.

2. **Test-hygiene guard detects violations:** `./scripts/verify-local.sh static-analysis` runs `scripts/test-hygiene.sh` which scans `test/**/*.test.js`. When a file contains `it.only`, `describe.only`, or `test.only`, the command exits non-zero. When a file contains `.skip` or `xit` without an inline comment containing `skip-reason:` or `reason:`, the command exits non-zero. The guard exits 0 when no violations exist.

3. **TypeScript checkJs gate runs on target dirs:** `./scripts/verify-local.sh static-analysis` runs `tsc --checkJs --noEmit` with a `tsconfig.json` whose `include` array covers at least `lib/core/**/*.js` and `lib/commands/**/*.js`. The command exits 0 when no type errors exist in the included files.

4. **Gate runs before test suite:** The `static-analysis` area in `verify-local.sh` runs all three stages sequentially and exits non-zero on any failure, preventing `npm test` from executing. The combined runtime of all three stages (ESLint + tsc + hygiene) measured over 3 consecutive runs averages under 10 seconds on a cold cache.

5. **Opt-in per repo config — existing repos unaffected:** Running `./scripts/verify-local.sh` with no subcommand (default gate behavior) does not invoke the static-analysis stage. The static-analysis stage is only activated via the explicit `static-analysis` area selector. No changes to `package.json` scripts or default gate behavior.

## Risks and Assumptions

- **Risk:** `tsc --checkJs` may surface dozens of type errors in `lib/core` and `lib/commands` on first run, causing the gate to fail immediately. Mitigation: the mission ships the gate in a failing-by-design state; a follow-up task cleans the errors. The MISSION.md does not require fixing pre-existing errors.
- **Risk:** ESLint on all of `lib/**/*.js` may flag many violations (e.g., implicit globals like `module`, `require`, `process`). Mitigation: configure the ESLint parser to recognize Node.js globals via `env: { node: true }` to avoid false positives on `module`, `require`, `__dirname`, `__filename`, `process`, `console`.
- **Risk:** The test-hygiene guard may produce false positives on `.skip` used in non-test contexts (e.g., variable names like `skipReason`). Mitigation: restrict the scan to `test/**/*.test.js` files only and use a line-level regex that requires the pattern to appear inside an `it(`, `describe(`, or `test(` call context.
- **Risk:** Adding `tsc` and `eslint` as devDependencies increases install surface. Mitigation: both are already commonly available in Node.js projects; pin versions to avoid drift. If neither exists as a devDependency, the mission adds them with pinned versions.
- **Assumption:** The TASK-1133 sub-30s gate budget is still a valid constraint. If the budget has changed, the 10-second target for the static-analysis stage is adjustable.
- **Assumption:** `node:test` test files in `test/**/*.test.js` are the only test files; no Jest/Mocha/Vitest files exist.
- **Assumption:** The `lib/core` and `lib/commands` directories contain JSDoc-annotated functions that can benefit from `checkJs` type inference.

## Checkpoints

- CP 1: ESLint configuration drafted — `.eslintrc.cjs` created with the 8 required rules, Node.js env enabled, and verified with `eslint --ext .js lib/` producing a known result
- CP 2: TypeScript configuration drafted — `tsconfig.json` created with `allowJs`, `checkJs`, `noEmit`, and `include` covering `lib/core` and `lib/commands`; verified with `tsc --checkJs --noEmit`
- CP 3: Test-hygiene scanner created — `scripts/test-hygiene.sh` scans `test/**/*.test.js` for `.only` and unannotated `.skip`/`xit`; verified against synthetic test files
- CP 4: Gate integration complete — `gate_static_analysis()` added to `verify-local.sh`, `static-analysis` area registered in the case statement, all three stages run sequentially
- CP 5: Runtime budget validated — combined static-analysis stage measured under 10 seconds average over 3 runs

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] Static-analysis gate dry-run: `./scripts/verify-local.sh static-analysis` completes with exit 0 (or exits non-zero with documented pre-existing errors in lib/core or lib/commands)
- [ ] Test-hygiene positive check: insert `it.only('should fail', () => {})` into a copy of one test file, run `./scripts/verify-local.sh static-analysis`, confirm exit non-zero

## Restricted Areas

- Do not modify any `lib/` command handler logic, agent adapters, or workflow coordination code
- Do not change the `px` subcommand list, flag names, help text, or CLI entry points (`px.js`, `index.js`)
- Do not modify `workflow.config.json` or any operator-local configuration files
- Do not add ESLint or TypeScript rules beyond the 8 specified in Success Criterion 1
- Do not modify the `npm test` script in `package.json`
- Do not add dependencies beyond `eslint` and `typescript` (if not already present)

## Stop Rules

- If `tsc --checkJs` surfaces more than 200 type errors in `lib/core` + `lib/commands` combined, stop fixing them — ship the gate in failing state and document the error count as a follow-up
- If ESLint with Node.js env enabled still produces more than 50 errors on `lib/**/*.js`, stop — ship the gate and document the count for a follow-up cleanup task
- If the combined static-analysis runtime exceeds 30 seconds on any run, stop and investigate bottleneck rather than widening scope
- If adding `eslint` and `typescript` as devDependencies conflicts with the project's zero-dependency philosophy for runtime modules, document the conflict and stop
