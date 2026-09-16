# Mission: Recover landed missions missing durable lifecycle state (task-2516)

## Goal
Provide an idempotent recovery command path that closes a mission only when durable Git evidence proves its payload was squash-landed on its recorded base branch, restoring the missing Mission aggregate, `px status <slug>` visibility, and post-closeout worktree cleanup.

## Why Now
An interrupted local landing can leave a completed backlog task and landed squash commit without the authoritative Mission aggregate. That state misreports mission completion, leaves a stale worktree and branch behind, and has no safe recovery path.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: recovery command wiring; durable Git landing validation; aggregate persistence and status projection; cleanup ordering; regression coverage for recovery and refusal.

## Scope
- Add the recovery flow exposed by the existing `px recover` command surface for a mission with no persisted Mission aggregate.
- Establish landing from the recorded base branch and durable local Git history, not a Forgejo PR status.
- Persist a single closed/done Mission aggregate for a valid landed mission so `px status <slug>` projects durable completion.
- Perform stale mission worktree and branch cleanup only after the durable closeout succeeds.
- Add focused regression coverage for valid recovery, repeat recovery, and refusal of an unlanded payload.

## Out of Scope
- Recovering missions whose task artifact is incomplete or whose payload cannot be proven landed on the recorded base branch.
- Using Forgejo PR state as merge authority or repairing remote PR metadata.
- Changing normal `px integrate` behavior, branch naming, or broad historical mission/backlog migration.
- Cleanup before a successful durable closeout, or automatic deletion of unrelated worktrees or branches.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A test fixture with a completed task artifact, a recorded-base squash landing, and no Mission aggregate recovers to one closed/done aggregate; a second recovery attempt does not create a second aggregate or transition.
- `px status <slug>` reports the recovered mission's durable closed/done state from the persisted aggregate.
- The valid-recovery path removes only that mission's stale worktree and branch after the closeout write succeeds; a closeout failure leaves cleanup unattempted.
- A mission whose payload is absent from its recorded base branch is refused, creates no closed/done aggregate, and leaves its worktree and branch intact even if Forgejo reports a merged PR.
- Focused regression tests cover the valid recovery, idempotent repeat, and unlanded-refusal cases, and `./scripts/verify-local.sh all` exits zero.

## Risks and Assumptions
- Assumption: the completed task artifact and recorded base branch provide the identity and base needed to validate a landing from local Git evidence.
- Risk: squash commits do not retain a mission branch commit identity; the recovery proof must use the repository's existing integration metadata and Git ancestry semantics rather than a PR-state shortcut.
- Risk: worktree/branch cleanup is destructive. Keep it downstream of the successful durable persistence boundary and constrain it to the recovered mission slug.
- Risk: interrupted or partially persisted historical state may be ambiguous. Refuse recovery when durable evidence is insufficient rather than infer completion.

## Checkpoints
- CP 1: Author `test/task-2516-recover-landed-mission-repro.test.ts` before any production change. Build a fixture with a completed task artifact, a payload already squash-landed on its recorded base branch, no Mission aggregate, and a stale mission worktree/branch. Assert recovery persists one closed/done aggregate, makes `px status <slug>` report it, and performs cleanup only after closeout; this assertion fails at the mission parent commit (red) and passes after the fix (green).

Reproduction-Test: test/task-2516-recover-landed-mission-repro.test.ts

- CP 2: Implement the smallest recovery path through the existing recovery/lifecycle services. Validate the completed artifact and local Git landing on the recorded base branch, persist the closed/done aggregate exactly once, and refuse missing or unlanded proof without consulting Forgejo merge state as authority.
- CP 3: Wire recovered state into the status projection and sequence mission-specific worktree/branch cleanup after successful persistence. Extend the focused regression coverage for repeat invocation, unlanded refusal, and failed-closeout cleanup protection; run the required gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable, verifiable evidence first: exact test names, ADR references, test file paths, and recognized repo commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table `| Criterion | Evidence | Status |`, with one evidence row for every Success Criterion.
- Evidence for CP 1 that names `test/task-2516-recover-landed-mission-repro.test.ts`, its exact red assertion at the mission parent commit, and its green result after the recovery path exists.
- Evidence for valid recovery, repeated recovery, status projection, cleanup ordering, and unlanded refusal using exact test names or test paths plus the relevant recognized command.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with at least one accepted reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not treat Forgejo PR state as evidence that authorizes a merge or recovery.
- Do not mutate an existing Mission aggregate as part of recovery; this path is only for an absent aggregate.
- Do not remove a worktree or branch until the closed/done aggregate write has succeeded.
- Do not broaden cleanup beyond the recovered mission's resolved worktree and branch.

## Stop Rules
- Stop and refuse recovery when the task artifact is not completed, the Mission aggregate already exists, the recorded base branch cannot be resolved, or local Git evidence does not prove the payload landed on that base branch.
- Stop before cleanup if durable closeout fails or cannot be read back as closed/done.
- Stop and surface the ambiguity for manual repair if the recovery target cannot be uniquely tied to its task artifact, base branch, worktree, and branch.
