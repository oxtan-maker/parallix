# Mission: Fix mistral/vibe re-blocklisting after the usage block was lifted (task-1398)

## Goal

Reproduce and fix the real code path that causes `mistral`/`vibe` to loop back into the persistent agent blocklist after the known usage block was lifted. The fix must be driven by an observed failing case in the current tree, not by treating one prior theory as settled fact.

## Why Now

The backlog task intent is narrow and concrete: `mistral` is unblocked, but it "still ends up in blocklist all the time," so something in the `mistral`/`vibe` handling is still wrong. The currently drafted theory may still describe a real defensive improvement, but it does not yet explain the present looping symptom with enough evidence to be the mission's assumed root cause. This mission needs to be recentered on the actual failure mode: `vibe` repeatedly re-entering the blocklist after the original usage-limit condition is gone.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate only as a reproduction-first bug mission
- Main drivers: persistent user-facing regression, prior mission likely fixed the wrong thing, current root cause not yet demonstrated

## Scope

### In scope

1. Reproduce the current failure on the mission branch with a focused test or hermetic harness that shows `mistral`/`vibe` is blocklisted again when it should not be.
2. Trace the exact path from launcher result to persistent blocklist write for `mistral`, including whichever of these surfaces are actually involved:
   - `lib/agents/agents.ts`
   - `lib/agents/limit-hit.ts`
   - `lib/agents/mistral.ts`
   - any shared launcher/error-classification helper already used by `startAgent`
3. Treat the current mission draft's non-limit launch-failure hypothesis as a candidate to validate or eliminate, not as a required implementation direction.
4. Fix only the logic required to stop false persistent blocklist writes for the reproduced `mistral`/`vibe` case.
5. Add or update regression coverage that proves the reproduced case fails before the fix and passes after it.
6. Update mission-local documentation or comments only if the final fix changes operator-visible behavior or clarifies a non-obvious guard.

### Out of scope

- Treating one hypothesized non-limit launch-failure path as the answer before the looping behavior is reproduced
- Inventing new `vibe`/`mistral` stderr patterns without evidence from the reproduction
- Broad rewrites of agent selection, launcher ordering, or unrelated fallback behavior
- Changing block duration, blocklist file schema, or migration format unless the reproduction proves that one of those is the bug
- Telemetry-only fixes that do not affect the persistent re-blocklisting symptom
- Touching unrelated agent families unless shared logic must change to fix the reproduced bug correctly

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- [ ] A focused reproduction exists that fails on the pre-fix tree and demonstrates the reported symptom: `mistral`/`vibe` is persistently blocklisted again after the usage block was lifted.
- [ ] The final code change is tied to the reproduced path with concrete file references, not just to a plausible but unproven theory.
- [ ] The reproduced case passes after the fix and no longer writes an incorrect persistent blocklist entry for `mistral`.
- [ ] Genuine usage-limit handling for `mistral` still works after the fix; an existing or updated test proves real limit hits still block when they should.
- [ ] No `.only` or bare `.skip` markers are introduced.
- [ ] `./scripts/verify-local.sh all` passes on the final tree.
- [ ] If any file under `lib/` changes, `./scripts/verify-local.sh static-analysis` passes on the final tree.
- [ ] Final checkpoint evidence cites real file:line references and real test names.

## Risks and Assumptions

- **Risk:** The bug may not be in the non-limit launch-failure path; it could be in limit-hit classification, launcher status handling, persisted blocklist reads/writes, retry behavior, or a mistral-specific wrapper path. Mitigation: require a red reproduction before locking the fix direction.
- **Risk:** Shared agent-family logic may need a small change that affects more than `mistral`. Mitigation: allow shared changes only when they are required by the reproduced path and covered by tests.
- **Assumption:** The user report is accurate that the usage block itself is no longer the active reason for blocking, so a fresh re-blocklisting path still exists in code.
- **Assumption:** The current branch has enough test seams to simulate the `mistral`/`vibe` failure mode without requiring live access to the external launcher.

## Checkpoints

- **CP 1 (Red):** Capture a focused reproduction for the current branch. Prefer a test under `test/` that drives `startAgent` or the smallest responsible helper and proves the wrong persistent blocklist write for `mistral`.
  - Reproduction-Test: `test/` file to be chosen by the implementer once the failing path is identified
- **CP 2 (Root Cause):** Identify the actual decision point that turns the reproduced `mistral`/`vibe` condition into a persistent blocklist write. Document the responsible file and branch condition in the checkpoint evidence, and explicitly state whether the prior non-limit launch-failure theory was confirmed or ruled out.
- **CP 3 (Green):** Apply the smallest correct fix, keep real usage-limit blocking intact, and make the reproduction pass.
- **CP 4 (Verification):** Run the required verification gates and record concrete evidence with test names and file:line references.

## Gates

- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis` if any file under `lib/` changes

## Restricted Areas

- Do not hardcode new `mistral`/`vibe` error-pattern assumptions unless the reproduction captures those exact strings.
- Do not edit runtime data files such as `agents.local.json` as the "fix".
- Do not change unrelated launcher implementations or fallback policy to make the symptom disappear indirectly.
- Do not treat prior mission text as evidence; use current-tree behavior and tests.

## Stop Rules

- Stop if no reliable reproduction can be created from the current tree; the mission is not ready for implementation without a sharper failure capture.
- Stop if the only available fix is a broad heuristic expansion with no demonstrated causal link to the reproduced symptom.
- Stop if the investigation shows the report depends on external state that is not represented in the repo or test seams; capture that gap explicitly and re-refine the task instead of guessing.
