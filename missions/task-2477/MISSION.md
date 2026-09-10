# Mission: Make autonomous review visibly prove independent scrutiny (task-2477)

## Goal
Rebuild the default autonomous-review presentation in `px active` / `px review` so a first-time operator reads one story from the terminal alone: **who implemented the change → who reviewed it → whether that reviewer was a different agent family or a same-family/self-review fallback → what the reviewer concluded → which findings block integration.** Reviewer selection and pre-review gate success must each be announced once, the verdict must be visually prominent, and blocking findings must be readable without opening `missions/<slug>/review-events/*.md`.

## Why Now
The review phase of `docs/assets/first-value-demo.cast` reads as a workflow-engine trace, and two of its defects are duplicate emissions at the source: `Selected reviewer: ...` is logged both in `src/adapters/review/review-agent-fallback.ts` (`selectReviewerFromSnapshot` path) and again in `src/adapters/review/review-loop.ts` right after `resolveReviewerIdentity` returns; `Pre-review gate passed for area "..."` is logged both in `src/adapters/review/review-gate-handling.ts` and again in the round body of `src/adapters/review/review-loop.ts`. The same banner block then prints `Implementer: X | Reviewer: Y`, `Focus / Max attempts`, and `Poll interval / Poll timeout` at equal visual weight, and the demo's `workflow.config.json` sets `review.provider: "none"`, so provider-disabled and artifact-persistence lines (`Persisted reviewer artifacts to repo store: ...`) dominate what should be the review's headline. The verdict itself appears only as `Round N: reviewer outcome = APPROVED`, buried among task transitions. Nothing in the codebase currently expresses independence: there is no same-family/different-family concept anywhere in reviewer selection, so the operator cannot tell an independent review from a self-review fallback. TASK-2478 (implementer response to findings) and TASK-2479 (integration output) both build on this presentation, so the review-phase information model has to land first.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: duplicate emissions have two known call sites each; a new independence classification must be derived from real agent-family identity rather than display names; a real demo re-record plus raw cast and GIF inspection is mandatory and is the slowest part.

## Scope
- Deduplicate happy-path review presentation **at the source**: reviewer selection announced exactly once per `px active` / `px review` run, and pre-review gate success announced exactly once per round, by removing the redundant emission rather than filtering output downstream.
- Recompose review start into an operator-facing header covering mission identity, implementer, reviewer, and an independence label derived from actual agent-family identity (implementer family vs reviewer family), not from display names.
- Introduce an explicit independence classification with at least the states "different agent family" and "same-family fallback" (self-review when implementer and reviewer are the same agent), rendered so a fallback is never presented as equal to or stronger than independent review.
- Demote poll interval, poll timeout, max attempts, focus, Forgejo/provider-disabled branches, and reviewer-artifact persistence paths out of the default presentation (verbose/diagnostic only), while keeping genuine review-infrastructure failures at default visibility.
- Make the verdict first-class: a prominent `APPROVED` / `CHANGES REQUESTED` presentation driven by the persisted authoritative review state, printed before/above subsequent task-transition and persistence output.
- For `CHANGES REQUESTED`, render a concise blocking-findings summary in the terminal, reusing `parseReviewFindings` from `src/adapters/review/review-round.ts`, before the implementer is relaunched.
- Keep the reviewer agent's live stream visible at default verbosity.
- Re-record `docs/assets/first-value-demo.cast` with real agents via `scripts/record-first-value-demo.sh`, re-render `docs/assets/first-value-demo.gif`, inspect both, and record every defect found and every action taken under a `## Demo Replay Findings` heading in the mission checkpoint documents.
- Add focused tests for: single reviewer-selection emission, single pre-review-gate-pass emission, independence label for different-family and same-family cases, verdict prominence, and findings rendering on the request-changes path.

