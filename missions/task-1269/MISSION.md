# Mission: Add diff-scoped mutation testing with ratchet enforcement (task-1269)

## Goal

Add StrykerJS mutation testing to the parallix CI gate, scoped to the mission diff (changed files and their callees), and enforce it as a ratchet: no mission may lower the mutation score on the files it touches. Replace the "add StrykerJS" recommendation from TASK-1133 analysis with a concrete, runnable gate that sits alongside the existing 90% line-coverage gate in `lib/commands/coverage-gate.ts`.

## Why Now

The current coverage gate enforces 90% line coverage (`lib/commands/coverage-gate.ts`), which is the weakest possible quality signal. Research (arxiv 2510.09907; earezki.com "Tests Are Everything in Agentic AI") shows AI-generated test suites reach only ~20% mutation score — meaning ~80% of injected bugs survive despite passing line-coverage gates. High-velocity development with line-coverage-only produces "tests pass but validate nothing." TASK-1353 (static-analysis stage) and TASK-1354 (regression-test-first) already landed; mutation scoring is the next layer to prevent shallow reproduction tests from masking real defects. This mission pairs directly with TASK-1354: mutation score is what stops a "reproduction" test from being a trivially-passing shallow test.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: Bug-reduction initiative #4; TASK-1354 pairs with mutation ratchet to lock regression tests; line-coverage-only is demonstrably insufficient for AI-generated test suites

## Scope

- Implement `lib/commands/mutation-gate.ts`: a CLI command mirroring `coverage-gate.ts` structure, running StrykerJS on a diff-scoped subset of files
- Diff-scoping algorithm: compute changed files between the mission branch and `main` (or the base branch), then resolve their direct callees via AST/static analysis to build the mutation target set
- Ratchet logic: read the previous mutation score for the affected files (stored in `config/mutation-baseline.json` keyed by file path), reject if the new score is lower than the baseline for any touched file
- Store the updated mutation baseline after a successful gate run
- Add `--dry-run` mode that prints the diff-scoped file set and predicted run time without executing StrykerJS
- Add StrykerJS as a devDependency in `package.json` with a minimal config (`stryker.conf.json`) tuned for Node.js built-in test runner
- Document in `docs/adr/adr-mutation-testing.md` why line-coverage is insufficient and how mutation score complements it
- Add a regression test (`test/mutation-gate-ratchet.test.js`) that demonstrates a surviving-mutant case failing the ratchet gate
- Place the gate in the pre-integrate lifecycle (not per-checkpoint) with rationale tied to TASK-1133 runtime budget
- Update `scripts/verify-local.sh` to include `mutation-gate` as a可选 pre-integrate gate option

## Out of Scope

- Full-repo mutation testing (too slow; explicitly scoped to mission diff)
- Mutation testing on the test files themselves (the backlog task says "on the test for parallix testing itself" — this mission focuses on `lib/` source files, not `test/` files)
- Integration with external CI systems (GitHub Actions, GitLab CI, etc.) — this is a local-first tool
- Supporting other mutation frameworks beyond StrykerJS (unless StrykerJS proves incompatible with Node.js built-in test runner)
- Changing the existing 90% line-coverage gate threshold or removing it — mutation score is complementary, not replacement

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `lib/commands/mutation-gate.ts` exists, is typed (TypeScript), and passes `./scripts/verify-local.sh static-analysis` (ESLint + tsc --checkJs + test-hygiene) with zero errors
2. `mutation-gate --dry-run` on a clean branch prints the diff-scoped file set and exits 0 without running StrykerJS
3. On a branch with a known mutation-introducing change (e.g., replacing a function body with a no-op), `mutation-gate` exits non-zero because the mutation score drops below the ratchet floor
4. On a branch with no mutation-introducing changes, `mutation-gate` exits 0 and writes the new mutation score to `config/mutation-baseline.json`
5. `test/mutation-gate-ratchet.test.js` contains a test that injects a surviving mutant into a known-good file and asserts the ratchet rejects it (exit code 1)
6. `docs/adr/adr-mutation-testing.md` exists and contains a written justification comparing line coverage vs. mutation score, citing arxiv 2510.09907
7. The mutation gate runs in under 60 seconds on a typical mission diff (≤10 changed files) when executed via `mutation-gate --dry-run` followed by a real run on the same diff
8. `config/mutation-baseline.json` has a stable schema: `{ "filePaths": { "<path>": { "score": <number>, "timestamp": "<ISO date>" } } }`

