# Mission: Defer integration task promotion until after probe merge (task-2243)

## Goal
Ensure `px integrate` leaves a review-approved backlog task unchanged until its Variant B probe merge has been successfully aborted, while preserving the automatic promotion and completion of that task in the successful landed integration commit.

## Why Now
The current ordering promotes the task before the Variant B `git merge --no-commit` probe. If `git merge --abort` then fails, the primary integration checkout has both an unsafe Git state and an early mutation to the same backlog file that may overlap the probe. Task-2213 exposed this failure mode, and task-2242 identifies related races involving primary-branch backlog changes.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: focused ordering correction with a regression fixture for the abort-failure path
- Main drivers: integration lifecycle ordering, primary-checkout safety, regression coverage for a failed probe abort

## Scope
- Trace the `px integrate` lifecycle that performs review-approved task promotion, Variant B probe merge, probe abort, squash merge, and landed closeout.
- Add a regression test at `test/task-2243-probe-abort-promotion.test.js` that makes the probe abort fail and observes task-status persistence without invoking a real Forgejo service.
- Move the review-approved task promotion so it occurs only after the probe has been cleanly aborted and the successful squash merge is established.
- Preserve the successful integration path that promotes and completes the review-approved task in its landed commit.
- Capture checkpoint evidence for both the abort-failure and successful-closeout paths.

## Out of Scope
- Changing Variant A integration behavior, the semantics of `git merge --abort`, or `px rebase` recovery rules beyond the ordering required by this defect.
- Altering backlog task schemas, review approval policy, Forgejo APIs, or task-2242's independent race remediation.
- Adding compensating status rewrites, automatic cleanup, or suppression of a probe-abort Git error.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test `test/task-2243-probe-abort-promotion.test.js` contains a forced failing `git merge --abort` scenario and proves that a review-approved task file has no status mutation when the command fails.
- The integration implementation performs no review-approved task promotion before the Variant B probe merge has been successfully aborted; the ordering is demonstrated by focused test assertions or spies around promotion, `git merge --no-commit`, and `git merge --abort`.
- A successful Variant B integration still promotes and completes the review-approved task as part of the landed closeout, verified by a focused test that asserts the resulting task status and landed-commit workflow result.
- On probe-abort failure, integration surfaces the Git failure and stops without manually rewriting the task status, verified by the regression test's rejected-result assertion and unchanged task fixture.
- `./scripts/verify-local.sh all` completes successfully on the final mission tree.

## Risks and Assumptions
- Risk: promotion may be coupled to commit construction or closeout reporting; relocating it could change what is included in the landed commit. Mitigation: test the successful landed-closeout path explicitly.
- Risk: an abort-failure fixture could accidentally invoke real Git or Forgejo workflows. Assumption: the existing command and workflow boundaries can be mocked so the new unit test is fast and fully local.
- Assumption: a cleanly aborted Variant B probe is the required safety boundary before any primary-checkout backlog mutation.
- Assumption: task ownership remains workflow-managed; this mission will not edit the backlog `assignee` field.

## Checkpoints
- CP 1: Author `test/task-2243-probe-abort-promotion.test.js` before changing integration behavior. Mock the Variant B probe so `git merge --no-commit` begins and `git merge --abort` fails; assert that the review-approved task fixture retains its pre-integration status. The test must fail at the mission parent commit (red) because promotion currently occurs before the abort, and pass after the ordering fix (green).
- CP 2: Inventory the promotion, probe, abort, squash-merge, and landed-closeout call sequence; implement the minimum ordering change that defers the mutation until the safety boundary and retain the original abort error.
- CP 3: Add or adapt focused success-path coverage proving that a cleanly aborted probe followed by a successful squash merge promotes and completes the review-approved task in the landed closeout; run the required verification gate and record goal-check evidence.

Reproduction-Test: test/task-2243-probe-abort-promotion.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done, including whether the abort-failure fixture is red or green at that checkpoint
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./...` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above
- A non-generic `Next action:` line at the bottom that identifies the next lifecycle boundary or test assertion to complete

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the backlog task `assignee` field, task schema, or any unrelated task files.
- Do not make direct primary-checkout status changes outside the established integration closeout path.
- Do not call real Forgejo services or permit new unit tests to run unmocked expensive CLI or agent workflows.
- Do not change task-2242 or broaden this mission into a general integration-race redesign.

## Stop Rules
- Stop and report if the required ordering cannot be isolated without changing review approval policy, backlog schema, or Variant A behavior.
- Stop and report if the abort-failure regression cannot be expressed as a fast, mocked test under `test/` without accessing real Forgejo or a real integration checkout.
- Do not compensate for a failed `git merge --abort` by manually rewriting task status, suppressing the Git error, or continuing integration from an unsafe checkout.
- Stop before modifying unrelated integration paths when the successful landed-closeout promotion cannot be preserved with focused coverage.
