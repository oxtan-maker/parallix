# Mission: Update the Distribution ADR for a Repository-Wide TypeScript Model (task-2223)

## Goal
Record a dated, evidence-backed update to ADR 0044 that selects one coherent repository-wide TypeScript development, test, build, and npm distribution model, makes its operational contracts explicit, and decomposes migration into reviewable follow-up missions without changing the current runtime or build.

## Why Now
The repository currently mixes TypeScript source with tracked sibling CommonJS output, exposes two apparent output layouts, omits tests from the intended type boundary, and depends on mtime freshness checks to detect source/runtime drift. ADR 0044 establishes the distribution boundary but does not decide the end-state TypeScript architecture. Leaving that gap open makes each build, test, packaging, and migration change choose local conventions independently and increases the risk of incompatible package or module decisions.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: documentation-only architecture decision; broad repository inventory; current official Node.js, TypeScript, and npm research; explicit compatibility, publication, and phased-migration gates

## Scope
- Add a dated decision update to `docs/adr/0044-workflow-distribution-model.md` and update its entry in `docs/adr/index.md` so the accepted TypeScript model is discoverable.
- Inventory the present development and distribution model with file-level evidence from `package.json`, every TypeScript configuration, ESLint configuration, unit and E2E test runners, build-freshness guards, package-content tests, mutation-test configuration, executable entry points, and tracked generated JavaScript.
- Define measurable end-state goals and compare at least these three coherent alternatives in a scored matrix: NodeNext ESM emitted to `dist/`, CommonJS emitted to `dist/`, and dual-package or bundled output. The analysis must identify the dual-package hazard and reject dual output unless an evidenced consumer requires it.
- Select and document the authoritative source layout, module format and import-specifier convention, `package.json` `type`/`main`/`bin`/`exports` contract, compiler project structure, test typing and execution model, declaration and source-map policy, and development execution path.
- Define resolution and copying rules for `prompts/`, `templates/`, `config/`, documentation, and executable scripts in source development and installed-package layouts without depending on the caller's CWD.
- Define reproducible clean-build, package-content, tarball-install, CLI smoke, coverage, and mutation-test proof that replaces mtime freshness in the target architecture while identifying any temporary migration guard.
- Reconcile the new decision with ADRs 0037, 0046, and 0049, the existing historical sections of ADR 0044, README development guidance, and build-freshness documentation through references or explicit supersession rather than rewriting history.
- Produce an ordered migration backlog in the ADR, with review-sized phases, dependencies, compatibility shims, CI/integration gates, documentation duties, acceptance evidence, and a rollback point after every phase.
- Support ecosystem requirements with current official Node.js, TypeScript, and npm sources and distinguish standards or runtime requirements from repository preferences.

## Out of Scope
- Changing runtime source, tests, package scripts or metadata, TypeScript or ESLint configuration, test runners, CI/integration configuration, dependencies, assets, or tracked generated JavaScript.
- Converting JavaScript or tests to TypeScript, moving files, creating `dist/`, changing module format, or implementing any migration phase selected by the ADR.
- Publishing a package, changing the current `px` installation path, or claiming a registry, dual-package, bundled, or standalone-binary consumer that has not been evidenced.
- Rewriting the historical context of ADRs 0037, 0044, 0046, or 0049; only dated updates, cross-references, and explicit supersession statements are permitted.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `docs/adr/0044-workflow-distribution-model.md` contains a dated task-2223 update with an explicit accepted end state, and `docs/adr/index.md` describes that current decision and status.
- SC2: The ADR includes a current-state architecture diagram and an evidence table covering `package.json`, all repository TypeScript configurations, ESLint, unit and E2E runners, freshness guards, package-content tests, mutation testing, executable entry points, and tracked sibling JavaScript; each inventory row cites at least one repository file or command.
- SC3: The ADR states verifiable targets for one authoritative source tree, clean-build reproducibility, separation of generated runtime output, intended source-and-test type coverage, public API boundaries, npm artifact contents, source-mapped stack traces, and local feedback commands.
- SC4: A scored decision matrix evaluates NodeNext ESM-to-`dist/`, CommonJS-to-`dist/`, and dual-package or bundled output against compatibility, toolchain complexity, package correctness, debugging, migration cost, and local feedback; it names one winner and rejects dual-package output unless a named current consumer is evidenced.
- SC5: The accepted decision fixes the repository tree, module and import-specifier convention, `package.json` `type`/`main`/`bin`/`exports` shape, compiler project/configuration roles, declaration policy, source-map policy, and clean-output ownership with no mutually exclusive options left open.
- SC6: The accepted test contract accounts for unit, E2E, coverage, and mutation tests; decides TypeScript conversion versus checked JavaScript; specifies a test-only typecheck configuration; and identifies the command used for direct source execution during development.
- SC7: The ADR specifies source-tree and installed-package resolution/copy behavior for `prompts/`, `templates/`, `config/`, documentation, and executable scripts, and explicitly prohibits CWD-dependent asset lookup.
- SC8: The target verification contract replaces mtime freshness with a clean-checkout build plus reproducible output/package-content checks, while documenting the purpose and removal gate of any temporary freshness compatibility guard.
- SC9: Publication proof includes named steps for clean checkout/build, `npm pack --dry-run`, tarball inspection, temporary-directory installation, `px --version`, representative CLI commands, and an explicit inclusion/exclusion table for TypeScript sources, tests, operator state, declarations, maps, and non-code assets.
- SC10: The ADR contains ordered, review-sized migration phases with dependencies, compatibility shims, deletion timing for tracked JavaScript, CI/integration gates, documentation updates, acceptance evidence, and a rollback point after each phase; no phase implements the migration in this mission.
- SC11: ADRs 0037, 0046, and 0049, ADR 0044's earlier distribution stance, README development guidance, and build-freshness documentation are each listed as aligned, superseded in a named respect, or deferred to a specific migration phase without altering historical decision text.
- SC12: Claims about Node.js module behavior, TypeScript compiler behavior, and npm package/exports behavior cite current official documentation with access dates and clearly label repository preferences separately from ecosystem requirements.
- SC13: The final diff is limited to `docs/adr/0044-workflow-distribution-model.md`, `docs/adr/index.md`, this mission's checkpoint documents, and backlog task documents created or updated solely to record the phased migration; it contains no runtime, test, package, or configuration implementation changes.
- SC14: `./scripts/verify-local.sh docs` and the repository's documentation link/consistency checks complete successfully, with the exact commands and results recorded in the final checkpoint.

