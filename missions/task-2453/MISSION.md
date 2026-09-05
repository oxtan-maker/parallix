# Mission: Show live integrate progress on the board (task-2453)

## Goal
Make an active `px integrate <slug>` visibly in progress on both operator surfaces: the web card spins for an unverified current-work fact, and its action control moves from the brief start state to a running state while the operation remains pending.

## Why Now
The integrate command already publishes current-work before its gates begin, but the web board rejects that fact when its process liveness probe cannot verify the process. Operators consequently see a still card and `starting…` throughout a genuine long-running integration, obscuring the state they need to monitor.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Align web liveness rendering with the existing board in-progress definition; distinguish initial action submission from an operation that is still running; lock the regression across the web and Ink projections.

## Scope
- Add a red-to-green regression test under `test/task-2453-repro.test.ts` for an `integrate` current-work fact whose freshness is `unverified`.
- Align web fan animation with the board's established in-progress treatment of `live` and `unverified` work, while retaining still rendering for cleared and `stale` work.
- Change the pending integrate action copy so the just-submitted state is distinct from the continuing running state.
- Verify the Ink TUI and web board derive the same live-work state from the authoritative current-work projection.

## Out of Scope
- Change how `px integrate` publishes or closes current-work facts; the write-side timing is already correct.
- Make the board liveness probe able to observe the integrate process.
- Fix the separate concurrent `px integrate`/`px draft` main-checkout collision involving `integrate-conflict.ts`.
- Redesign the web board, action button, or Ink TUI beyond the stated live-work feedback.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A regression test at `test/task-2453-repro.test.ts` fails at the mission parent commit because a current `integrate` fact with `unverified` freshness does not spin, and passes after the fix because that same fact spins.
- SC2: The web board spins its fans when the current-work fact is `live` or `unverified`, and does not spin when the fact is cleared or `stale`.
- SC3: During a pending integrate action, the action control shows `starting…` only for the initial submission window and shows a running/working label for the continuing operation.
- SC4: Given the same current-work projection, the Ink TUI and web board both represent `live` and `unverified` work as in progress.
- SC5: `./scripts/verify-local.sh all` completes successfully on the final mission tree.

## Risks and Assumptions
- Assumption: `unverified` means server-reported work is underway, consistent with the existing board `isWorkInProgress` rule.
- Risk: The action button has no elapsed/pending distinction available in its current inputs; if so, stop and identify the smallest existing lifecycle signal that can supply it rather than inventing a parallel timer or state authority.
- Risk: Web and Ink may format their projections independently; preserve the current-work fact as the sole authority and add focused coverage for their shared states.

## Checkpoints
- CP 1: Before any production fix, author `test/task-2453-repro.test.ts` to project an active `integrate` fact with `unverified` freshness and assert the web fan is spinning. Confirm it is red at the mission parent commit and retain it as the green regression test after the fix.
Reproduction-Test: test/task-2453-repro.test.ts
- CP 2: Trace the web board, action-button, and Ink projection paths; apply the minimum change that makes `unverified` in-progress everywhere and replaces the long-running pending `starting…` label.
- CP 3: Extend focused coverage for cleared and `stale` non-spinning states and for web/Ink agreement on `live` and `unverified` projections.
- CP 4: Run the required repository gate and write the final checkpoint with the completed Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm test -- test/task-2453-repro.test.ts`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done, the exact heading `## Goal Check`, and this exact three-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one durable evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not evidence: pair any shell output with an accepted command, path, exact test name, or ADR reference above. End with a specific `Next action:` line; for CP 1, record the red result for `test/task-2453-repro.test.ts` before a production change, and for the final checkpoint record the green result and `./scripts/verify-local.sh all`.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `integrate-conflict.ts` or any main-checkout stash/reset behavior; that concurrency defect is a separate backlog item.
- Do not alter current-work publication timing, process ownership, or the liveness-probe transport.
- Do not introduce a new client-side state authority, timer framework, or dependency for action-button progress.

## Stop Rules
- Stop if `unverified` is not produced by the same authoritative current-work projection consumed by both surfaces; report the divergent authority before changing rendering.
- Stop if the action button cannot distinguish initial submission from continued execution using existing lifecycle data; report the missing signal before adding state.
- Stop if the reproduction cannot be made red at the parent commit without mocking external process or Forgejo boundaries; narrow the test to the deterministic projection boundary and document that boundary.
