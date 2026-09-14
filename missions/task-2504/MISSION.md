# Mission: Require committed integration-gate repairs before re-verification (task-2504)

## Goal
Make an integration-gate rebound tell its implementer to commit its repair before the automatic re-verification, so a correct repair is visible to the existing finalized-tree gate.

## Why Now
Task-2497 exposed a dead-end: an implementer fixed `cwdFn` but left the repair uncommitted, and the rebound reported the repair as still failing because re-verification correctly rejects a dirty mission tree. The current prompt omits the required commit step, so the workflow asks for an outcome it does not describe.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is; the shared gate-failure prompt is the narrowest control point.
- Main drivers: one prompt-slot remedy, one regression reproduction, and existing integration-gate rebound coverage.

## Scope
- Add the commit-before-re-verify instruction and dirty-tree consequence to the `gate-failure` remedy produced by `promptSlotsFor` in `src/application/rebound-kernel.ts`.
- Preserve `routeIntegrationGateFailure`'s finalized-tree/dirty-tree verification guard.
- Add a regression test under `test/` that demonstrates the prior missing instruction and verifies the repaired gate-failure prompt.
- Update only tests and production code needed by this behavior.

## Out of Scope
- Automatically committing an implementer's working-tree changes.
- Removing, weakening, or bypassing the dirty-tree verification guard.
- Changing `hook-failure` wording, other rebound slots, integration-gate selection, or mission lifecycle policy.
- Documentation changes unless the implementation changes a durable, user-facing workflow contract.

## Success Criteria
1. The `gate-failure` rebound remedy explicitly requires the implementer to commit its repair before automatic re-verification and states that an uncommitted repair cannot be verified.
2. The regression test at `test/task-2504-repro.test.ts` fails against the mission parent behavior because the gate-failure remedy lacks the commit requirement, then passes with the required wording.
3. The dirty-tree guard exercised through `routeIntegrationGateFailure` remains in force: an uncommitted repair is rejected rather than treated as a verified integration-gate repair.
4. Existing integration-gate rebound behavior outside the `gate-failure` remedy remains covered by the affected test suite.
5. `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: the implementer owns committing its repair; the rebound must instruct it, not create a commit on its behalf.
- Risk: a broad shared-prompt edit could alter non-gate rebound messages; limit assertions and production changes to the `gate-failure` slot.
- Risk: prompt-only wording could drift later; the dedicated regression test must assert both the commit instruction and the uncommitted-repair consequence.

## Checkpoints
- CP 1: Author `test/task-2504-repro.test.ts` before any production change. Reproduce the gate-failure prompt built for an integration-gate bounce and assert it requires a commit before re-verification and identifies an uncommitted repair as unverifiable. This assertion must be red at the mission parent commit and green after the prompt change.
- CP 2: Make the smallest shared-prompt change in `src/application/rebound-kernel.ts` that satisfies CP 1; do not add an automatic-commit path or alter the dirty-tree guard.
- CP 3: Run the targeted regression coverage and required repository gates; record durable evidence for every success criterion.

Reproduction-Test: test/task-2504-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`; file:line references are accepted parenthetically but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- For CP 1, the exact reproduction-test path `test/task-2504-repro.test.ts`, its test name, and red-at-parent / green-after-fix result.
- For CP 2, `src/application/rebound-kernel.ts` and the exact test name proving the `gate-failure` remedy includes both required statements.
- For CP 3, the exact commands `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` with their outcomes.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with an accepted command, test name, ADR reference, or repository path above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Gate-failure remedy requires a committed repair | `test/task-2504-repro.test.ts`, exact regression test name | PASS |
| Required validation completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/adapters/cli/commands/integrate-gate-rebound.ts` unless focused evidence proves the prompt cannot be corrected at `promptSlotsFor`.
- Do not create commits automatically or change any finalized-tree, clean-tree, or dirty-tree policy.
- Do not change unrelated rebound slots, mission state transitions, workflow configuration, documentation, or generated graph artifacts.

## Stop Rules
- Stop and escalate if the existing test seams cannot observe the gate-failure prompt without changing lifecycle behavior or introducing a real agent/Forgejo boundary.
- Stop and escalate if the smallest prompt change cannot satisfy the red-to-green reproduction while preserving the dirty-tree guard.
- Stop and escalate before any automatic-commit behavior, clean-tree-policy change, or expansion to a non-`gate-failure` rebound slot.
