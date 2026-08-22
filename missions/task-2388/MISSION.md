# Mission: Make running-session recovery repository-safe and refresh-visible (task-2388)

Base-Branch: friday-08-21

## Goal

Make the bounded OS-process running-session recovery path trust only sessions proven to belong to the current repository, resolve slug-less agent commands from nested directories inside known mission worktrees, and cause the open board to repaint whenever recovered session state changes.

## Why Now

The fallback currently treats an explicit mission slug from the machine-wide process table as local without repository evidence. A same-named mission in another checkout can therefore affect this board, while a real local command started below a worktree root can be missed. Even when recovery data changes correctly, the subscription fingerprint omits it, leaving the interactive board stale until some unrelated state changes.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: repository ownership validation for explicit-slug processes, nested-CWD worktree resolution, and board fingerprint coverage for recovered sessions

## Scope

- `src/adapters/agents/running-sessions.ts`: require repository/worktree evidence before accepting an explicit-slug agent-launching `px` process; resolve a process CWD that is inside, rather than exactly equal to, a listed mission worktree; preserve unknown when incomplete evidence makes the count untrustworthy.
- `src/application/projections/board-subscription.ts`: include each card's `liveSession` state and `metrics.unattributedRunningSessions` in the board fingerprint.
- `test/task-2388-repro.test.ts`: add the red-to-green regression reproduction covering the unsafe recovery and fingerprint-only refresh paths.
- `test/running-sessions.test.ts` and `test/task-2373-refresh-performance.test.ts`: add focused coverage for the intended detector and subscription behavior where it fits the existing test seams.

Reproduction-Test: test/task-2388-repro.test.ts

## Out of Scope

- Replacing the recovery scan with a durable process registry, daemon, watcher, or event bus.
- Changing session-marker ownership, current-work reconciliation, board layout, or refresh interval.
- Treating a missing process table, repository association, or worktree listing as evidence that no session is running.
- Changing repository identity rules outside the running-session recovery path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: An explicit-slug agent-launching `px` process is returned only when its resolved worktree belongs to the board repository; a process with the same slug in a different repository produces no local running session.
- SC2: A slug-less agent-launching `px` process whose CWD is a descendant of a listed mission worktree resolves to that worktree's mission and is returned once.
- SC3: When repository or worktree evidence required to attribute a candidate is unavailable, the detector returns `null` when omitting that candidate would make the count untrustworthy and otherwise ignores the candidate; it never emits a fabricated local `RunningMissionSession`.
- SC4: `boardFingerprint` changes when a card's `liveSession` changes and when `metrics.unattributedRunningSessions` changes, with all other fingerprint inputs held equal.
- SC5: `test/task-2388-repro.test.ts` fails against the mission parent commit for the cross-repository collision, nested-worktree CWD, and fingerprint-only recovery scenarios, then passes after the implementation.
- SC6: Focused detector and subscription tests cover the cross-repository slug collision, nested worktree CWD, and changes that require a board repaint only because recovered session state changed.
- SC7: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` pass on the final tree.

## Risks and Assumptions

- Risk: `/proc/<pid>/cwd` may be unavailable or point outside a mission worktree. Mitigation: keep the existing conservative unknown/ignore distinction; do not infer locality from a slug alone.
- Risk: path-prefix matching can confuse sibling worktrees with shared prefixes. Mitigation: require directory-boundary-aware containment when resolving a nested CWD.
- Assumption: `git worktree list --porcelain` run from the board repository is the authoritative map of its mission worktrees.
- Assumption: the board projection already exposes `liveSession` per card and `unattributedRunningSessions` in metrics, so only fingerprint inclusion is needed for repainting.

## Checkpoints

- CP 1: Before any production fix, author `test/task-2388-repro.test.ts`. It must create a board-repository worktree map and an external-repository process with the same explicit slug, assert that the detector does not report the external process, then exercise a slug-less agent command from a nested directory under a listed mission worktree and assert that it resolves to that mission. It must also compare otherwise-identical projections whose only changes are `liveSession` and `unattributedRunningSessions`, asserting distinct fingerprints. These assertions must fail at the mission parent commit (red) and pass after the fix (green).
- CP 2: Update running-session recovery in `src/adapters/agents/running-sessions.ts` so explicit-slug candidates are repository-scoped and descendant CWDs resolve to their registered mission worktree; retain conservative unknown/ignore behavior for absent evidence.
- CP 3: Update `boardFingerprint` in `src/application/projections/board-subscription.ts` to represent `liveSession` and unattributed-running-session state, then add or extend focused tests for detector attribution and repaint triggering.
- CP 4: Run the focused regression test, complete the final Goal Check evidence, and run the required repository verification gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- An exact `## Goal Check` heading
- A 3-column pipe-delimited markdown table with exactly `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using the durable forms above, such as `test/task-2388-repro.test.ts`, an exact `node --test ...` command, an exact test name, `ADR 0039`, or `./scripts/verify-local.sh all`
- A non-generic `Next action:` line at the bottom

Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Explicit slugs require local repository evidence | `test/task-2388-repro.test.ts`, exact regression test name | PASS |
| Recovery-only state repaints the board | `test/task-2373-refresh-performance.test.ts`, exact subscription test name | PASS |
| Final verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `src/application/projections/board-readers.ts` — it supplies recovery facts but is not changed unless the existing projection shape cannot support the fingerprint criteria.
- `src/application/projections/mission-board.ts` and `src/application/projections/board.ts` — do not alter board presentation or domain projection contracts for this recovery fix.
- Session-marker repositories and current-work reconciliation — they are separate evidence sources and must not be repurposed to compensate for process-scan uncertainty.
- Any repository outside the current board repository — process observations from them must not be treated as local board state.

## Stop Rules

- Stop and report if repository ownership cannot be established using the existing worktree/process evidence without changing repository identity infrastructure.
- Stop and report if making a nested CWD match requires a non-boundary-safe string-prefix rule; sibling worktrees must remain distinct.
- Do not add a persistent session registry, polling service, watcher, event bus, dependency, or configuration knob.
- Do not weaken `null` as the unknown result when an incomplete observation could make the count incorrect.
- Do not modify source code during this draft phase; the implementation begins only after the mission is activated.
