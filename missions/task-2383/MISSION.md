# Mission: Restore writable reviewer agent state homes (task-2383)

## Goal
Allow every supported reviewer launcher to initialize and persist its own state under the Bubblewrap review profile, while keeping the mission worktree under review read-only.

## Why Now
The Bubblewrap guard introduced in task-2374 makes Codex, Qwen, Vibe, and Claude fail before a review prompt can be processed because their state homes are read-only. Review then exhausts the reviewer pool and falls back to the implementer family, so review results cannot be safely posted and Claude sessions cannot be resumed in later rounds.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Bubblewrap review-profile writable-bind policy, per-launcher state-home resolution, Claude transcript persistence, explicit negative isolation coverage, and review-profile documentation.

## Scope
- Add the resolved state home for each supported review launcher—Codex, Qwen, Vibe, Claude, and custom agents—to the Bubblewrap review profile's writable binds.
- Keep the mission worktree mounted read-only for review, while retaining only the resolved artifact directory and `/tmp` as the other writable review locations.
- Ensure Claude's per-worktree transcript location is writable so a review session recorded in one round can be resumed in a later round.
- Add focused test coverage for the review profile's positive writable binds and its negative reviewed-source write denial.
- Update `docs/agents.md` to replace the incomplete task-2374 review-profile permission description with the supported writable-state-home contract.

## Out of Scope
- Changing non-review Bubblewrap profiles or removing the read-only review-worktree boundary.
- Changing reviewer selection, blocklisting, posting, or fallback behavior addressed by TASK-2380 and TASK-2384.
- Moving agent state homes globally, changing agent CLI configuration unrelated to review launch, or changing artifact-directory semantics.
- Broadening review writes to arbitrary paths in the mission worktree or host home directory.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The review sandbox resolves a writable bind for each supported review launcher state home: Codex `CODEX_HOME`, Qwen `QWEN_HOME`, Vibe `VIBE_HOME`, Claude's per-worktree transcript directory, and the custom-agent state home.
- Under `bwrap`, each supported reviewer launcher reaches prompt processing using its review profile without an `EROFS`/read-only initialization failure.
- A Claude review session written in round N can be resumed by its recorded session ID in round N+1 because the corresponding per-worktree transcript directory remains writable during review.
- Review-profile tests prove that the resolved artifact directory, `/tmp`, and only the enumerated agent state homes are writable; an attempted write to a reviewed source, configuration, test, documentation, or mission file is denied.
- `docs/agents.md` states that review preserves a read-only worktree while allowing only launcher state homes, the resolved artifact directory, and `/tmp` to receive writes; it supersedes the task-2374 permission-table omission.
- `./scripts/verify-local.sh static-analysis` and the affected unit suites complete successfully with no focused or unannotated skipped tests introduced.

## Risks and Assumptions
- Assumption: all review-capable launchers have deterministic, resolvable state-home paths before Bubblewrap is invoked.
- Risk: a generic writable bind could accidentally cover a parent worktree path and defeat review isolation; tests must assert the reviewed source tree remains read-only.
- Risk: Claude transcript storage may depend on the exact worktree slug; implementation must bind the resolved per-worktree location rather than the entire host home.
- Risk: custom agents may supply state paths differently from built-in launchers; preserve their existing launcher contract while constraining writable paths to the resolved state home.

## Checkpoints
- CP 1: Add a failing regression test at `test/bubblewrap-guard.test.ts` before any production change. The test must construct the review profile for representative Codex, Qwen, Vibe, Claude, and custom-agent launches; assert their resolved state homes are writable, Claude's per-worktree transcript directory is writable, and a representative reviewed source path is not writable. It must fail at the mission parent commit (red) because the state homes are absent, then pass after the policy change (green).

Reproduction-Test: test/bubblewrap-guard.test.ts

- CP 2: Change review-profile path resolution and Bubblewrap bindings so the enumerated launcher state homes are writable without widening the read-only mission-worktree mount.
- CP 3: Exercise the affected launcher and guard unit coverage, update `docs/agents.md` with the review permission contract, and record final goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Use durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm test -- test/bubblewrap-guard.test.ts`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh static-analysis`. File:line references are accepted when needed but discouraged because line numbers rot.
- A summary of work done
- Include the exact heading `## Goal Check`.
- Under that heading, include the exact 3-column table header `| Criterion | Evidence | Status |` and one evidence row for every success criterion.
- For CP 1, record the exact regression-test name and `test/bubblewrap-guard.test.ts`, plus proof that it is red against the mission parent commit and green after the fix.
- Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; pair any shell output with an accepted command, test name, ADR reference, or repository path above.
- A non-generic `Next action:` line at the bottom

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- The review worktree mount and all reviewed source, configuration, test, documentation, and mission files must remain read-only under `bwrap`.
- Do not make `/home`, the full Claude home, the full `.workflow` directory, or a worktree parent directory writable to solve launcher initialization.
- Do not modify task-2374's completed backlog record; document the superseding review-profile behavior in `docs/agents.md`.
- Preserve custom-agent launcher compatibility and existing non-review sandbox permissions.

## Stop Rules
- Stop and escalate if any supported launcher's state home cannot be resolved without granting write access to a parent directory that contains reviewed worktree content.
- Stop and escalate if making Claude session persistence writable requires binding the whole user home or exposes transcript paths outside the active worktree's session directory.
- Stop and escalate if a test demonstrates that a reviewer can write a reviewed source, configuration, test, documentation, or mission file after the proposed change.
- Stop and escalate if a required launcher-specific change alters non-review sandbox behavior or reviewer selection/fallback semantics.
