# Mission: Reset mission base branch when px draft starts (task-2396)

## Goal
Ensure every `px draft` invocation establishes the mission's current launch base before downstream lifecycle work resolves it, replacing stale `Base-Branch` metadata on existing missions.

## Why Now
Re-drafting from the primary branch can leave a previous feature branch in `MISSION.md`, causing integration-branch resolution to use a branch that no longer exists and preventing the backlog transition. Task-2389 exposed this when `friday-08-21` disappeared.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: confined draft-startup metadata flow; focused regression coverage for primary and feature launch bases

## Scope
- Establish or replace mission base-branch state during draft startup before downstream mission lifecycle work consumes it.
- Cover an existing mission with stale `Base-Branch: friday-08-21` launched from `main`.
- Cover re-drafting an existing mission from a non-primary branch so its launch branch replaces a prior base value.
- Preserve the current behavior for new mission branches and reused mission worktrees except for corrected base resolution.

## Out of Scope
- Changing integration-branch naming or branch-resolution rules outside draft startup.
- Migrating or cleaning historical mission metadata unrelated to the active `px draft` invocation.
- Changing backlog ownership, phase transitions, or documentation scaffolding beyond metadata needed for the launch base.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Re-running `px draft` for an existing mission from `main` replaces or removes a stale feature `Base-Branch` value before `resolveMissionBaseBranch` is used, and the resolved base is `main` before the backlog transition.
- Re-running `px draft` for an existing mission from a non-primary branch records that launch branch and replaces any previous primary or feature base value before downstream lifecycle work consumes it.
- A regression test at `test/draft.test.ts` creates an existing mission with `Base-Branch: friday-08-21`, launches draft from `main`, fails at the mission parent commit because stale branch resolution causes the lifecycle failure, and passes after the fix without that failure.
- New mission branch creation and existing mission worktree reuse retain their prior draft behavior, apart from the corrected resolved base branch.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumes the primary branch is determined by the existing draft and git-worktree utilities rather than hard-coded in a new code path.
- Risk: updating durable mission metadata at the wrong point could leave downstream readers observing stale state; the change must precede all launch-base consumers.
- Risk: changing setup logic could alter new-mission creation or worktree reuse; focused tests must distinguish those existing flows from base metadata correction.

## Checkpoints
- CP 1: Add the failing regression test in `test/draft.test.ts` before changing implementation. It must seed an existing mission with `Base-Branch: friday-08-21`, invoke draft from `main`, and assert the stale branch cannot cause integration-branch resolution or lifecycle setup to fail. Record its red result at the mission parent commit and its green result after the fix.
- CP 2: Trace all callers of the draft-startup base-state writer and resolver, then make the smallest shared change that records the current launch base before downstream lifecycle work.
- CP 3: Extend focused draft coverage for a non-primary re-draft and confirm new mission creation plus existing-worktree reuse preserve their prior behavior.
- CP 4: Run the required verification gate and write the final checkpoint with criterion-by-criterion durable evidence.

Reproduction-Test: test/draft.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
Durable evidence must lead: cite exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot. Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted reference above.

- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with one evidence row for every success criterion.
- For CP 1, the exact failing test name and `test/draft.test.ts`, plus the command that demonstrates red at the parent commit; for later checkpoints, cite the corresponding green test command or exact test name.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify unrelated draft commands, integration-branch resolution semantics, or mission/backlog lifecycle policy.
- Do not alter documentation scaffolding as a substitute for establishing launch-base state in draft startup.
- Do not add dependencies or broaden the change beyond the draft command, its existing git-worktree support, and focused tests.

## Stop Rules
- Stop and escalate if the existing draft utilities cannot determine the primary branch or current launch branch without changing shared git semantics.
- Stop and escalate if correcting base metadata requires changing backlog transition rules, integration-branch naming, or persisted metadata outside the active mission.
- Stop after the regression is green, existing-flow coverage is preserved, and the required gate succeeds; do not add migration work for historical missions.
