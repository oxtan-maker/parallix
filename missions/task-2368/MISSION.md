# Mission: Detect active agent-run reviews in the px board (task-2368)

## Goal

Make `px board` recognize a live Claude review session for its mission and keep that mission out of the human-attention lane while the review is running.

## Why Now

The board reported task-2274 as “Awaiting review decision” and placed it in “Needs You Next” while Claude was actively running its review. That is a misleading operational signal: it can cause a human to intervene in a review that is already progressing and makes the board’s review status unreliable.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one review-session detection path, one board-attention classification path, and a focused mocked regression test

## Scope

- Trace how `px board` obtains live-agent session state and associates it with a mission in review, including the concrete review read adapter and the board’s review/attention presentation path.
- Correct the narrow association or classification defect that caused an active Claude review for task-2274 to be rendered as “review pending” and human attention.
- Add `test/task-2368-agent-running-review-detection.test.ts` using mocked process/session dependencies; it must exercise the board-facing classification without invoking a real Forgejo instance, CLI agent, or performance-heavy command.
- Preserve the existing rendering for a review with no matching active agent session and for non-review mission lanes.

Reproduction-Test: test/task-2368-agent-running-review-detection.test.ts

## Out of Scope

- Changing the review workflow’s submission, polling, verdict, or Forgejo PR APIs.
- Changing how agent launchers start, stop, or report usage limits.
- Reformatting unrelated board columns, session summaries, or attention priorities.
- Adding external telemetry, polling services, or real-agent/Forgejo integration tests.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives (“easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient” without an attached metric) and vague quantifiers (“multiple, several, some, many, few, various”).

- SC1: Before any production fix, `test/task-2368-agent-running-review-detection.test.ts` contains a mocked scenario for a mission in the review lane with a live Claude review session and an otherwise pending review disposition; its assertion expects the board state to identify the active review and not request human review, and it fails at the mission parent commit.
- SC2: After the fix, that same scenario passes and the board-facing result marks the mission as actively reviewing (or its existing equivalent running-review state) rather than “review pending” / human attention.
- SC3: A mocked review-lane mission with no matching live review session continues to produce the existing pending-review / attention outcome.
- SC4: The regression test does not call real Forgejo, spawn a real agent, or run a heavy CLI command; its dependencies are mocked through the repository’s test seams.
- SC5: `node --test test/task-2368-agent-running-review-detection.test.ts` passes after the fix.
- SC6: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- Risk: Session metadata may identify a mission by slug, worktree path, branch, or review command arguments, and the observed mismatch may occur at any one of those boundaries. Mitigation: capture the real-shaped mocked session record in the red test before changing production logic.
- Risk: The board aggregates agent state across providers. Mitigation: make the fix provider-neutral and add only the Claude-shaped regression fixture needed to prove the report; do not special-case display text.
- Assumption: A live review session has enough locally available identity data to associate it with the review-lane mission without querying Forgejo.
- Assumption: `test/review.test.ts`, `test/status.test.ts`, and `test/lib/module-mock.ts` provide patterns for isolated mocked tests.

## Checkpoints

- CP 1: Author the failing reproduction test at `test/task-2368-agent-running-review-detection.test.ts` before any production fix. Model a review-lane task with a live Claude session that is executing the review for that task, plus the pending disposition reported in the original board view. Assert that the board’s derived state is active review and does not require human attention. Confirm the test fails at the mission parent commit (red); it must pass after the fix (green).
- CP 2: Trace and document the exact handoff from live-session discovery through mission identity matching to board review/attention classification. Identify the smallest production boundary responsible for losing the active-review signal.
- CP 3: Implement the minimal correction at that boundary and extend the focused test only as needed to prove both the active-session result and unchanged no-session pending-review result.
- CP 4: Run the focused reproduction test and the full local verification gate. Record durable evidence in the final checkpoint document.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:

- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with the exact header `| Criterion | Evidence | Status |` and at least one row for every success criterion.
- Durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `node --test test/task-2368-agent-running-review-detection.test.ts`, `npm ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; when included, pair it with at least one accepted durable reference above.
- A non-generic `Next action:` line at the bottom that names the next checkpoint action or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Active Claude review is detected | `test/task-2368-agent-running-review-detection.test.ts`, exact regression test name | PASS |
| Pending review remains unchanged without a session | `test/task-2368-agent-running-review-detection.test.ts`, exact no-session test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `src/adapters/forgejo/forgejo.ts` — do not change Forgejo review retrieval or disposition semantics unless the red test proves it is the direct identity-loss boundary.
- `src/adapters/review/review-commands.ts` and `src/adapters/review/review-loop.ts` — do not alter review execution, submission, or polling behavior; this mission addresses board detection only.
- Agent-launcher adapters and provider command implementations — do not change process launching, provider availability, or usage-limit handling.
- `docs/` — do not update authored documentation unless the final behavior introduces a durable user-facing board-state contract.

## Stop Rules

- Stop and report if the red test cannot represent the reported live Claude session using local mocked session data; do not guess at a production fix without a faithful reproduction.
- Stop and request direction if the smallest confirmed fix requires changing review execution, Forgejo APIs, or agent-launcher behavior rather than board detection/association.
- Do not special-case task-2274, the `claude` display label, or the original board text; the fix must use the repository’s general mission/session identity rules.
- Do not replace the focused mocked regression test with an E2E test that touches real Forgejo or starts an agent.
