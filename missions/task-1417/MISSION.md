# Mission: Prevent stale compiled JS from reaching the published package (task-1417)

Reproduction-Test: test/task-1417-stale-publish-build-check.test.js

## Goal

Make the publish path fail closed so a release cannot ship stale compiled `.js` artifacts relative to tracked `.ts` sources, while preserving a runnable installed `px` CLI. If a TypeScript-only published package is genuinely runnable without broad loader/runtime changes, that path may be chosen instead, but the default expectation is to harden the current compiled-JS distribution.

## Why Now

The backlog report shows a real release-blocking defect: `px stats` aborts in the globally installed package because compiled files in `lib/commands/*.js` are older than their corresponding `.ts` sources. That means the repository can currently reach a state where publish-time artifacts and source-of-truth drift apart. Since `package.json` already ships `lib/` and uses `prepublishOnly: npm run build:cjs`, the remaining gap is not whether a build exists, but whether the publish/integration flow guarantees that the tree being verified and the tree being packed cannot contain stale runtime files.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: live stale-build failure from installed package, publish-path correctness, `lib/` integration gate requirements, possible packaging decision between fresh JS distribution and TS-only distribution

## Scope

- Reproduce the defect with a failing regression test under `test/` that models a checkout where a `.ts` source is newer than the packaged/runtime `.js` sibling and asserts the publish/build guard fails before packaging proceeds.
- Harden the build-freshness enforcement path centered on [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts), including any call sites needed so publish-oriented flows fail closed rather than relying on operator discipline.
- Update the publish/integration path where the verified tree is captured or prepared, primarily in [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1417/lib/commands/integrate.ts), [lib/core/verification.ts](/home/magnus/code/parallix-task-1417/lib/core/verification.ts), and `package.json` scripts or packaging metadata if required by the chosen strategy.
- If the solution remains compiled-JS distribution, ensure the shipped runtime entrypoints covered by the current freshness guard stay aligned: `px.ts`/`px.js`, `index.ts`/`index.js`, and `lib/commands/*.ts` to `lib/commands/*.js`.
- If a TS-only publish path is selected instead, implement only the minimum manifest/runtime changes required to make the installed CLI runnable under supported Node versions, and remove the need to publish compiled `lib/**/*.js` artifacts.
- Update user/operator documentation that describes the release or publish path if the command sequence or packaging contents change.

## Out of Scope

- Broad migration of the project to ESM-only or loader-based TypeScript execution unrelated to publish correctness.
- Refactoring unrelated command modules or fixing generic TypeScript/ESLint issues not caused by this mission.
- Changing review, draft, handoff, or mission lifecycle behavior outside the publish/build-verification path.
- Reworking the entire package contents allowlist beyond what is required to prevent stale runtime files from shipping.
- Any source-code edits outside the files required for the publish/build-freshness fix, the regression test, and supporting docs.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test at `test/task-1417-stale-publish-build-check.test.js` fails on the mission parent commit and passes after the fix. The test must create or simulate a stale pair where a `.ts` file is newer than its packaged/runtime `.js` counterpart and assert the publish/build guard rejects that state.
- Exactly one publish strategy is implemented and verified:
  - Fresh-JS strategy: the package still ships runnable `.js` entrypoints, and the publish path rejects stale compiled artifacts before pack/publish completes.
  - TS-only strategy: the published package no longer depends on shipped compiled `.js` artifacts under `lib/`, and the installed `px` CLI remains runnable on the supported Node version declared in `package.json`.
- For the fresh-JS strategy, the enforcement covers the same runtime surfaces named in [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts): `px`, `index`, and every `lib/commands/*.ts` sibling pair. A stale or missing sibling in any of those locations must produce a non-zero failure.
- The chosen publish path is wired into the real release flow rather than a dead helper. At least one existing publish/integration entry path in [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1417/lib/commands/integrate.ts) or `package.json` must invoke the guard or packaging change directly.
- `./scripts/verify-local.sh static-analysis` passes on the final tree because the mission modifies files under `lib/`.
- `./scripts/verify-local.sh all` passes on the final tree.
- If publish/operator documentation changes, the updated document names the actual command or guard behavior that now prevents stale artifacts from being released.

## Risks and Assumptions

- Risk: `prepublishOnly` already runs `npm run build:cjs`, so the real defect may sit in a different pack/publish/integration path than the obvious npm publish path. Assumption: reading `integrate.ts`, verification helpers, and packaging metadata will identify the actual release path that bypasses sufficient freshness guarantees.
- Risk: a TS-only published package may require loader flags, `tsx`, or a Node execution model that is broader than this mission allows. Assumption: if that happens, the mission should fall back to fresh-JS enforcement rather than forcing a runtime architecture change.
- Risk: tests that mutate timestamps or fixture files can become flaky across filesystems. Assumption: the reproduction test can control mtimes or use temporary fixtures deterministically enough to be reliable in CI and local runs.
- Risk: the current freshness guard only scans `lib/commands/*.ts`; other runtime `.ts` sources may also matter. Assumption: this mission preserves or deliberately expands the current enforcement boundary, but does not silently narrow it.
- Risk: changing package contents or release hooks can affect downstream docs and install expectations. Assumption: any operator-facing change can be captured with a small documentation update rather than a new ADR.

## Checkpoints

- CP 1: Author `test/task-1417-stale-publish-build-check.test.js` as a red reproduction. Scenario: create a temporary package/worktree fixture with a `.ts` source newer than its packaged/runtime `.js` sibling in the guarded surface (for example a `lib/commands/*.ts` pair), run the publish/build-freshness entrypoint used by the product, and assert it exits non-zero with a stale-build signal on the parent commit; after the fix, the same test remains green because the stale state is caught intentionally and the guarded happy-path behavior is preserved.
- CP 2: Trace and pin the real release path. Confirm whether the defect is prevented by hardening [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1417/lib/core/build-freshness.ts), by invoking it from an existing publish/integration path in [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1417/lib/commands/integrate.ts) or `package.json`, or by replacing shipped compiled artifacts with a TS-only runnable package.
- CP 3: Implement the chosen packaging strategy. Prefer fail-closed fresh-JS enforcement; only choose TS-only distribution if `px` remains runnable on supported Node without introducing a broad new runtime dependency or loader regime.
- CP 4: Update any affected publish/operator docs so the release path and guard behavior match the code.
- CP 5: Run final verification: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `missions/`, `backlog/`, and other workflow state files beyond task-1417 artifacts: do not modify except where this mission workflow requires status/doc updates.
- Unrelated `lib/commands/*.ts` modules: do not refactor behavior outside the publish/build-freshness path.
- `docs/adr/`: do not add or rewrite ADRs unless the mission uncovers an unavoidable architecture decision that cannot be documented in existing operator docs.
- Dependency set and package-manager model: do not introduce new runtime dependencies unless a TS-only packaging path proves impossible without one and the change is explicitly justified by the success criteria.
- Generated build output not required by the fix: do not churn unrelated compiled files just to silence the symptom.

## Stop Rules

- Stop if the only way to make a TS-only package runnable is a broader runtime migration such as new loaders, bundling, or ESM/CJS architecture changes that exceed publish-path hardening.
- Stop if the reproduction cannot be made deterministic without altering unrelated test infrastructure; split the test harness work into a separate task rather than shipping a flaky regression test.
- Stop if the suspected publish path is not actually used by the product's release workflow; re-scope to the real path before editing code.
- Stop if fixing the stale-artifact defect requires changing package contents in a way that breaks the installed `px` entrypoint under the supported Node engine.