## Risks and Assumptions

- **Risk:** StrykerJS may not support Node.js built-in test runner (`node --test`) out of the box. Mitigation: evaluate StrykerJS compatibility with Node 20+ `--test` runner during CP-1; if blocked, pivot to a lighter-weight mutation tool or write a minimal mutator+oracle wrapper.
- **Risk:** Diff-scoped callee resolution via AST may miss transitive dependencies. Mitigation: conservative scoping (include all callees, not just direct ones) and document the limitation in the ADR.
- **Assumption:** The TASK-1133 sub-30s gate budget applies to per-checkpoint gates; placing mutation testing at pre-integrate relaxes this constraint, allowing up to 60s for diff-scoped runs.
- **Assumption:** `config/mutation-baseline.json` can serve as the ratchet store. If concurrent missions overwrite each other's baselines, the ratchet may be unfair — this is acceptable for the initial implementation (sequential missions).
- **Assumption:** StrykerJS devDependency adds ~200MB to `node_modules`. This is acceptable for a dev dependency and does not affect the published package size (only `lib/`, `index.js`, and `px.js` ship).

## Checkpoints

- CP 1: Research and POC — Verify StrykerJS works with Node.js built-in test runner on a single file in `lib/`. Produce a one-page POC report in `missions/task-1269/CP-1.md` showing: installation steps, a minimal `stryker.conf.json`, and a run result (passing and failing cases). If StrykerJS is incompatible, document the pivot decision.
- CP 2: Diff-scoped file resolver — Implement the diff-scoping algorithm in `lib/core/mutation-scoper.ts`: takes a base branch and head branch, computes changed files, resolves callees, and outputs the target file list. Ship with unit tests in `test/mutation-scoper.test.js`.
- CP 3: Mutation gate CLI — Implement `lib/commands/mutation-gate.ts` with `--dry-run`, `--baseline-path`, and ratchet enforcement. Wire it to read/write `config/mutation-baseline.json`. Include `--threshold` flag (default: no minimum score, only ratchet check).
- CP 4: Baseline initialization — On first run (no baseline exists), initialize `config/mutation-baseline.json` with current scores for all `lib/` files. Document the initialization behavior in the ADR.
- CP 5: Regression test — Author `test/mutation-gate-ratchet.test.js` that injects a surviving mutant and asserts the ratchet fails. The test must be self-contained (no network, no external tools beyond what the gate itself uses).
- CP 6: ADR documentation — Write `docs/adr/adr-mutation-testing.md` with the line-coverage vs. mutation-score comparison, lifecycle placement rationale, and ratchet design decisions.
- CP 7: Gate integration — Update `scripts/verify-local.sh` to expose a `mutation-gate` subcommand. Update `config/integration-pipelines.json` to include a `mutation` gate at order 40 (between static-analysis at order 1 and workflow at order 50).

## Gates

- [ ] `./scripts/verify-local.sh static-analysis` — ESLint + tsc --checkJs + test-hygiene on all new files
- [ ] `./scripts/verify-local.sh all` — full test suite passes with new files included
- [ ] `./scripts/verify-local.sh docs` — ADR file exists and references resolve

## Restricted Areas

- Do not modify `lib/commands/coverage-gate.ts` — the mutation gate is a new file, not a replacement
- Do not modify `lib/core/verification.ts` or `lib/commands/integrate.ts` — the mutation gate plugs in separately
- Do not change the `test/` directory structure or existing test file names
- Do not modify `prompts/` — this mission does not touch agent prompts
- Do not edit `AGENTS.md` or `docs/doc-standards.md`

## Stop Rules

- Stop if StrykerJS cannot run with Node.js built-in `--test` runner after a reasonable POC effort (CP-1). Pivot to documenting the incompatibility and proposing an alternative.
- Stop if diff-scoped callee resolution requires a full compiler/toolchain (e.g., TypeScript compiler services) that introduces unacceptable complexity or build-time dependencies. Simplify to changed-files-only scoping.
- Stop if the mutation gate cannot run in under 60 seconds on a 10-file diff. Either reduce scope or document the runtime as a known limitation and recommend nightly execution.
- Stop if the ratchet design creates unresolvable conflicts between concurrent missions (e.g., two missions touch the same baseline file simultaneously). Simplify to a single-writer baseline model.
