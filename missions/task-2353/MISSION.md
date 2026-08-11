# Mission: Re-bounce deterministic review-gate failures to the implementer (task-2353)

## Goal
When a declared pre-review verification gate fails deterministically, Parallix must return the failure to the implementer for repair, consume the configured retry budget, and resume the review loop after a successful repair instead of stopping for human intervention.

## Why Now
The current review workflow reports that it relaunched the implementer after a declared gate failure, then stops autonomous review. The diagnostic also incorrectly describes the failure as a Git-hook failure. This leaves recoverable test and static-analysis failures to a human and makes the retry mechanism unreliable at the handoff boundary.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Deterministic failure mode, concrete production transcript, and a bounded workflow seam make this ready for implementation.
- Main drivers: declared-gate failure classification; implementer relaunch/retry accounting; review-loop continuation; accurate repair diagnostics; focused mocked regression coverage

## Scope
- Add a focused regression test at the declared reproduction-test path that simulates a pre-review declared gate returning exit status 1 after a pull request already exists.
- Repair the autonomous review/rebounce control flow so that this deterministic gate failure sends the recorded gate command, output, classification, retry attempt, review disposition, and branch revision to the implementer.
- Ensure a successful implementer repair causes the rebase and declared gate to run again and allows the review loop to advance to the next review round.
- Correct diagnostics so a declared-gate failure is not labelled as a Git-hook failure unless the failing operation is actually a Git hook.
- Preserve the configured maximum retry limit and the existing escalation to human intervention after the limit is exhausted or for failures that are not eligible for automatic repair.

## Out of Scope
- Changing declared gate commands or weakening `./scripts/verify-local.sh static-analysis` to make the sample failure pass.
- Repairing the stale consumer citation that triggered the recorded task-2332.07 failure.
- Changing Forgejo pull-request creation, reviewer selection, or unrelated review findings handling.
- Broad redesign of agent prompts, retry policy, or mission lifecycle states beyond the deterministic declared-gate rebounce path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2353-rebounce-reproduction.test.ts` fails at the mission parent commit because a deterministic declared pre-review gate failure ends the autonomous review instead of completing the configured rebounce-and-resume flow, then passes with the fix.
- For a declared gate that exits with status 1 while a pull request already exists, the workflow relaunches the same implementer with the failing gate command, gate diagnostic, `GitBlockers — AutoRepair` classification, current retry attempt/maximum, review round/disposition, unresolved findings/resolutions when present, and current branch revision.
- After the mocked implementer repair succeeds, the workflow re-runs the rebase and the same declared gate, then begins the next review round rather than emitting an autonomous-review-stopped outcome.
- The retry count advances once per eligible rebounce and does not exceed the configured maximum; exhaustion retains a human-intervention outcome.
- The gate-failure diagnostic identifies the failed declared gate and does not claim a Git-hook failure for the simulated gate exit status 1.
- The new regression coverage is a fast unit test with mocked process, agent, and Forgejo dependencies; it does not invoke a real Forgejo instance or expensive agent/CLI process.

## Risks and Assumptions
- Assumption: declared pre-review gate failures with exit status 1 are deterministic and eligible for the existing `GitBlockers — AutoRepair` classification.
- Risk: relaunching after a failed gate can accidentally replay stale review state; preserve the current revision, review round, disposition, and unresolved findings in the repair context and verify the continuation path.
- Risk: retry accounting can double-consume attempts across a relaunch; assert the count at the rebounce boundary and at retry exhaustion.
- Risk: diagnostics are assembled by more than one workflow layer; update only the source that owns declared-gate classification so genuine Git-hook failures remain distinguishable.

## Checkpoints
Reproduction-Test: test/task-2353-rebounce-reproduction.test.ts

- CP 1: Before changing workflow behavior, author `test/task-2353-rebounce-reproduction.test.ts`. Simulate an existing pull request whose declared `./scripts/verify-local.sh static-analysis` pre-review gate exits with status 1, followed by a successful mocked implementer repair. Assert that the parent commit produces the current stopped/human-intervention outcome (red), while the completed fix relaunches the implementer, re-runs the gate, and advances the review loop (green).
- CP 2: Implement the bounded rebounce control-flow and diagnostic correction. Capture the repair-context fields, one retry increment, rebase/gate replay, next-round continuation, and exhaustion behavior with focused mocked tests.
- CP 3: Run the declared mission gate and record final evidence for every success criterion in the checkpoint document.

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
- Raw `stat`/`ls` output or generic prose alone is not enough; it may appear as supplemental context only when paired with one of the accepted references above
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
- Do not change the semantic behavior of declared verification gates, static-analysis rules, or the failing task-2332.07 consumer-citation fixture.
- Do not contact or operate against a real Forgejo service from unit tests; mock Forgejo, agent launches, and process execution.
- Do not alter retry behavior for non-deterministic failures, cancellation, reviewer findings, or missions that have exhausted their configured automatic-repair budget.
- Do not edit mission/backlog ownership fields outside the task labels required by this draft.

## Stop Rules
- Stop and escalate if the recorded failure cannot be classified deterministically without changing the retry-policy contract.
- Stop and escalate if continuation after repair requires an additional agent role, external service operation, or a new lifecycle state not already represented by the review workflow.
- Stop and escalate if the regression test requires real Forgejo access, a real agent launch, or a verification command outside the mocked unit-test boundary.
- Stop after the configured retry maximum is reached; retain the existing human-intervention path rather than attempting further automatic rebounces.
