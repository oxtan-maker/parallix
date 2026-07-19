# Mission: Prove ADR 0044 local runtime feasibility and repair source-checkout handoff rebase (task-2277)

## Goal
Produce a non-production, reproducible proof on Node.js 22.23.1 that a single ESM bundle can source-run and bundle a TypeScript/TSX entry using React/Ink, `node:sqlite`, a logical embedded asset, built-in Node APIs, and a harmless subprocess; record runtime-loading evidence, source-map evidence, non-TTY behavior, measurements, warnings, and the ESM SEA limitation required by ADR 0044. Repair the pre-review rebase launcher so a TypeScript source checkout invokes `px.ts` through `tsx` instead of attempting to execute the untracked `lib/index.js`.

## Why Now
ADR 0044 requires local feasibility evidence before the workflow distribution model can move beyond the current CommonJS `dist/` runtime. Node.js 22.23.1 is the available proof environment, and its inability to prove the final ESM SEA entry must be isolated now so TASK-2286 can address it without a production CommonJS-wrapper detour.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: disposable TypeScript/TSX proof harness; candidate-bundler selection and ESM bundle inspection; Ink and `node:sqlite` runtime proof; source-map and non-TTY checks; repeatable timing and size evidence; explicit SEA deferral.

## Scope
- Create a clearly non-production or disposable proof directory containing the smallest TypeScript/TSX spike needed to exercise React/Ink, `node:sqlite`, one logical embedded asset, a built-in Node module, and a harmless mocked or no-op subprocess.
- Select no more than two candidate bundlers using criteria derived from ADR 0044, and retain the selected proof configuration and its warnings as evidence.
- Prove source-run and single-ESM-bundle execution on Node.js 22.23.1; inspect the bundle and runtime behavior for first-party or third-party `node_modules` loading.
- Add a forced-error path whose observed stack trace maps to a TypeScript source filename and line, and a non-TTY path that demonstrates Ink is not initialized.
- Record bundle size, cold-start timings from at least 10 runs, dependency inventory, bundler warnings, limitations, and a specific deferred ESM SEA proof reference to TASK-2286.
- Remove disposable build output or keep retained artifacts only in the identified non-production proof directory, leaving the existing CommonJS `dist/` runtime unchanged.
- Repair and test the source-checkout pre-review rebase launcher in `lib/review/rebase.ts`, and normalize the lazy handoff module import in `lib/review/review-commands.ts`; retain compiled-runtime behavior for packaged installations.

## Out of Scope
- Migrating the production CLI, workflow runtime, UI, persistence layer, or distribution pipeline to ESM, Ink, SQLite, or SEA.
- Publishing a package, producing a release artifact, or claiming release readiness from the spike measurements.
- Designing or accepting a production CommonJS wrapper as an ESM SEA workaround.
- Proving final ESM SEA support on Node.js 22.23.1; that proof belongs to TASK-2286.
- Changing production behavior outside the narrowly scoped source-runtime handoff and review launchers, or changing the current CommonJS `dist/` runtime.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A source-run TypeScript/TSX proof entry executes on Node.js 22.23.1 and imports React/Ink, `node:sqlite`, a built-in `node:` module, one logical asset, and one harmless subprocess path; its retained source and command are cited in checkpoint evidence.
- SC2: One produced ESM bundle executes the SC1 proof and the evidence identifies its bundle path, dependency inventory, and inspection result showing that neither first-party code nor third-party packages are loaded from `node_modules` at runtime.
- SC3: The proof's forced-error command emits a stack frame naming the TypeScript source file and an exact TypeScript line number through source maps.
- SC4: A non-TTY execution path completes without initializing Ink; the evidence cites the proof source location and the exact command or test that establishes this behavior.
- SC5: The retained report records the bundle byte size, 10 or more individual cold-start timing runs, candidate-bundler warnings, and the selected bundler's dependency inventory, with no claim that these measurements establish release performance.
- SC6: The report states that ESM SEA is unproven on Node.js 22.23.1, names TASK-2286 as the deferred proof owner, and does not propose or add a production CommonJS SEA wrapper.
- SC7: All retained spike files are under the explicitly named non-production proof directory or disposable outputs are removed; `dist/` remains unchanged from the mission parent commit.
- SC8: In a source checkout containing `px.ts`, `rebaseBeforeReviewRound` launches `node_modules/.bin/tsx px.ts rebase <slug> --push`, and the lazy review handoff import resolves `tsx`'s default-export wrapper. In packaged installations without `px.ts`, the rebase launcher uses compiled `dist/px.js` with Node and named handoff exports remain usable. Regression coverage verifies both module shapes and launcher paths without contacting Forgejo.