## Out of Scope
- The implementer's response to review findings and the act-on-review relaunch presentation — TASK-2478.
- Integration/`px integrate` output — TASK-2479.
- Changing reviewer-selection *semantics* (eligibility, matrix, fallback ordering), except to correct a genuine bug uncovered by the real replay; presentation-only otherwise.
- Making reviewers reject correct code, or scripting an artificial rejection into the hero demo.
- Changing review artifact formats, `review-events` storage, Forgejo provider behavior, or the review state schema beyond any additive field needed to record independence.
- Reworking the execute/handoff phase presentation owned by TASK-2476.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- On a happy-path run, the string `Selected reviewer` (and any replacement reviewer-selection announcement) appears exactly once in default output; the duplicate emission is removed from one of the two call sites in `src/adapters/review/review-agent-fallback.ts` and `src/adapters/review/review-loop.ts`.
- On a happy-path round, pre-review gate success is announced exactly once; the duplicate emission across `src/adapters/review/review-gate-handling.ts` and `src/adapters/review/review-loop.ts` is removed.
- Default review-start output names the mission slug, the implementer agent, the reviewer agent, and an independence label, in that block, before the first reviewer launch.
- The independence label is computed from implementer and reviewer agent-family identity: when the two families differ it reads as different-family review; when they are the same agent/family it reads as a same-family or self-review fallback. A test asserts both cases, including that the same-family case never emits the different-family wording.
- The strings `Poll interval`, `Poll timeout`, `Max attempts`, and reviewer-artifact persistence paths (`Persisted reviewer artifacts to repo store`) do not appear in default (non-verbose) review output; a test asserts their absence at default verbosity and their presence under verbose.
- Review-infrastructure failure paths (incomplete reviewer artifacts, artifact persist failure, gate failure, reviewer non-submission) still emit at default verbosity; a test asserts at least the incomplete-reviewer-artifacts failure message survives.
- The final verdict is rendered as a dedicated prominent `APPROVED` or `CHANGES REQUESTED` presentation, emitted before subsequent task-transition/persistence lines in the same run.
- The verdict presentation is derived from the persisted authoritative review state value; a test asserts no approval presentation is emitted when the persisted state is not `APPROVED`.
- On a `CHANGES REQUESTED` outcome, the terminal shows the parsed blocking findings (from `parseReviewFindings`) before the implementer relaunch; a test asserts finding summaries appear in output for a request-changes fixture.
- Reviewer live output is still streamed at default verbosity; a test or documented replay evidence shows reviewer stream lines present in the re-recorded cast.
- `docs/assets/first-value-demo.cast` and `docs/assets/first-value-demo.gif` are regenerated from a real run and inspected; the checkpoint documents contain a `## Demo Replay Findings` section listing each observed review-phase defect (duplicate lines, internal chatter, provider-disabled chatter, misleading independence claims, malformed status prefixes, happy-path warnings, terminal/persisted-state contradictions) with the action taken or an explicit out-of-scope reason.
- The re-recorded cast's review phase, read alone, identifies implementer, reviewer, independence level, and verdict — quoted verbatim in the checkpoint evidence.
- The focused review tests are run directly by file path (`npm test -- <file>`) and pass; their names and paths are cited in the Goal Check table.
- `./scripts/verify-local.sh all` exits successfully on the final mission tree.

## Risks and Assumptions
- Assumption: agent family identity is available at review-loop time from the resolved implementer/reviewer values and the launcher status in `src/adapters/agents/agents.ts`; if a display name and family diverge, the family value is authoritative for the independence label.
- Risk: removing a duplicate emission at the wrong call site silences the message on a non-happy path (continue mode, persisted resume, fallback repair). Mitigation: check each removal against the resume and fallback branches in `src/adapters/review/review-agent-fallback.ts` before deleting, and keep coverage for the resume path.
- Risk: demoting output to verbose could hide a real infrastructure failure. Mitigation: demote only configuration/plumbing/persistence-success lines; failure and warning paths keep default visibility, asserted by test.
- Risk: the demo config uses `review.provider: "none"`, so the demo path is artifact-based; a presentation fix validated only against `provider: none` may not hold for Forgejo. Mitigation: drive the verdict/findings presentation from the shared review-state value used by both providers.
- Risk: the hero demo may approve immediately, leaving the `CHANGES REQUESTED` presentation unexercised by the cast. Mitigation: cover the request-changes presentation with focused tests instead of manufacturing a rejection in the demo.
- Assumption: re-recording requires `asciinema` and real agent runners on the machine; if a runner is unavailable the demo cannot be honestly re-recorded and the mission stops rather than hand-editing the cast.

