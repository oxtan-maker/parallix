# Mission: Restore a working post-integrate publish/self-update flow (task-2206)

## Goal

First identify the real blocking defect in the current post-integrate self-hosting publish path, then fix it so the configured hook completes successfully: after a successful `px integrate`, the hook must be able to bump the version, rebuild, pack the checkout, and install the resulting tarball without manual repair steps.

## Why Now

The current intent of the hook wired through `workflow.config.json` is straightforward: a successful integrate in this repo should refresh the operator's global `px` runner from the newly integrated checkout. Right now that path is broken. The backlog evidence shows the hook reaches `npm pack` / `publish:guard` / `npm install -g`, but the overall publish/self-update sequence does not complete successfully when it should. The current mission draft over-commits to one suspected root cause (`process.exit()` inside `build-freshness`) and forbids touching the hook script itself, which makes it unlikely to restore the actual end-to-end behavior. This mission should instead stay anchored on the product outcome: post-integrate publish must work again, and the execution phase must identify and fix the real blocking seam.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: success depends on restoring the real self-hosting path rather than locking onto a single pre-diagnosed mechanism
- Main drivers: `scripts/refresh-global-px.sh`, `package.json` publish hooks, `lib/core/build-freshness.ts`, and existing self-hosting regression coverage around tasks 1417, 1424, and 2203

## Scope

- Reproduce and diagnose the broken post-integrate publish/self-update path with deterministic automated coverage under `test/`, using isolated fixtures or stubs rather than mutating the real checkout or the operator's global npm install.
- Identify the real failure boundary across the self-hosting flow before committing to an implementation strategy:
  `scripts/refresh-global-px.sh`,
  `package.json` publish hooks,
  `lib/core/build-freshness.ts`,
  and any small supporting helper surface directly involved in pack/install success.
- Implement the smallest safe fix or set of fixes needed so the hook's intended happy path succeeds again when the tree is in a valid publishable state.
- Preserve fail-closed behavior for genuinely invalid publish states: if the tree is stale or otherwise unpublishable, the flow must still stop non-zero, but it must do so at the correct seam and without corrupting the subsequent install step.
- Update existing tests and any focused docs that describe the self-update flow if the implementation or failure/reporting contract changes.

## Out of Scope

- Rewriting the entire integrate lifecycle or replacing the configured post-integrate hook model.
- Broad npm packaging redesign unrelated to making the current self-hosting publish/install path work.
- Weakening publish guards or bypassing them with `PARALLIX_SKIP_BUILD_CHECK=1`.
- Unrelated cleanup in `lib/commands/integrate.ts`, review flow, or mission workflow state.
- Changing global-install strategy away from local tarball install unless the mission proves the current strategy cannot be repaired within bounded scope.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- A new or updated automated regression test reproduces the current task-2206 self-hosting failure on the mission parent commit and passes after the fix. The test must exercise the real publish/self-update seam closely enough to prove the path is broken before the implementation change.
- The mission records the concrete root cause with specific code references in the first checkpoint artifact or execution notes before the implementation checkpoint begins.
- After the fix, the validated happy path completes all intended post-integrate self-update steps for a publishable tree: version bump, build, pack, and tarball-based install are all reached and the flow exits successfully in the test harness.
- After the fix, an invalid publish state such as a stale-build rejection still fails non-zero, but the failure is attributed to the real blocking condition and does not devolve into a secondary corrupted-install symptom.
- The final implementation remains wired to the real product path:
  `workflow.config.json` still points to `./scripts/refresh-global-px.sh`,
  and the regression coverage proves the repaired behavior through that hook contract rather than through a dead helper.
- `./scripts/verify-local.sh all` passes on the final tree.
- If the final fix changes any operator-visible hook behavior or debugging expectations, the affected docs are updated and `./scripts/verify-local.sh docs` passes.

## Risks and Assumptions

- Risk: the failure may involve more than one seam across hook script, npm pack behavior, and freshness guard behavior. Assumption: the mission can still stay bounded by following the real publish path rather than treating each subsystem as a separate redesign.
- Risk: a fully realistic end-to-end test is destructive because the real script bumps versions, commits, and installs globally. Assumption: the failure can be reproduced with temp fixtures, stub executables, or extracted seams while still proving behavior of the real hook contract.
- Risk: earlier tasks already changed nearby behavior for proof ordering and installed-package freshness. Assumption: those fixes remain valid and this task is about restoring the remaining broken self-update path, not undoing them.
- Risk: the correct fix may touch the hook script, publish guard behavior, or both. Assumption: the mission should allow that flexibility instead of banning likely solution areas up front.

## Checkpoints

- CP 1: Reproduce the current failure and identify the root cause. Author or update regression coverage that locks the current task-2206 failure in place, and document the concrete blocking seam with specific file references before implementation starts.
- CP 2: Implement the minimal fix set required by the CP-1 diagnosis to make the publishable happy path succeed while keeping invalid-tree failures fail-closed.
- CP 3: Update focused docs if needed and run final verification.

## Gates

- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not bypass the publish guard with `PARALLIX_SKIP_BUILD_CHECK=1`.
- Do not change `workflow.config.json` to disable or sidestep the checked-in post-integrate hook.
- Do not broaden the mission into unrelated integrate-flow redesign outside the self-hosting publish/install path.
- Do not replace the local-tarball install strategy unless execution proves it is the root blocker and cannot be repaired in place.

## Stop Rules

- Stop if the regression test cannot reproduce the current failure closely enough to distinguish a real fix from guesswork.
- Stop if the only viable way to make the hook "succeed" is to skip or weaken protection for invalid publish states.
- Stop if execution proves the configured post-integrate self-update contract itself is wrong and requires a broader product decision rather than a bounded repair.
- Stop if pre-existing unrelated failures in the required gates prevent attribution of the result to this mission's diff.
