# Mission: Prevent merged missions from remaining active (task-2497)

## Goal
Make merge detection authoritative during mission lifecycle transitions. When a
mission's committed payload is already contained in `main`, the workflow must
treat the mission as landed: it must not start a second handoff or review, it
must complete the lifecycle, and it must clean up the mission branch and
worktree exactly once. If cleanup cannot safely finish, it must report a
durable, actionable recovery state instead of claiming completion.

The concrete regression target (TASK-2492): an active mission whose committed
payload is already on `main` must not stay `active` and must not launch another
review.

## Why Now
The lifecycle authority work in TASK-2379 made `px integrate` reconcile stale
`active`/`review` missions through the existing authoritative transition chain,
and TASK-2492 wired a failed integration gate through the routing module.
Neither makes the *merge itself* authoritative: detection still assumes a
mission in `active` still has work to do. A subsequent handoff therefore
rebases and reviews work that is already landed, producing conflicts and
leaving stale branch/worktree resources behind. The recovery path that does
exist (`recoverMissionLifecycle`, invoked by `px recover`) only fires for the
`taskStatus = active && aggregateStatus = done` split; an active mission whose
payload is already on `main` (aggregate still `active`) falls through to no
detection at all.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: lifecycle authority invariant (TASK-2379), landed-work re-handoff regression (TASK-2492 repro), stale branch/worktree resource leak

## Scope
- Merge detection: when a mission's committed payload is already contained in `main`, the mission is treated as landed.
- The lifecycle recovery path (`recoverMissionLifecycle`, wired through `px recover` at `src/interfaces/cli/recover.ts` and `src/composition/create-cli.ts`) recognizes the already-merged active mission and refuses to reopen it for review.
- The workflow does not start a duplicate handoff or review for an already-merged mission.
- Lifecycle completion: the mission's lifecycle record is closed for an already-merged mission.
- Branch/worktree cleanup is attempted exactly once via the existing `cleanupMissionWorktree` seam (`src/adapters/cli/commands/integrate-post.ts`); failure returns a durable recovery result rather than claiming success.
- The TASK-2492 regression: an active mission whose committed payload is already on `main` is detected, not re-reviewed, and cleaned up.
- A focused regression test under `test/` locks the bug before the fix.

## Out of Scope
- Redesigning the Mission state machine or the review domain (TASK-2379 already owns those invariants).
- New lifecycle transitions, new recovery states, or a second recovery subsystem.
- Any change to the normal `active → review → integration → done` happy path.
- Re-implementing merge detection inside `integrate.ts`; reuse the existing git containment check (`merge-base`/`--contains` style) rather than a new one.
- Statistics, telemetry, or review-stat inference (TASK-2379 already made those authoritative).
- Direct `review → done` or `active → done` shortcuts; completion still flows through integration landing.
- Forgejo PR state changes beyond what is needed to recognize an already-merged payload.
- Agent-backed E2E, network-backed tests, or real Forgejo access.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no
> unqualified adjectives or vague quantifiers.

- SC1 An active mission whose committed payload is already on `main` is detected as landed by the recovery path and is not transitioned back to `active` for review.
- SC2 The recovery result for an already-merged active mission reports `action = refused-integrated` (or an equivalent "already landed" outcome) instead of `recover-to-active`.
- SC3 No second handoff or review is launched for an already-merged mission: the workflow closes the lifecycle or returns a recovery result without invoking a review/handoff operation.
- SC4 Branch/worktree cleanup for the already-merged mission is attempted exactly once through `cleanupMissionWorktree`; a cleanup failure returns a durable recovery result and does not claim completion.
- SC5 The TASK-2492 regression test (see Checkpoint 1) is red at the mission parent commit and green after the fix.
- SC6 The normal lifecycle `active → review → integration → done` still passes unchanged; no previously passing lifecycle regression regresses.
- SC7 `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Merge detection must use authoritative git containment (the committed payload is an ancestor of / contained in `main`), not PR prose, branch naming, or backlog text.
- Cleanup must be side-effect-safe: it deletes a worktree and branch, so it must only run once and must never delete the Forgejo home or `main`. It must guard on branch existence and worktree registration before removing.
- The recovery path currently only fires for `taskStatus = active && aggregateStatus = done`; this mission extends detection to the active/active case where the payload is already on `main`. Assumption: no supported workflow legitimately keeps an already-merged mission open.
- Do not make `px integrate` strict at the orchestration boundary (TASK-2379 anti-slop): recovery must reuse existing transitions, never mutate statuses directly.
- The `findTransitions` seam may be unavailable on some stores; detection must not crash when it is absent — it must fall back to a durable, non-completing recovery result.

## Checkpoints
- CP 1: Author the failing reproduction test that locks the TASK-2492 regression before any fix (red).
- CP 2: Add authoritative merge detection to the recovery path for an active mission whose payload is already on `main`.
- CP 3: Ensure the workflow does not launch a duplicate handoff/review and closes the lifecycle for the already-merged mission.
- CP 4: Attempt branch/worktree cleanup exactly once; return a durable recovery result on cleanup failure.
- CP 5: Full verification — regression suite, lifecycle regression, static analysis.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `px recover <slug>` ``, `` `npm test -- test/<file>.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `git merge-base --is-ancestor …` ``
  2. **Test names** — must match a test name in the repo exactly (e.g. the TASK-2492 reproduction test name you author).
  3. **Test file paths** — e.g., `test/task-2492-already-merged-repro.test.ts` (must be an existing test file).
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`).
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above.
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: a raw `git`/`ls`/`stat` block alone, or a prose paragraph ("the fix works"), is NOT sufficient evidence. Every claim of a behavior must be paired with one of the accepted references above (a test name, a test file path, an ADR reference, or a recognized repo command).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Reproduction test locks the already-merged regression | `test/task-2492-already-merged-repro.test.ts`, `"TASK-2492: an active mission already on main is refused, not re-reviewed"` | PASS |
| Recovery refuses an already-merged active mission | `px recover <slug>` with seeded state | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `docs/adr/` state-machine and review-domain ADRs (do not alter the `active → review → integration → done` invariant; TASK-2379 owns it).
- The Mission domain state machine and `mission-workflow.ts` decision rules — only extend recovery detection, never add transitions.
- Forgejo PR write paths — read-only recognition of an already-merged payload.
- Statistics/telemetry derivation — out of scope; do not touch.
- Any real Forgejo, real git remote, or network boundary in tests.

## Stop Rules
- Stop before writing any fix until the reproduction test is red at the mission parent commit.
- Stop if the fix would add a new lifecycle transition, a new recovery state, or a second recovery subsystem — that is scope creep, not this mission.
- Stop if merge detection relies on PR prose, branch naming, or backlog text instead of authoritative git containment.
- Stop if cleanup could run more than once or could delete `main` or the Forgejo home.
- Stop after `./scripts/verify-local.sh all` passes; do not run additional test suites or start a review/integrate phase.
- Do not push the mission branch to `origin`; only `main` may be pushed to `origin`.
