# Mission: Restore cross-family reviewer selection (task-2335)

## Goal
Restore the review workflow behaviour that task-2322.12 regressed: when a review is started, it must apply the configured reviewer-selection policy and select a reviewer from a different agent family than the PR author whenever an eligible cross-family reviewer exists. The workflow must use the documented corner-case fallback only when no such reviewer is eligible.

## Why Now
The regression causes agents to review their own PRs repeatedly, defeating independent review and ignoring configured selection behaviour. It affects every review created through the workflow, so it should be corrected before further missions rely on review outcomes.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: identify the task-2322.12 reviewer-selection regression, preserve configuration application, enforce cross-family selection, and cover documented fallback cases with focused tests.

## Scope
- Trace the review-launch and reviewer-selection path changed by task-2322.12.
- Restore application of the repository's configured reviewer-selection policy when a review is launched.
- Ensure normal selection excludes the PR author's agent family and randomly chooses among eligible reviewers from other families.
- Preserve the documented fallback behaviour for cases with no eligible cross-family reviewer.
- Add focused regression coverage for normal cross-family selection, configuration application, and the no-cross-family fallback.
- Update workflow documentation only where it describes behaviour changed by this fix.

## Out of Scope
- Changing how agent families are defined, registered, or persisted.
- Changing reviewer eligibility rules unrelated to author-family exclusion.
- Reworking the review workflow, review UI/output format, or random-selection algorithm beyond the regression fix.
- Adding new reviewer configuration options or changing existing configuration defaults.
- Altering unrelated agent scheduling, execution, integration, or Forgejo behaviour.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A focused regression test demonstrates that, with an author in family A and eligible reviewers in family A and at least one other family, review selection never returns a family-A reviewer and returns an eligible reviewer from a different family; the test is red at the mission parent commit and green after the fix.
- The review-launch path reads and applies the existing reviewer-selection configuration instead of unconditionally assigning the initiating/authoring agent.
- When two or more eligible reviewers from families other than the author family are available, the selection path uses the repository's random-selection mechanism over that eligible cross-family set; tests control randomness and assert the candidate set passed to selection.
- When no eligible reviewer from a different family exists, selection follows the repository's documented corner-case fallback and does not enter an unbounded reassignment/review loop; a focused test asserts the resulting fallback outcome.
- Existing focused review-workflow tests and `./scripts/verify-local.sh all` pass on the final tree, with no `.only` or bare `.skip` introduced in changed tests.
- Any documentation changed by the mission states the restored cross-family selection rule and the no-eligible-cross-family fallback consistently with the implementation.

## Risks and Assumptions
- Assumption: the repository already has a configured reviewer-selection policy and a documented fallback; implementation must locate and follow those sources rather than inventing a policy.
- Risk: reviewer selection may be shared with handoff or launch paths, so a narrow fix can accidentally alter non-review routing. Mitigation: map call sites before changing selection code and use focused mocks.
- Risk: random choice can make tests flaky. Mitigation: inject or mock the randomness boundary and assert the eligible candidate set.
- Risk: a fallback intended for unavailable agents may be mistaken for ordinary self-review. Mitigation: test both the normal eligible-cross-family path and the zero-eligible-cross-family path separately.

## Checkpoints
- CP 1: Lock the regression before any fix. Add `test/task-2335-reviewer-family-repro.test.js`, reproducing a review authored by an agent in family A while an eligible same-family agent and an eligible other-family agent are available. Assert that selection does not return a family-A reviewer and selects the eligible other-family candidate. Run the focused test at the mission parent commit and record its failing assertion (red); do not change production selection code in this checkpoint. Reproduction-Test: test/task-2335-reviewer-family-repro.test.js
- CP 2: Map the review-launch, configuration, and reviewer-family eligibility flow; identify the task-2322.12 change that bypasses configuration or collapses the candidate set to self-review. Record the relevant file:line references and the documented no-cross-family fallback before editing implementation.
- CP 3: Make the smallest implementation change that restores configuration application and builds the eligible cross-family candidate set before random selection. Extend focused tests to control randomness and verify the selected candidate set excludes the author family.
- CP 4: Cover the documented no-eligible-cross-family fallback, update affected workflow documentation if needed, run the required gate, and capture final goal-check evidence.

Reproduction-Test: test/task-2335-reviewer-family-repro.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify agent-family definitions, reviewer configuration schema/defaults, or unrelated launch/handoff routing unless the review-selection call path makes a minimal compatibility edit unavoidable.
- Do not access real Forgejo or start real agents from unit tests; mock workflow, CLI, and remote dependencies.
- Do not change the mission workflow state machine, review approval semantics, or integration gates as part of this regression fix.

## Stop Rules
- Stop and request direction if the existing configuration has no reviewer-selection policy that can be applied, or if documentation and implementation prescribe incompatible fallback outcomes.
- Stop and request direction if restoring cross-family selection requires a configuration-schema/default change, agent-family model migration, or changes outside the review workflow.
- Stop and request direction if no deterministic test seam can be added without redesigning the randomness or workflow architecture beyond this mission's scope.
