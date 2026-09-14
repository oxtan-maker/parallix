# Mission: Preserve mission identity during rebase (task-2503)

## Goal
Make rebase recovery retain the implementer recorded for the mission before commit replay, so recovery dispatches that implementer even when replayed history exposes stale task metadata.

## Why Now
Stale mission branches can expose older metadata during rebase. Selecting an implementer from that transient state can launch the wrong agent, while reporting a local metadata problem as Forgejo or network trouble sends operators toward the wrong remediation.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: rebase orchestration, shared-file conflict recovery, implementer dispatch, local error classification

## Scope
- Capture the mission's recorded implementer before rebase commit replay begins.
- Use that captured implementer for shared-file conflict recovery after replay.
- Classify unavailable or stale local mission metadata during this path as a local workflow condition, without a Forgejo or network blocker message.
- Add focused regression coverage for metadata changing during rebase and for the recovery/error-reporting behavior.

## Out of Scope
- Changing how implementers are initially assigned to missions.
- Changing Forgejo transport, authentication, or general network-error handling.
- Altering rebase behavior unrelated to mission implementer identity or shared-file recovery.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test under `test/` starts a rebase with recorded implementer A, makes replayed metadata expose implementer B, and fails at the mission parent commit because recovery selects metadata B rather than the recorded pre-rebase implementer A.
- Shared-file conflict recovery dispatches recorded implementer A in that scenario; the regression test passes after the fix.
- The same recovery path reports unavailable or stale local mission metadata as a local workflow condition and its asserted message does not claim a Forgejo or network failure.
- `./scripts/verify-local.sh all` exits successfully on the completed mission tree.

## Risks and Assumptions
- Assumption: the rebase entry point can read a mission's recorded implementer before replay and retain it through conflict recovery.
- Risk: capturing identity too late still permits replayed metadata to replace it; the regression test must change metadata after capture to prove ordering.
- Risk: error-message assertions can overfit wording; assert the absence of Forgejo/network attribution alongside the local-condition classification.

## Checkpoints
- CP 1: Author `test/task-2503-repro.test.ts` before any fix. Reproduce a rebase that records implementer A, then replays metadata naming B and enters shared-file recovery; assert recovery chooses A. It must fail (red) at the mission parent commit and pass (green) once the fix is complete.

Reproduction-Test: test/task-2503-repro.test.ts

- CP 2: Capture the recorded implementer at the rebase boundary and route shared-file recovery through that captured value; add or complete focused coverage for local metadata error classification.
- CP 3: Run the repository gate and record the completed goal check.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done and the exact heading `## Goal Check`, followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted reference above. End the document with a non-generic `Next action:` line.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change initial implementer assignment semantics, Forgejo transport/authentication, or unrelated rebase flows.
- Keep the regression test isolated under `test/`; it must mock external boundaries and must not contact real Forgejo.

## Stop Rules
- Stop if no stable pre-replay source exists for the recorded implementer; report the missing authority rather than inferring identity from replayed metadata.
- Stop if the required behavior needs changes to Forgejo/network handling or initial assignment semantics; those are outside this mission.
- Stop if the focused regression cannot be made red at the mission parent commit before changing production behavior.