## Risks and Assumptions
- The most modern-looking option may not be the lowest-risk option for current consumers; the matrix must weight observed compatibility evidence rather than novelty.
- Node.js, TypeScript, npm, test-runner, and mutation-runner constraints can change; ecosystem claims are assumed valid only when tied to current official documentation captured during execution.
- The repository may contain generated JavaScript or asset resolution paths that are not obvious from top-level configuration; the inventory must use tracked-file and configuration evidence before declaring coverage complete.
- A single ADR can become too broad to execute safely. The decision must be complete, but implementation must remain split into dependency-ordered missions with independently testable rollback boundaries.
- This is an architecture-document mission. NEL is expected to remain in the Small bucket because documentation and backlog bookkeeping are excluded from NEL, even though the research and written diff may be substantial.
- No current consumer is assumed to require dual-package output; discovering one is a stop-and-reassess condition, not permission to silently broaden the accepted model.

## Checkpoints
- CP 1: Current-state evidence and constraints — inventory all named build, typecheck, test, mutation, executable, packaging, asset, generated-output, and freshness surfaces; record official ecosystem sources; map conflicts with ADRs 0037, 0046, and 0049 plus README/build-freshness guidance.
- CP 2: Alternatives and decision — define measurable goals, build and score the three required target models, resolve the dual-package hazard, and select one internally consistent end-state contract covering repository layout, modules, compiler projects, tests, package metadata, declarations, source maps, assets, and local execution.
- CP 3: Migration and publication proof — specify clean-build and package verification, temporary compatibility guards, ordered implementation missions, dependency and deletion sequencing, CI/integration gates, documentation duties, semver impact, and a rollback point for every phase.
- CP 4: ADR integration and verification — add the dated ADR 0044 update, refresh `docs/adr/index.md`, confirm every success criterion has file/ADR/command evidence, run the documentation verification and link/consistency commands, and confirm the diff contains no implementation changes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A section using the exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review task-2223 --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- Raw `stat`/`ls` output or generic prose alone is not enough; shell output must be paired with at least one accepted file:line reference, exact test name, test file path, ADR reference, or recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- A non-generic `Next action:` line at the bottom that names the next ADR drafting, evidence, migration-planning, or verification action

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh docs`

## Restricted Areas
- Do not edit `lib/`, `test/`, executable entry points, `package.json` or lockfiles, any `tsconfig*`, ESLint/test/mutation configuration, scripts, prompts, templates, config assets, generated JavaScript, or CI/integration-pipeline files.
- Documentation edits are restricted to `docs/adr/0044-workflow-distribution-model.md`, `docs/adr/index.md`, mission checkpoint documents under `missions/task-2223/`, and backlog task documents needed to capture the migration phases.
- Preserve the historical text of ADRs 0037, 0044, 0046, and 0049. Add a dated ADR 0044 update and references; do not retroactively rewrite earlier decisions.
- Do not change backlog assignees, transition task status, publish packages, or start review, execute, or integrate work as part of drafting or ADR implementation.

## Stop Rules
- Stop and request direction if evidence identifies a current supported consumer that requires dual ESM/CommonJS output, because that materially changes the package hazard and decision matrix.
- Stop before implementation if the selected model requires runtime, test, package, compiler, generated-output, asset, or CI changes; record those changes only as follow-up migration missions.
- Stop and resolve the inconsistency if the selected module, compiler, test, or package contracts cannot all be represented by one accepted repository tree and command contract.
- Stop rather than claim completion if any required inventory surface lacks repository evidence, any ecosystem claim lacks a current official source, any migration phase lacks an acceptance gate or rollback point, or any SC1–SC14 row lacks accepted evidence.
- Stop and revert the out-of-scope portion if `git diff --name-only` shows changes outside the permitted ADR, index, mission checkpoint, and backlog documents.
- Stop rather than weaken or bypass the docs gate if `./scripts/verify-local.sh docs` or a documented link/consistency check fails.