## Checkpoints
- CP 1: Replay and defect inventory — inspect the current `docs/assets/first-value-demo.cast` review phase and trace every default-visibility emission in `src/adapters/review/review-loop.ts`, `review-agent-fallback.ts`, `review-gate-handling.ts`, and `review-artifacts.ts`. Record a `## Demo Replay Findings` table of every duplicate, internal-chatter, provider-disabled, misleading-independence, and malformed-prefix defect with its exact source call site.
- CP 2: Independence framing — remove the duplicate reviewer-selection and pre-review-gate emissions at source, add the family-based independence classification, compose the review-start header (mission, implementer, reviewer, independence), and demote poll/attempt/provider/persistence lines to verbose. Add the focused tests for single emission, both independence cases, and default-vs-verbose visibility.
- CP 3: Verdict and findings — make the verdict presentation first-class and state-derived, render parsed blocking findings on `CHANGES REQUESTED`, and prove infrastructure failures still surface. Add the focused tests for verdict prominence, non-approved state, and findings rendering.
- CP 4: Real replay closure — re-record the cast with real agents, re-render the GIF, inspect both, fix every in-scope defect found and re-record until clean, extend `## Demo Replay Findings` with each fix, run the focused tests directly, then run the full gate and record the Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of the work done in that checkpoint.
- A `## Demo Replay Findings` section (CP 1 and CP 4 at minimum) listing each observed review-phase defect and the action taken or the explicit out-of-scope reason.
- Use the exact heading `## Goal Check`.
- Include the exact 3-column table header `| Criterion | Evidence | Status |`, with at least one evidence row for every success criterion in scope for that checkpoint.
- Lead every evidence row with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm test -- test/review.test.ts`, `node ...`, `git ...`, `px active`, `./scripts/record-first-value-demo.sh`, or `./scripts/verify-local.sh all`. (File:line references are accepted but discouraged — line numbers rot as the review adapters change.)
- Cite each new or extended focused review test by its exact test name **and** its test file path; cite `./scripts/verify-local.sh all` when recording final verification.
- Cite the re-recorded demo by asset path (`docs/assets/first-value-demo.cast`, `docs/assets/first-value-demo.gif`) plus a verbatim quote of the review-phase lines that show implementer, reviewer, independence, and verdict.
- Raw `stat`/`ls` output or generic prose alone is not enough evidence: pair any shell output with one of the accepted references above.
- End with a non-generic `Next action:` line naming the next concrete step.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change reviewer eligibility, selection ordering, or fallback semantics in `src/application/services/agent-selection.ts` or `src/adapters/review/review-agent-fallback.ts` except for a genuine bug proven by the real replay and documented in `## Demo Replay Findings`.
- Do not modify the review state schema, `review-events` artifact formats, or `src/adapters/review/review-artifacts.ts` persistence behavior beyond an additive independence field, and never change what is persisted to make the terminal look better.
- Do not hand-edit `docs/assets/first-value-demo.cast` or the GIF; both must come from `scripts/record-first-value-demo.sh` and the render script.
- Do not touch the execute/handoff presentation owned by TASK-2476, the act-on-review path owned by TASK-2478, or `px integrate` output owned by TASK-2479.
- Do not add dependencies.

## Stop Rules
- Stop and report if the required agent runners or `asciinema` are unavailable, making an honest real re-record impossible — do not ship an edited or stale cast.
- Stop if removing a duplicate emission would silence the message on the resume/continue or launcher-fallback path and no single call site can carry it; report the conflict instead of filtering output downstream.
- Stop if implementer/reviewer agent family cannot be determined from real identity at review-loop time; do not infer independence from display names.
- Stop if the replay exposes a reviewer-selection or review-state bug whose fix would change selection semantics beyond a targeted correction; record it and open a follow-up rather than expanding scope.
- Stop if a real replay produces a `CHANGES REQUESTED` verdict that would require implementer-response work to demonstrate; that path belongs to TASK-2478.
- Stop if `./scripts/verify-local.sh all` fails for a reason outside this mission's diff; report the failure with output rather than patching unrelated code.
