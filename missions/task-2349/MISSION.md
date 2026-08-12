# Mission: Close the integrate stage-and-commit race that lets concurrent board mutations steal the squash payload (task-2349)

## Goal
Make `px integrate` land only its intended squash payload when another process mutates the board in the same primary checkout, and accurately report a landed payload when an intervening commit has already carried it.

## Why Now
The race has already produced a misleading integration failure while shipping task-2348 under an unrelated `Reorder tasks in review` commit, and has also swept an unrelated untracked backlog task into another mission’s squash commit. Retrying after the false failure can duplicate already-landed work, while the incorrect commit message hides the actual review surface.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; the incident history and acceptance cases define the required behavior.
- Main drivers: replace the unscoped stage/commit sequence in integrate; preserve the intended-payload boundary under concurrent board commits; distinguish payload-already-landed from a genuine rejected commit; add deterministic regression coverage.

## Scope
- Change the integrate squash-commit flow so the commit names the mission payload paths it is intended to land instead of relying on an earlier unscoped `git add -A` index state.
- Add a regression test that reproduces an intervening bare board commit after integrate staging and proves the mission payload cannot be committed under that board commit.
- Add coverage proving a dirty, unrelated file in the primary checkout is absent from the landed squash commit.
- When the integrate commit command returns non-zero, compare HEAD with the intended payload and report the integration as landed, including the commit identifier, when HEAD already contains that payload.
- Retain the existing abort and hook-failure guidance when a non-zero commit result leaves the intended payload absent from HEAD.
- Update durable user-facing workflow documentation only if the changed integrate reporting or commit behavior is documented.

## Out of Scope
- Changing Backlog.md’s external staging or bare-commit implementation.
- Serializing all board mutations globally, adding repository-wide locking, or changing worktree ownership semantics.
- Recovering, rewriting, or altering the historical task-2348 and task-2347.07 commits.
- Changing unrelated integrate validation, merge, review, or remote-push behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A deterministic integration regression test simulates a bare `git commit -m "Reorder tasks in review"` between integrate’s payload preparation and its own commit; it fails at the mission parent commit because the board commit can contain the mission payload, and passes after the change because the board commit contains no mission-payload files.
- A regression test leaves a named unrelated dirty file in the primary checkout and proves the landed squash commit excludes that file while including the intended mission payload.
- A regression test makes integrate’s commit command return non-zero after HEAD has acquired the complete intended payload; integrate reports the mission as landed, includes the carrying commit identifier, and does not emit `Could not create the squash commit in the local integration checkout.`.
- A regression test makes integrate’s commit command return non-zero while HEAD lacks the intended payload, such as a rejecting hook; integrate aborts and retains the existing hook-failure guidance.
- The implementation does not use an unscoped `git add -A` followed by a bare `git commit` to create the landed squash commit.
- If durable documentation describes the integrate commit/reporting contract, it states the shipped behavior; if no such documentation exists, no documentation-only change is made.
- `./scripts/verify-local.sh all` succeeds on the final tree, with its result recorded in the final checkpoint Goal Check table.

## Risks and Assumptions
- Assumes Git pathspec-based staging/commit operations can express the complete intended mission payload, including additions, modifications, and deletions, without relying on ambient index entries.
- The existing test harness can deterministically interpose a board-style bare commit in the stage-to-commit window without accessing a real Forgejo instance.
- Comparing the intended payload with HEAD must be exact enough not to classify a partial or different commit as landed.
- Hook-rejection behavior is a safety boundary: a non-zero commit result remains a failure unless HEAD demonstrably contains the complete intended payload.
- Concurrent processes may still change the checkout; this mission narrows commit ownership and truthful reporting rather than promising global mutual exclusion.

## Checkpoints
Reproduction-Test: test/task-2349-integrate-stage-commit-race.test.ts

- CP 1: Before writing the fix, author `test/task-2349-integrate-stage-commit-race.test.ts` with the deterministic stage-to-commit interleaving: integrate prepares its payload, a simulated board mutation performs bare `git commit -m "Reorder tasks in review"`, and the test asserts that commit does not contain the mission payload. Confirm this assertion is red at the mission parent commit and preserve the test so it becomes green after the fix.
- CP 2: Implement explicit intended-payload commit handling in integrate and add coverage for exclusion of an unrelated dirty primary-checkout file from the landed squash commit.
- CP 3: Implement and test non-zero commit-result classification for both HEAD-already-contains-the-complete-payload (landed report with commit identifier) and HEAD-lacks-payload (existing abort and hook guidance).
- CP 4: Update applicable durable documentation only if it describes this behavior; run the required verification gate and record final evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one row for every Success Criterion.
- Durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use file:line references only parenthetically when necessary; they are accepted but discouraged because line numbers rot.
- For the red-to-green handoff, cite `test/task-2349-integrate-stage-commit-race.test.ts`, the exact reproduction test name, and the command used to demonstrate red at the parent commit and green after the fix.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is useful, pair it with an accepted command, test name, test file path, or ADR reference above.
- A concrete `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the Backlog.md binary or its vendored distribution.
- Do not change board task labels, ordering, assignment, archive behavior, or status-transition semantics except as exercised by isolated test doubles.
- Do not rewrite existing history or push the mission branch to `origin`.
- Keep unit tests isolated from real Forgejo and avoid unmocked expensive CLI or agent invocations.

## Stop Rules
- Stop and escalate if the intended payload cannot be enumerated without changing the documented integration contract beyond this mission’s scope.
- Stop and escalate if a test cannot reliably distinguish the interloping board commit from integrate’s squash commit.
- Stop and escalate if HEAD-payload comparison cannot distinguish a complete landed payload from a partial payload, because misreporting a genuine commit failure as success is unacceptable.
- Stop and escalate before changing Backlog.md, global locking, history-rewrite, remote-push, or board workflow behavior.
