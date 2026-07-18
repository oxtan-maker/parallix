# Mission: TS migration phase T4: repo runtime, tests, and gates move to dist/ (task-2227)

## Goal
Complete phase T4 of the ADR 0044 TypeScript distribution migration: make the repository's source-checkout runtime, test entry points, verification gates, coverage gate, publish guard, and mutation scoper consume `dist/` output instead of tracked sibling JavaScript, while retaining `build:cjs` as a no-emit CommonJS compatibility check and preserving the sibling build path through a clean T4 commit rollback.

## Why Now
TASK-2226 supplies the preceding T3 migration work. T4 is the dependent cutover that removes the remaining source-checkout dependency on sibling compiled runtime files, so the repository can validate and publish the same `dist/` layout described by ADR 0044 before later migration phases build on it.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: runtime require-path cutover across package scripts and verification tooling; test and coverage entry-point alignment; diff-to-dist mutation target mapping; removal of the final tracked compiled runtime sibling; ignore/lint configuration cleanup; ADR 0049 dated layout correction; rollback compatibility.

## Scope
- Change `pretest` to run `npm run build` and change repository test require paths so tests execute against `dist/` artifacts.
- Change `scripts/verify-local.sh` integration-gate loading, `npm run test:coverage`, and `publish:guard` to load the `dist/` runtime.
- Update `lib/commands/mutation-gate.ts` so diffs to `.ts` sources select matching `dist/lib/**` mutation targets.
- Delete `lib/commands/repair-handoff.js`, then remove sibling compiled-output globs from `.gitignore` and `eslint.config.mjs` while preserving the `dist/` ignore rules.
- Keep `build:cjs` as a no-emit CommonJS compatibility check, retain the mtime guard against `dist/`, and preserve the sibling-output implementation in the pre-T4 commits for a clean phase-commit rollback.
- Add the ADR 0049 dated note that redirects its sibling-layout description to the `dist/` layout.

## Out of Scope
- Converting additional JavaScript source files to TypeScript beyond the T4 runtime-cutover edits.
- Removing `build:cjs` or its mtime guard, or eliminating the sibling-output path restored by reverting T4.
- Changing the TypeScript distribution model accepted in ADR 0044.
- Altering mutation-testing policy, ratchet thresholds, coverage thresholds, or CI/release policy beyond path changes required for `dist/` loading.
- Refactoring unrelated test behavior, publish behavior, or documentation.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `pretest` invokes `npm run build`; the test entry points require `dist/` modules; and `npm test` completes successfully using built output.
- `scripts/verify-local.sh` integration-gate module loading, `npm run test:coverage`, and `publish:guard` reference `dist/` runtime modules rather than sibling compiled runtime modules.
- `lib/commands/mutation-gate.ts` maps a changed `.ts` source under `lib/` to its corresponding `dist/lib/**` mutation target, and `./scripts/verify-local.sh mutation-gate --dry-run` succeeds.
- `lib/commands/repair-handoff.js` is absent from tracked files; no tracked compiled runtime `.js` remains outside `dist/`; and sibling compiled-output globs are absent from `.gitignore` and `eslint.config.mjs` while `dist/` remains ignored.
- `npm test`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh mutation-gate --dry-run`, and `node test/e2e-mission-lifecycle.test.js` complete successfully on the final `dist/` layout.
- ADR 0049 contains a dated note identifying that its sibling-layout description is superseded by the `dist/` layout.
- `build:cjs` and its mtime guard remain present; `npm run build:cjs` creates no sibling JavaScript during T4 review; and reverting the T4 phase commits restores a functioning sibling-output flow.

## Risks and Assumptions
- Assumption: TASK-2226 is integrated or otherwise present in this mission worktree before implementation begins; T4 must not duplicate its changes.
- Risk: an indirect `require` or shell-script path may still load a sibling runtime module after the visible test paths move to `dist/`. Mitigation: search the runtime, test, and gate call sites and run the named full and targeted gates.
- Risk: building before tests can expose stale-output or timing behavior. Mitigation: retain the existing mtime guard and demonstrate the built-output path through `npm test`.
- Risk: mutation target mapping can select a nonexistent `dist` path or stop scoping changed TypeScript files. Mitigation: cover the `.ts`-to-`dist/lib/**` mapping and run the dry-run mutation gate.
- Risk: retaining an emitting `build:cjs` command can repopulate the checkout with untracked sibling JavaScript during review. Mitigation: make the retained command no-emit in T4, keep its guard pointed at `dist/`, and verify that reverting the phase commits restores the old emitting implementation.

## Checkpoints
- CP 1: Inventory every source-checkout runtime entry point named in scope; update package scripts, test require paths, verification/coverage/publish paths, and mutation scoping to target `dist/`; add or update focused tests for the TypeScript-diff-to-`dist/lib/**` mapping.
- CP 2: Remove `lib/commands/repair-handoff.js` and obsolete sibling-output globs while retaining `dist/`, `build:cjs`, and the mtime guard; inspect tracked runtime JavaScript and configuration references for the exact removal criteria.
- CP 3: Add the ADR 0049 dated correction; run the four required runtime/static/mutation/E2E commands; validate the rollback statement by reverting the T4 phase commit in a disposable worktree or equivalent isolated checkout, then capture accepted evidence for every success criterion.
- CP 4: Correct the review-loop artifact leak by making `build:cjs` no-emit, route build freshness and integration refreshes through `dist/`, add focused regression coverage, and rerun the runtime and static-analysis gates with a clean untracked-file check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Weak-agent warning: raw `stat`/`ls` output or generic prose alone is not acceptable evidence; pair any shell output with a file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] npm test
- [x] ./scripts/verify-local.sh static-analysis
- [x] ./scripts/verify-local.sh mutation-gate --dry-run
- [x] node test/e2e-mission-lifecycle.test.js
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- Do not remove or rename `build:cjs` or its mtime guard in this phase; the retained command must not emit sibling JavaScript during the T4 review loop.
- Do not modify the ADR 0044 distribution decision; only add the scoped dated clarification to ADR 0049.
- Do not change mutation-testing thresholds, ratchet policy, coverage thresholds, or unrelated CI/release behavior.
- Do not leave compiled runtime `.js` beside source files as a replacement for the `dist/` runtime; `dist/` remains the intended generated-output location.

## Stop Rules
- Stop and request direction if TASK-2226 is not available in the worktree or conflicts with the T4 cutover assumptions.
- Stop if moving an entry point to `dist/` requires changing a public package interface, release contract, or CI policy not named in this mission.
- Stop if preserving the `build:cjs` compatibility check and mtime guard cannot coexist with the `dist/` runtime without changing the ADR 0044 decision.
- Stop if the mutation dry-run identifies target-selection behavior outside `.ts` source changes under `lib/`, rather than broadening mutation policy without approval.
- Stop if the required rollback demonstration needs a destructive history rewrite or changes outside an isolated checkout.
