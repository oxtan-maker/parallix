# Mission: Self-heal the review loop when no open PR exists (task-1303)

## Goal
When `startReviewLoop` reaches the provider check and finds **no open PR** for a mission
whose task is already in a post-implementation state (`review` / `approved` /
`ready-for-integration`), stop dead-ending. Instead, **automatically run the handoff**
(push branch + create PR) and continue the loop once the PR exists. Only when that
self-heal cannot produce an open PR do we surface an error — and that error must recommend
the correct command (`px review <slug> --push`) plus the underlying failure reason,
instead of today's unconditional, frequently-wrong `--submit`.

## Why Now
Users upgrading to the latest parallix repeatedly hit `No open review PR found for
mission/task-NNNN` during the review loop (task description; reproduced on task-1299).

Root-cause research (this mission): the *original* cause of those logs — the automated
post-execute handoff aborting on the first push of a brand-new mission branch
("could not find remote ref") — was **already fixed by task-1317** (done 2026-06-16;
verified live in `lib/tools/forgejo.js:808-812,825-829`, first-push falls back to a plain
push). So the happy auto-handoff path now produces a PR and the loop finds it.

What remains is the **non-happy path**: the loop can still be *entered* with no open PR —
e.g. a manual `px review <slug>` that bypassed handoff, a handoff that partially failed,
or a closed/merged PR. Today that path hard-fails with misleading `--submit` guidance
(`lib/review/review-loop.js:550-557`). Since `createPr`/handoff now work reliably, the
loop should just heal itself rather than hand the user a command to run by hand.

## Current Behavior (verified)
- `lib/review/review-loop.js:537-558`: after the provider is confirmed reachable, it calls
  `getPrStatusFn(branch, worktree)`. When `!pr.exists || pr.state !== 'open'`:
  - **Implementation phase** (`taskStatus === 'active'` or virtual `active`,
    lines 546-549): logs an INFO soft-warning recommending `--push`, returns (no exit).
    **Correct — must not change.**
  - **Post-implementation / ambiguous** (lines 550-557): errors `No open review PR
    found ...`, prints `Run: px review <slug> --submit`, `exit(1)`. **This is the dead-end
    we are replacing with self-heal.**
- `performHandoff(slug, { forgejoUser, worktree })` is already imported
  (`lib/review/review-loop.js:21`) and is the canonical "make this mission reviewable"
  operation: it runs the verification gate, pushes the branch, calls `forgejo.createPr`
  (idempotent — returns the existing open PR or creates one), and transitions the task to
  `review`. `transitionTask(slug, 'review')` is idempotent when the task is already in
  `review` (`lib/tools/backlog.js:406`, returns `true` "already in desired state"), so
  calling it from the loop is safe. It returns `{ ok, error?, gatekeeperPushedBack? }`.
- The module is built on injected `*Fn` dependencies with production defaults
  (destructured options block ~`lib/review/review-loop.js:290-320`); existing tests drive
  it with mock `*Fn`s. New behavior must therefore go through an injected dependency.

## Scope
- Inject `performHandoffFn = performHandoff` into `startReviewLoop` (default = the already-
  imported `performHandoff`) so the self-heal is mockable.
- Replace the post-implementation hard-fail branch (`lib/review/review-loop.js:550-557`)
  with self-heal, only when `!dryRun`:
  1. Log INFO: no open PR for a task in `<status>` — attempting automatic handoff.
  2. `const handoff = await performHandoffFn(slug, { forgejoUser: implementer, worktree })`.
  3. If `handoff.gatekeeperPushedBack` → log that mandatory artifacts are missing and the
     task stays in its current state; `exit(1)` (do not spin the loop on missing
     artifacts).
  4. If `!handoff.ok` → **fallback guidance** (below); `exit(1)`.
  5. If `handoff.ok` → re-call `getPrStatusFn(branch, worktree)`. If a PR now exists and is
     open, log recovery, set `prNumber`, and fall through into the normal loop. Otherwise
     → **fallback guidance**; `exit(1)`.
- Fallback guidance (used only when self-heal cannot yield an open PR): keep the
  `No open review PR found ...` headline, surface the handoff failure reason when present,
  and recommend `px review <slug> --push` (the push+create-PR command self-heal attempted,
  and the correct manual equivalent) — **not** `--submit`.
