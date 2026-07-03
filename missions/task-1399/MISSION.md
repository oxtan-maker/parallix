# Mission: Reconcile Remaining TypeScript Debt With The Current Tree (task-1399)

## Goal
Establish whether the backlog claim about "remaining TypeScript errors" is still true on the current branch, then fix every reproducible TypeScript diagnostic that still exists in the repo-owned source of truth. The mission must start from the current verification surface (`npm run typecheck` and `./scripts/verify-local.sh static-analysis`), repair only real failures that reproduce on the mission parent commit, and finish with a clean typed tree plus captured proof.

## Why Now
The backlog task title no longer matches the visible repository state: `index.ts` and `px.ts` are already migrated, `tsconfig.json` includes the root TypeScript entrypoints, and the only `lib/*.js` file left on disk is `lib/commands/repair-handoff.js`, which already has a paired `lib/commands/repair-handoff.ts` source file. Leaving a stale "lots of TypeScript errors left" task in backlog is costly in two ways: it invites speculative changes, and it hides whether any real type debt remains behind generated-artifact drift or caller interop issues. This mission converts that ambiguity into a verified answer and, if errors still exist, closes them with the repo’s required `lib/` gate.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: stale backlog wording vs current tree reality, `lib/` static-analysis gate, possible source/artifact drift around `repair-handoff`, and the need for exact baseline proof before changing code

## Scope
- Establish the current baseline with `npm run typecheck` and `./scripts/verify-local.sh static-analysis`, and record the exact reproducible TypeScript diagnostics by file and TS code if any exist.
- Fix only TypeScript errors that reproduce on the mission parent commit in files that participate in the typed runtime surface: `index.ts`, `px.ts`, `lib/**/*.ts`, and any directly-coupled tracked runtime artifact that must stay aligned with the edited TypeScript source.
- If the remaining issue is source/artifact drift, reconcile the tracked compiled artifact only for modules whose TypeScript source changed in this mission, with `lib/commands/repair-handoff.{ts,js}` treated as the first suspected seam because it is the only `lib/*.js` file still tracked.
- Preserve current CLI/runtime compatibility for touched modules, especially `require('../lib/commands/repair-handoff')`, `lib/index.ts` re-exports, and any active callers in `lib/commands/active.ts`.
- Update or add focused tests only where needed to lock behavior for touched type-fix surfaces.

## Out of Scope
- Broad refactors or cleanup that do not remove a currently reproducible TypeScript diagnostic.
- Rewriting workflow behavior, mission orchestration, or review/integration flows unless a reproducible type error forces a narrowly-scoped signature/import fix there.
- Deleting tracked compiled artifacts globally as a style cleanup; only reconcile artifacts that are directly affected by in-scope source changes.
- Changing backlog ownership metadata (`assignee`) or transitioning task state.
- Starting review, execute, or integrate phases.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC 1: The first checkpoint captures the mission-parent baseline from `npm run typecheck` and `./scripts/verify-local.sh static-analysis`, including either `0` TypeScript diagnostics or an enumerated list of each reproducible `error TS...` line with owning file.
- SC 2: On the final tree, `npm run typecheck` exits `0` and produces no `error TS` lines.
- SC 3: On the final tree, `./scripts/verify-local.sh static-analysis` exits `0` and reports `PASS` for ESLint, tsc typecheck, and test-hygiene.
- SC 4: If this mission modifies `lib/commands/repair-handoff.ts` or any other typed runtime module with a tracked compiled `.js` counterpart, the corresponding runtime consumer behavior remains intact: affected `require()`/import entrypoints used by existing tests still load and expose the same callable/default-vs-named surface as before.
- SC 5: Every test file touched or added for this mission passes, and at minimum the focused suites for any touched `repair-handoff`/handoff/active interop surface pass if those files are changed.
- SC 6: `./scripts/verify-local.sh all` exits `0` on the final tree.
- SC 7: The final checkpoint Goal Check table can map each fixed baseline diagnostic from CP 1 to concrete proof of removal or explicitly state that CP 1 found zero reproducible TypeScript errors and the mission therefore closed a stale backlog claim instead of inventing code changes.

## Risks and Assumptions
- Assumption: `npm run typecheck` and `./scripts/verify-local.sh static-analysis` are the authoritative ways to surface current TypeScript debt in this repo.
- Assumption: `lib/commands/repair-handoff.ts` is the source of truth and `lib/commands/repair-handoff.js` is a tracked emitted/runtime artifact, not an independently-maintained source file.
- Risk: The backlog item may be fully stale, in which case the mission becomes a validation-and-close exercise rather than a code-fix exercise.
- Risk: Fixing one NodeNext import or type shape can cascade into consumer modules such as `lib/index.ts`, `lib/commands/active.ts`, or root entrypoints.
- Risk: Tracked compiled artifacts under ignored `lib/**/*.js` paths can drift from their `.ts` source and confuse whether a failure is in source code, build output, or interop assumptions.

## Checkpoints
- CP 1: Baseline the current tree. Run `npm run typecheck` and `./scripts/verify-local.sh static-analysis`, capture exact diagnostics, and decide whether the task is real debt or a stale backlog claim.
- CP 2: Repair the first reproducible TypeScript error cluster in source-of-truth files only, adding or updating focused tests for the touched seam.
- CP 3: Reconcile any required runtime artifact or interop fallout from CP 2, including `repair-handoff` CJS/ESM surface compatibility if that module was touched.
- CP 4: Re-run the full mission gates, confirm zero remaining reproducible TypeScript diagnostics, and produce the final Goal Check evidence table.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify files outside the current reproducible TypeScript-failure path.
- Do not change backlog task state or the backlog `assignee` field.
- Do not perform speculative generated-artifact cleanup outside files directly tied to in-scope source edits.
- Do not alter mission/review harness behavior unless a current type error requires a narrow compatibility fix there.

## Stop Rules
- Stop immediately if CP 1 finds that `npm run typecheck` is already clean and `./scripts/verify-local.sh static-analysis` has no TypeScript failure; record the backlog item as stale rather than making speculative source edits.
- Stop if fixing an in-scope diagnostic requires a broad architectural rewrite across unrelated subsystems instead of a targeted type/interface/import correction.
- Stop if the source-of-truth policy for a touched tracked `.js` artifact cannot be resolved from the existing build/runtime contract; escalate instead of editing both sides blindly.
- Stop if `./scripts/verify-local.sh static-analysis` fails for reasons unrelated to the touched TypeScript-error path and cannot be cleanly isolated from pre-existing repo state.
