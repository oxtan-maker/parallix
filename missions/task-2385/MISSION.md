# Mission: Preserve review rounds and verdicts when state writes are stale (task-2385)

## Goal
Prevent a stale flattened review-state write from renumbering the current Review aggregate round, and ensure verdict recording never fabricates round 1 after a review-state read miss. Valid verdicts must persist and be visible through `px status <slug>`.

## Why Now
The defect already stranded an approved round-2 review for `task-2377.05`: its reviewer artifacts and PR comment landed, but the persistence write violated the unique round-number constraint and discarded the verdict. Leaving the path unchanged can repeatedly strand missions in a completed-but-unrecorded review state.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: review-state mapping invariant, stale-state rejection diagnostics, verdict-state producer behavior, persistence/status regression coverage, and recovery guidance for already affected missions

## Scope
- Add a regression test under `test/task-2385-stale-review-round-repro.test.ts` before changing production behavior; it must reproduce an aggregate with rounds 1 and 2 receiving stale state for round 1.
- Change review-state mapping so a state round lower than the aggregate's current round cannot alter an existing round number and is rejected with a diagnostic naming the supplied and current round numbers.
- Preserve the current semantics for state writes whose round equals the current round and for writes that advance to a higher round.
- Identify the actual stale-round producer in verdict recording and change the review-state read-miss behavior so it cannot fabricate `round: 1`.
- Cover persistence through the Review aggregate and `px status <slug>` output for a recorded verdict, and document a recovery procedure for missions whose review completed but whose verdict was not stored.

## Out of Scope
- Redesigning review phases, reviewer artifact formats, or the mission lifecycle.
- Repairing every historical mission automatically or modifying production SQLite data as part of this mission.
- Changing handling of malformed state fields other than the stale positive round-number path described here.
- Broad refactors of review-state persistence unrelated to the round monotonicity invariant.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A test at `test/task-2385-stale-review-round-repro.test.ts` fails on the mission parent commit by applying state `round: 1` to an aggregate containing rounds 1 and 2, then passes after the fix by asserting that round 2 remains numbered 2 and no duplicate round is created. 
- A lower positive state round is rejected before persistence with a diagnostic that includes both the supplied stale round and the aggregate's current round.
- Tests demonstrate that an equal-round state update updates the current round and that a higher-round state update advances the round list without changing prior round numbers.
- When verdict recording cannot read review state, it does not construct or write a fabricated `round: 1`; the test identifies the resulting explicit behavior and asserts it.
- A verdict written after the fix persists to the Review aggregate and `px status <slug>` reports that round's recorded disposition.
- The checkpoint evidence documents a repeatable recovery procedure for an already affected mission, including how to identify the unrecorded verdict and how to re-record it using supported `px` workflow commands.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: the hardcoded fallback in verdict recording is the stale-round producer observed in `task-2377.05`; implementation must confirm this rather than treating it as proven.
- Risk: rejecting a stale state write may expose callers that relied on silent overwrites. The diagnostic must make the two conflicting round numbers actionable.
- Risk: a persistence-level test can accidentally invoke real Forgejo or expensive agents. Unit coverage must mock external dependencies and keep the reproduction test local and fast.
- Risk: recovery commands may differ by the mission's persisted review state. Document only commands and paths that the repository currently supports.

## Checkpoints
- CP 1: Create `test/task-2385-stale-review-round-repro.test.ts` before any production fix. Reproduce an aggregate containing review rounds 1 and 2, apply flattened state with `round: 1`, and assert that the current round is not renumbered, no duplicate round is persisted, and the stale round is rejected with both round numbers in its diagnostic. Record that this test is red at the mission parent commit and green once the fix lands.
- CP 2: Trace the review-state mapping and verdict-recording paths, confirm the read-miss producer behavior, then implement the smallest change that enforces monotonic rounds and prevents the fabricated fallback. Add focused mocked unit coverage for lower, equal, and higher round inputs and for the verdict-recording read miss.
- CP 3: Exercise the persisted-verdict/status path, write the supported recovery procedure for a mission with an unrecorded approved verdict, run the mission gates, and capture the final Goal Check evidence.

Reproduction-Test: test/task-2385-stale-review-round-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- An exact `## Goal Check` heading followed by the 3-column table `| Criterion | Evidence | Status |`.
- At least one durable evidence row for every success criterion. Lead with exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`; use `test/task-2385-stale-review-round-repro.test.ts`, exact new test names, and `./scripts/verify-local.sh static-analysis` or `./scripts/verify-local.sh all` where applicable. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- The red-to-green evidence for CP 1: the exact reproduction test name, its test path, the parent-commit command/result showing red, and the post-fix command/result showing green.
- Evidence for the recovery procedure that cites the supported `px` command or repository path used to recover an unrecorded verdict.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted test name, ADR reference, test path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify SQLite schema, migrate stored mission data, or run destructive database commands without a separately approved migration mission.
- Do not contact real Forgejo, create review comments, or invoke real agents from unit tests.
- Do not change review workflow semantics beyond stale-round rejection, read-miss handling, and the documented recovery path.

## Stop Rules
- Stop and request direction if preserving an equal or higher round requires changing the published ReviewState shape or SQLite schema.
- Stop and request direction if the confirmed stale-round producer is outside the review-state and verdict-recording paths named in scope, because that expands the mission's causal boundary.
- Stop and request direction if recovery requires mutating an existing mission database directly rather than using supported repository workflow commands.
