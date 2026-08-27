# Mission: Attribute the live review agent to its family in the board strip (task-2416)

## Goal
Make the board strip attribute a live `px review --continue` agent to its actual family, while preserving `family unknown` for live non-agent Parallix work and no family/blink for dead recording processes.

## Why Now
The strip already detects these sessions as live, but reports every live review continuation as `family unknown` and assigns zero to every family. This makes the operational board misleading during active review work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a null `agent` on the newest running review current-work fact shadows the family known by the review launcher; tests must protect the live, non-agent, and dead-process distinctions.

## Scope
- Add a failing regression test at `test/task-2416-review-family-repro.test.ts` before changing production behavior.
- Carry the selected review-loop family into the running current-work fact published for `px review --continue`.
- Preserve current-work reconciliation so the newest live review fact can provide the family consumed by `ConcreteAgentReadAdapter.loadRunningSessions`.
- Add focused coverage for live review-family attribution, live non-agent work remaining unknown, and dead recording processes remaining blank.

## Out of Scope
- Changing the ambiguous plain `px review` attribution policy.
- Inferring an agent family from a process when the launching operation did not record one.
- Changing board-strip layout, blink timing, family labels, or unrelated session detection.
- Modifying agent-family definitions or custom-agent configuration.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A live `px review --continue` recording process whose review loop runs a Parallix-launched `codex`, `claude`, `custom`, `qwen`, or `vibe` agent contributes that family to the board strip rather than `unknown`.
- The running current-work fact emitted for a review-loop launch records the selected running family, so reconciliation of the newest running fact retains that family.
- A mission with only a live non-agent Parallix process for draft setup, integrate, handoff, or conflict resolution reports `family unknown` and contributes no family count.
- A mission with a dead recording process shows neither a live blink nor a family attribution.
- `test/task-2416-review-family-repro.test.ts` fails against the mission parent commit because a live review continuation publishes no family, then passes after the implementation.
- Focused tests cover the live review family, live non-agent unknown, and dead-process blank cases; `./scripts/verify-local.sh all` completes successfully.

## Risks and Assumptions
- Assumption: the review-loop launch path has the authoritative selected family when it publishes its running current-work fact.
- Risk: attaching a family to a broader review summary could fabricate attribution for ambiguous plain `px review`; restrict the change to the agent-launch event.
- Risk: process-liveness behavior is shared by board projections; retain existing dead-process filtering rather than adding a separate display exception.

## Checkpoints
Reproduction-Test: test/task-2416-review-family-repro.test.ts

- CP 1: Author `test/task-2416-review-family-repro.test.ts` before any fix. It must model a live `px review --continue` recording process with a selected agent family and assert that the board-strip family count is that family; it must fail (red) at this mission's parent commit because the published review current-work fact has `agent: null`, then pass (green) after the fix.
- CP 2: Update only the review-loop current-work publication path so the running agent-launch fact carries its known family; keep plain `px review` and non-agent operations unattributed.
- CP 3: Extend focused projection/adapter coverage for a live review family, live non-agent work as `unknown`, and a dead recording process as blank; run the repository gate and record the evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- A `## Goal Check` section using exactly this table header: `| Criterion | Evidence | Status |`.
- At least one row for every success criterion, led by durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For CP 1, record the exact failing test name and `test/task-2416-review-family-repro.test.ts`, plus the command that demonstrated the parent-commit red result. For CP 2 and CP 3, record the same test's green result and the exact focused test names for the non-agent and dead-process cases.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify board-strip presentation components, agent-family configuration, or process-liveness semantics unless a focused test proves the current-work publication change cannot satisfy a success criterion.
- Do not alter the backlog task assignee or task status.
- Do not publish or push this mission branch to `origin`.

## Stop Rules
- Stop and request direction if the only way to attribute plain `px review` is process-name inference or guessing the family.
- Stop and request direction if the authoritative review-loop family is unavailable at the current-work publication point.
- Stop and request direction if preserving unknown attribution for non-agent operations conflicts with the requested review-continuation attribution.