- In `dryRun`, do not call `performHandoffFn`; emit the fallback guidance text and exit as
  today (no agents/side effects in dry-run).

## Out of Scope
- `forgejo.createPr` / `buildCreatePrPushArgs` internals (fixed under task-1317).
- `pushRound` / `submitForReview` command logic and `--push`/`--submit` flag parsing.
- The state machine and task status transition rules.
- The `active` implementation-phase soft-warning path (lines 546-549).
- The `No open review PR found` headline text and `exit(1)` semantics of the fallback.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. Provider enabled, `getTaskStatusFn` → a post-implementation state (`review` /
   `approved` / `ready-for-integration`), first `getPrStatusFn` → `{ exists: false }`, and
   a mocked `performHandoffFn` → `{ ok: true }` after which `getPrStatusFn` →
   `{ exists: true, state: 'open', number: N }`: `performHandoffFn` is called with
   `{ forgejoUser: implementer, worktree }`, `exit` is **not** called for the PR-missing
   reason, `prNumber === N`, and the loop proceeds.
2. Same setup but `performHandoffFn` → `{ ok: false, error: 'gate failed' }`: the emitted
   error includes `--push` and the failure reason, does **not** recommend `--submit`, and
   `exit(1)` is called.
3. Same setup but `performHandoffFn` → `{ ok: true }` and the post-handoff `getPrStatusFn`
   still returns `{ exists: false }`: fallback guidance is emitted (`--push`, no
   `--submit`) and `exit(1)` is called.
4. `performHandoffFn` → `{ ok: true, gatekeeperPushedBack: true }`: an artifacts-missing
   message is logged and `exit(1)` is called; the reviewer is never launched.
5. The `active` implementation-phase path (lines 546-549) is unchanged: INFO `--push`
   guidance, early return, no `exit`, and `performHandoffFn` is **not** called.
6. The unresolvable-task hard-fail (`taskResolution.ok === false`, lines 507-511) is
   unchanged: reports the resolution failure and exits 1 without invoking self-heal.
7. In `dryRun`, `performHandoffFn` is never called and the existing dry-run behavior holds.
8. `npm test` completes with zero failures across the full suite.

## Risks and Assumptions
- `performHandoff` re-runs the verification gate (`stdio: 'inherit'`) and the gatekeeper;
  the self-heal therefore inherits their cost and any uncommitted-tree failures. This is
  acceptable — it is the same work the original handoff would have done — and is gated to
  `!dryRun`.
- Self-heal is idempotent: `createPr` returns the existing open PR if one appears
  concurrently, and the `review` transition is a no-op when already in `review`.
- The existing post-implementation tests
  (`startReviewLoop hard-fails when task is review/approved and no PR exists`,
  `test/review.test.js:~3581+`) change meaning: with a successful mocked `performHandoffFn`
  they now expect recovery, and with a failing one they expect the `--push` fallback. They
  must be updated to inject `performHandoffFn` and assert the new behavior.

## Checkpoints
- CP 1: Inject `performHandoffFn`; implement the self-heal sequence (attempt → re-check →
  recover or fallback) in the post-implementation branch, gated to `!dryRun`.
- CP 2: Implement the corrected `--push` fallback message (with handoff reason) and the
  `gatekeeperPushedBack` short-circuit.
- CP 3: Update the existing review/approved no-PR tests; add tests for recovery (crit. 1),
  failed-handoff fallback (crit. 2/3), gatekeeper pushback (crit. 4), and dry-run
  (crit. 7); run `npm test` to green.

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test (all tests pass)

## Restricted Areas
- Do not modify `lib/tools/forgejo.js` (createPr/first-push fixed under task-1317) or
  `lib/commands/handoff.js` — call `performHandoff`, don't change it.
- Do not modify `lib/commands/review-commands.js` (`pushRound`, `submitForReview`).
- Do not modify the soft-warning path at `lib/review/review-loop.js:546-549`.
- Do not change task status transitions or the state machine.

## Stop Rules
- Stop if self-heal requires changes beyond `lib/review/review-loop.js` and
  `test/review.test.js` (plus, if strictly needed for injection wiring, the import line).
- Stop if `performHandoff` cannot be driven deterministically as an injected dependency in
  tests, or if self-heal introduces test flakiness or real network/agent calls in tests.
- Stop if `npm test` reveals the change breaks unrelated suites beyond the review tests.