## Risks and Assumptions
- Node.js 22.23.1 may expose incompatibilities in `node:sqlite`, Ink terminal rendering, or source-map handling; a failed proof is valid evidence and must be recorded with its exact command, output context, and follow-up blocker rather than masked.
- Bundling native or Node built-ins may require externalization or bundler-specific configuration; any runtime module-loading exception must be explicit and evaluated against SC2.
- Cold-start timings vary by host load; capture all 10 or more raw run values and identify the local environment rather than treating a single value as a release benchmark.
- The harmless subprocess must not contact Forgejo, start agents, publish packages, or mutate production state; use a mocked, built-in, or no-op command only.
- This mission assumes TASK-2276 supplies any prerequisite ADR 0044 context; if it is unresolved in a way that prevents selecting proof criteria, stop and record the dependency blocker.

## Checkpoints
- CP 1: Establish the proof boundary: review ADR 0044 criteria, select at most two bundler candidates, name the non-production proof directory, and document the source-run matrix for Ink, SQLite, logical assets, built-ins, subprocesses, forced errors, and non-TTY execution.
- CP 2: Author and run the disposable TypeScript/TSX proof, build the selected single ESM bundle, and capture bundle inspection plus runtime-loading evidence for SC1 and SC2.
- CP 3: Exercise the forced-error and non-TTY paths, capture source-map and no-Ink-initialization evidence, then record bundle size, 10 or more cold-start runs, dependency inventory, and all bundler warnings.
- CP 4: Write the feasibility report with failures and limitations, explicitly defer ESM SEA to TASK-2286, remove disposable output or confine retained proof material, confirm `dist/` is unchanged, and run the required verification gate.
- CP 5: Restore and verify the source-checkout pre-review rebase launcher and lazy handoff-import fixes, document why TypeScript-first checkouts need both behaviors, and record focused regression tests plus the final verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary naming the proof directory, candidate bundler(s), commands run, and the measurement or limitation discovered in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every applicable SC1–SC7 criterion.
- Verifiable evidence forms Parallix recognizes today: file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For source-map, non-TTY, module-loading, and timing claims, pair captured shell output with a proof file:line reference, an exact test name, a test path, an ADR reference, or a recognized command/path. Raw `stat`/`ls` output or generic prose alone is not sufficient.
- A concrete `Next action:` line at the bottom, such as naming the remaining proof command, report section, cleanup action, or blocker to create.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production runtime behavior in `lib/`, `bin/`, or the existing CommonJS `dist/` output, except for the explicit `lib/review/rebase.ts` and `lib/review/review-commands.ts` source-runtime repairs required by SC8.
- Do not publish packages, create release artifacts, push branches, contact Forgejo, or invoke real agents or external workflow services.
- Do not retain proof outputs outside the named non-production proof directory, and do not add a production CommonJS wrapper for SEA.
- Do not alter ADR 0044's decision or mark ESM SEA proven on Node.js 22.23.1; record the limitation and TASK-2286 deferral instead.

## Stop Rules
- Stop and record a blocker if TASK-2276 leaves the ADR 0044 proof requirements ambiguous enough that no candidate-bundler evaluation can be made.
- Stop treating a candidate as successful if the bundle requires runtime loading of first-party or third-party code from `node_modules`, if the forced-error path lacks a TypeScript source-mapped file and line, or if non-TTY execution initializes Ink; record the exact evidence and follow-up needed.
- Stop before any production runtime, CommonJS `dist/`, package-publishing, SEA-release, Forgejo, or real-agent change; those actions require a separate authorized mission.
- Stop the ESM SEA investigation on Node.js 22.23.1 once its unsupported or unproven state is evidenced, and defer it explicitly to TASK-2286 rather than attempting a CommonJS-wrapper workaround.
- Stop the handoff repair if it would require changing Forgejo credentials, contacting Forgejo, or broadening beyond the source-checkout versus packaged-runtime compatibility decision; record the blocker instead.
