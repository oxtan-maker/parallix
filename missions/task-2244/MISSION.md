# Mission: Keep `px integrate` Backlog metadata on the primary branch (task-2244)

## Goal
Fix `px integrate` so all Backlog task metadata used for integration decisions is read from and written to the primary/base worktree. The mission worktree must not provide a fallback status or task-file authority.

## Why Now
`buildIntegrationContext` currently resolves the task from the mission worktree first and can replace a `backlog` status from the base worktree with a non-backlog status from the mission worktree. That violates the established rule that Backlog reads and writes use the primary branch because worktree copies can be stale. It causes preflight to report a stale mission-worktree status such as `active` even when the primary worktree has the integration-ready status.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: `buildIntegrationContext` task resolution in `lib/commands/integrate.ts`, its regression coverage in `test/integrate.test.js`, and verification that existing promotion writes remain on the base worktree

## Scope
- Change `buildIntegrationContext` in `lib/commands/integrate.ts` to resolve the task and `taskStatus` from the base worktree first and only. Do not read task status from the mission worktree as a fallback.
- Keep `promoteTaskForIntegrationIfNeeded` writing the approved status through `context.baseWorktree`; add or retain focused coverage that proves this write target is the base worktree task file.
- Update the existing `test/integrate.test.js` coverage so a mission-worktree status of `"active"` and base-worktree status of `"ready-for-integration"` yields `context.taskStatus === 'ready-for-integration'` and retains the base task-file path.

## Out of Scope
- Changes to status rules in `evaluateTaskStatusForIntegration` — the bug is task metadata source selection, not status eligibility.
- Changes to `resolveBacklogStateRoot` or `transitionTaskOnIntegrationBranch` in `lib/tools/backlog.ts` — those already use the correct base-worktree logic.
- Changes to other preflight checks (Backlog task, Backlog classification, Forgejo PR, etc.).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `buildIntegrationContext` resolves both `context.task.taskFile` and `context.taskStatus` from the base worktree task file, not from the mission worktree task file.
- SC2: A base-worktree status of `"backlog"` remains `"backlog"`; no mission-worktree status may replace it.
- SC3: `test/integrate.test.js` includes a case with mission-worktree status `"active"` and base-worktree status `"ready-for-integration"` that asserts the context retains the base task-file path and `context.taskStatus === 'ready-for-integration'`.
- SC4: Focused promotion coverage proves `promoteTaskForIntegrationIfNeeded` writes the approved status to the base-worktree task file.
- SC5: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: A legacy recovery flow without a base worktree cannot safely infer authoritative metadata from a mission worktree. Mitigated by failing task resolution rather than silently reading the mission copy.
- Risk: Other callers may have depended on the worktree value. Mitigated by keeping this change limited to integration context and testing the exact selected task path and status.
- Assumption: The base worktree supplied to integration is the primary-branch worktree for this mission.

## Checkpoints
- CP 1: Author a failing reproduction test in `test/integrate.test.js` with mission-worktree status `"active"` and base-worktree status `"ready-for-integration"`; assert the selected task file and `context.taskStatus` both come from the base worktree.
- CP 2: Change `buildIntegrationContext` to use only the base-worktree task file for integration metadata. Confirm promotion continues to write through `context.baseWorktree`, then run `./scripts/verify-local.sh all`.

Reproduction-Test: test/integrate.test.js (new test case in the existing file)

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/integrate.ts:912` (must point to an existing file and line)
  2. **Test names** — e.g., `"buildIntegrationContext uses base worktree status over worktree status"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/integrate.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/integrate.test.js` ``, `` `px integrate task-2244 --dry-run` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| buildIntegrationContext resolves taskStatus from base worktree | `lib/commands/integrate.ts:912` | PASS |
| Regression test covers worktree-active / base-ready-for-integration scenario | `test/integrate.test.js`, `"buildIntegrationContext uses base worktree status over worktree status"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [x] `./scripts/verify-local.sh all`

## Restricted Areas
- `lib/tools/backlog.ts` — do not modify unless focused test evidence demonstrates that its explicit base-worktree write path is incorrect.
- `lib/core/state-map.ts` — do not modify; the state mapping is correct
- `lib/commands/integrate.ts` lines outside `buildIntegrationContext` — do not modify the preflight printing, promotion, or squash-merge logic

## Stop Rules
- Stop if the base worktree cannot be resolved during integration; do not substitute the mission worktree as an authority.
- Stop if changing `context.task.taskFile` to the base-worktree path breaks a downstream integration write or closeout path; trace and correct that path to use `context.baseWorktree` explicitly.
