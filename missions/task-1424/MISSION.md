# Mission: Make post-integrate self-update publish/install path succeed without stale-build false positives (task-1424)

Reproduction-Test: test/task-1424-post-integrate-publish-reinstall.test.js

## Goal
Repair parallix's post-integrate self-update path so a successful `px integrate` can bump the package version, build, pack, install the tarball globally, and leave a runnable installed `px` without tripping the stale-build guard or leaving stray `.tgz` artifacts behind.

## Why Now
The current product release path is broken in a user-visible way. After task-1417, `npm pack`/`prepack` correctly fail closed on stale compiled output, but the repo's real self-update flow in `scripts/refresh-global-px.sh` still produces an installed package whose runtime freshness check can fail after install because tarball extraction preserves older mtimes for shipped `.js` files than their bundled `.ts` sources. The backlog report also notes leftover tarballs when the hook fails. This means successful integration does not currently yield a usable upgraded global `px`, which blocks the workflow the repo explicitly documents and automates.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: real post-integrate hook failure, installed-tarball mtime false positives, tarball cleanup on failure, `lib/` static-analysis gate

## Scope
- Lock the bug with a failing regression test under `test/` that exercises the post-pack/install runtime path, not just `prepublishOnly` in a fixture checkout.
- Fix the stale-build false positive in the shipped/install-time experience, centered on the runtime freshness contract in [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1424/lib/core/build-freshness.ts) and the post-integrate self-update flow in [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-1424/scripts/refresh-global-px.sh).
- Update any supporting tests that currently rely on manual timestamp touching after tarball install, especially [test/package-persistent-data.test.js](/home/magnus/code/parallix-task-1424/test/package-persistent-data.test.js) and [test/refresh-global-px-script.test.js](/home/magnus/code/parallix-task-1424/test/refresh-global-px-script.test.js), if the chosen fix changes the contract they assert.
- Ensure the post-integrate flow removes its temporary tarball on both success and failure paths, or otherwise proves no leftover `.tgz` remains in the repo root after the script exits.
- Update operator-facing documentation that currently states every successful `px integrate` rebuilds, packs, and reinstalls the global runner if the exact command sequence or freshness semantics change.

## Out of Scope
- Replacing the compiled-JS distribution model with a TypeScript-only runtime or a broader loader/bundler architecture.
- Refactoring unrelated command behavior in `lib/commands/` outside the freshness/publish/install path.
- Changing mission workflow phases, review flow, or integration policy beyond what is required for this self-update bug.
- Adding registry-publish automation, CI release automation, or broader packaging redesign.
- Fixing unrelated stray-file cleanup outside the tarball created by the self-update script.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test at `test/task-1424-post-integrate-publish-reinstall.test.js` fails on the mission parent commit and passes after the fix. The test must model the real packaged-runtime scenario: build a tarball or install fixture, install it, invoke the installed runtime path, and assert the pre-fix tree fails with a stale-build signal while the fixed tree does not.
- A packaged install produced by the supported local-tarball flow no longer requires ad hoc `utimes`/`touch` repair of installed `.js` artifacts just to make the runtime freshness check pass. Any previous test helper that manually touches installed `.js` files is removed or reduced to a negative-control assertion rather than part of the happy path.
- The shipped runtime freshness behavior is deterministic for the supported surfaces currently guarded by [lib/core/build-freshness.ts](/home/magnus/code/parallix-task-1424/lib/core/build-freshness.ts): `px.ts`/`px.js`, `index.ts`/`index.js`, and every `lib/commands/*.ts` to `.js` pair. The chosen fix must either preserve these checks for installed packages or narrow them only with an explicit, documented rationale tied to packaged-runtime semantics.
- [scripts/refresh-global-px.sh](/home/magnus/code/parallix-task-1424/scripts/refresh-global-px.sh) completes its pack/install workflow without leaving the generated tarball in the repo root when the install succeeds, and it also cleans up that tarball if any later step in the script fails.
- The automated self-update path remains wired to the real product flow. The final code and tests must show that `workflow.config.json` still points to `./scripts/refresh-global-px.sh`, and that the script still performs version bump, packaging, and global reinstall in a way compatible with the fix.
- `./scripts/verify-local.sh static-analysis` passes on the final tree because the mission touches `lib/`-governed behavior or tests around it.
- `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: the stale-build failure after install may be an inherent property of tarball mtimes rather than a narrow script bug. Assumption: the mission can still solve it by changing the freshness heuristic, package contents, install-time normalization, or another bounded mechanism without replacing the runtime model.
- Risk: relaxing the freshness check too far could reopen task-1413/task-1417 regressions for source checkouts. Assumption: checkout/runtime protection and installed-package behavior can be distinguished without losing fail-closed guarantees for active development trees.
- Risk: executing the real self-update script in tests is destructive because it bumps versions, commits, packs, and installs globally. Assumption: the regression can be locked with isolated temp directories, fixture installs, or extracted helper logic rather than calling the destructive path against the working repo.
- Risk: cleanup-on-failure in shell code is easy to miss if the script exits before `rm -f "${TARBALL}"`. Assumption: a trap-based or equivalent cleanup approach is feasible without changing the documented workflow.
- Risk: docs currently describe the hook as an unconditional success path. Assumption: only a focused update to [docs/authority-reference.md](/home/magnus/code/parallix-task-1424/docs/authority-reference.md) is needed if semantics change.

## Checkpoints
- CP 1: Author `test/task-1424-post-integrate-publish-reinstall.test.js` as the red reproduction. Scenario: create an isolated pack/install fixture from the current repo, install the tarball the same way the self-update path does, invoke the installed `px` runtime (or the same guarded runtime entrypoint), and assert that the mission parent commit fails with the stale-build error seen in the backlog while the fixed tree passes. The failing assertion must specifically prove this is an installed-package/runtime problem, not merely a stale checkout problem.
- CP 2: Identify the minimal correction point. Decide whether the bug should be fixed in the runtime freshness heuristic, in the package/install artifact normalization, in the self-update script sequencing/cleanup, or in a small combination of those, while preserving the checkout-side stale-build guard.
- CP 3: Implement the packaged-runtime/self-update fix and update the existing supporting tests that currently encode the broken behavior, including tarball cleanup expectations.
- CP 4: Update publish/self-update documentation so it matches the actual supported flow after the fix.
- CP 5: Run final verification: the mission regression test, any directly affected packaging/self-update tests, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all`.

## Gates
- [ ] node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change unrelated command logic in `lib/commands/*.ts`; stay inside freshness, packaging, install, and self-update behavior.
- Do not replace the `workflow.config.json` hook model with a different integration mechanism.
- Do not introduce a new runtime dependency, loader, or bundler unless the mission proves there is no bounded fix within the current packaging model.
- Do not edit backlog ownership fields or unrelated workflow state files.
- Do not paper over the bug by setting `PARALLIX_SKIP_BUILD_CHECK=1` in the self-update path or tests for the supported happy path.

## Stop Rules
- Stop if the only viable fix is a broader runtime architecture change such as TS-only execution, a custom loader, or bundling beyond the mission's bounded publish/install scope.
- Stop if the regression cannot be reproduced deterministically in an isolated install fixture; split test-harness work into a separate task rather than shipping an unprovable mission.
- Stop if preserving checkout-side stale-build protection and fixing installed-package false positives turn out to be mutually exclusive under the current distribution contract; escalate that as an architecture decision instead of silently weakening the guard.
- Stop if the self-update flow cannot be made non-leaky for tarballs without changing package-manager behavior outside the repo's supported install path.
