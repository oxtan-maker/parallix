# CP-3 — Verification and final evidence

## Summary

Verified the fix on the committed tree and closed out SC1–SC7.

- The mission's single declared gate, `./scripts/verify-local.sh all`, **exits
  0**: 2377 tests, 0 fail, 0 skipped, 0 todo. (The `Failure history: …
  hook-failure:pre-commit …` line in that output is fixture data inside a
  repair-loop test, not a gate failure; the run's exit status is 0.)
- `./scripts/verify-local.sh static-analysis` reports **ALL STAGES PASSED** —
  ESLint clean, `npm run typecheck` clean, test-hygiene clean, test typecheck
  clean — covering every file the mission changed.
- The reproduction at the mission's declared `Reproduction-Test:` path runs
  green alone: `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts`
  → 2 tests, 2 pass, 0 fail. At CP-1, before the fix, its SC1 case failed with
  `Duplicate idempotency key: handoff-task-2456-retry`.

Behaviour delivered: a retried `px handoff` whose `submit-for-review`
transition already committed its `active -> review` lane event under the stable
key `handoff-${slug}` now completes and lets `performHandoff` reach the Backlog
sync to `review`, instead of reporting a conflict. Duplicate keys that are not a
replay of a recorded transition, and every stale-version refusal, still return
`failure('conflict', …)`.

Changed files (`git show --stat 9ffbc2ad3`, plus `f63cf8349` for the test):

| File | Change |
|---|---|
| `src/application/lifecycle-lane-event.ts` | new `isReplayedLaneEvent` discriminator |
| `src/application/domain-ports.ts` | `MissionTransitionHistoryEntry` widened with optional `fromStatus`/`toStatus`/`idempotencyKey` |
| `src/application/mission-lifecycle-service.ts` | `transition()` completes a confirmed replay |
| `src/application/mission-integration-service.ts` | `decideIntegration()`/`close()` share the same treatment via `duplicateOutcome` |
| `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` | red-to-green reproduction, both SC1 and SC2 cases |

Nothing in the mission's Restricted Areas moved: `src/domain/mission-workflow.ts`,
`laneEventIdempotencyKey`, the `handoff-${slug}` key site in
`src/application/handoff-command-use-case.ts`, `migrations/`, `docs/adr/`, and
the Forgejo/gatekeeper/NEL/Backlog-write adapters are all untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — retried `submit-for-review` under the stable `handoff-${slug}` key returns `completed` with `to === 'review'` and the persisted version | `"a retried handoff replays its already recorded active -> review lane event instead of conflicting"` in `test/task-2456-handoff-retry-duplicate-lane-event.test.ts`; run with `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` | PASS |
| SC2 — a `Duplicate idempotency key` that is not a replay of persisted state still returns `failure('conflict', …)` | `"a duplicate handoff key on a distinct approve transition stays a conflict"` in `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` asserts `status === 'failed'` and `error.kind === 'conflict'` | PASS |
| SC3 — the reproduction at the declared path is red before the fix and green after, measured alone | Red diagnostic recorded in `missions/task-2456/CP-1.md` (`Duplicate idempotency key: handoff-task-2456-retry`, commit `f63cf8349`, fix not yet applied); green after `9ffbc2ad3` via `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` (2 pass, 0 fail) | PASS |
| SC4 — `./scripts/verify-local.sh all` exits 0 on the final tree | `./scripts/verify-local.sh all` → `exit=0`, `ℹ tests 2377`, `ℹ pass 2377`, `ℹ fail 0` | PASS |
| SC5 — ESLint, `tsc --checkJs`, and test-hygiene report zero findings on every changed file | `./scripts/verify-local.sh static-analysis` → "=== Static Analysis Gate: ALL STAGES PASSED ===" | PASS |
| SC6 — no `.only` and no bare `.skip` in any test file the mission touched | `grep -n "\.only\|\.skip" test/task-2456-handoff-retry-duplicate-lane-event.test.ts` exits 1 with no matches; `./scripts/verify-local.sh static-analysis` test-hygiene stage is clean and the gate reports `ℹ skipped 0`, `ℹ todo 0` | PASS |
| SC7 — the final `## Goal Check` table cites a durable reference per criterion | This table cites `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts`, the two exact test names above, and the paths `test/task-2456-handoff-retry-duplicate-lane-event.test.ts`, `src/application/mission-lifecycle-service.ts`, `src/application/mission-integration-service.ts`, `src/application/lifecycle-lane-event.ts`, `src/application/domain-ports.ts` | PASS |
| Backlog DoD #1 — a repeated handoff after its review transition committed succeeds so the Backlog task can sync to `review` | `"a retried handoff replays its already recorded active -> review lane event instead of conflicting"` asserts the persisted mission reaches `review`, which is what `performHandoff` requires before calling `ports.backlog.transitionTask(slug, 'review', …)` in `src/application/handoff-command-use-case.ts` | PASS |
| Restricted areas untouched | `src/domain/mission-workflow.ts`, `laneEventIdempotencyKey` in `src/application/lifecycle-lane-event.ts`, the `handoff-${slug}` site in `src/application/handoff-command-use-case.ts`, `migrations/` and `docs/adr/` do not appear in `git show --stat 9ffbc2ad3` or `git show --stat f63cf8349` | PASS |
| Mission gate declared in `MISSION.md` ran on the committed tree | `./scripts/verify-local.sh all` (the mission's only Gates entry) | PASS |
| Handoff pre-push gate green on the rebased tree | `./scripts/verify-local.sh all` → `exit=0`, `ℹ tests 2380`, `ℹ pass 2380`, `ℹ fail 0` after the main-baseline repair in commit `597572e39` | PASS |

## Handoff bounce 1/2 — pre-push gate on a red baseline

The first handoff attempt failed with "Rebase failed before handoff." The rebase
itself is clean (`px rebase task-2456` → "Rebase completed cleanly"); the real
refusal came from the push-time verification gate inside
`rebaseBeforeReviewRound` (`src/adapters/review/rebase.ts`), which runs
`./scripts/verify-local.sh all` and reported `exit 1` with 3 failing tests.

None of the three touch task-2456. All three are red on `main` itself
(`41df66b0c`) — reproduced in a clean `git worktree` of `main`: 35 tests, 32
pass, 3 fail, the same three. The pre-review rebase onto current `main` pulled
them onto this branch. They assert behaviour that `mission/task-2437.01`
(`ce184c3d2`) intentionally replaced while `mission/task-2437` (`68112f10c`)
landed the older expectations.

Repaired test-only in commit `597572e39`; no production code changed.

| Baseline failure | Why it was red | Repair |
|---|---|---|
| `"BoardProjectionBuilder queues a gate-failed mission behind its runnable resume"` in `test/board-readers.test.ts` | task-2437.01 gave every action a `▸` face (`src/application/projections/mission-board.ts` `activeLabel`), so the label is `resume ▸` | expectation updated to `'resume ▸'` |
| `"board unavailable action ignores pointer and keyboard activation"` in `test/web-board-interaction.test.ts` | `primaryAction` in `web/src/flight-column.tsx` renders only actions the server marked runnable, so an ineligible action renders no control; the case still looked for `button[aria-disabled="true"]` | asserts neither an enabled nor a disabled control exists and that activation sends nothing |
| `"performStaticReview accepts a bare repo path whose file exists (may contain spaces)"` in `test/review-static-evidence.test.ts` | the spaced fixture is written under `tmpDir` but the bare path was resolved against the real checkout, so the case depended on a backlog file another mission owns | resolves against `tmpDir`; the case is now self-contained |

Post-repair gate on the rebased tree: `./scripts/verify-local.sh all` → `exit=0`,
`ℹ tests 2380`, `ℹ pass 2380`, `ℹ fail 0`, `ℹ skipped 0`, `ℹ todo 0`.
`./scripts/verify-local.sh static-analysis` → "ALL STAGES PASSED".
The task-2456 reproduction is unaffected:
`npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` stays green.

Next action: none for implementation — SC1–SC7 are satisfied and the mission's
stop rule ("stop implementing once SC1–SC7 are satisfied and the final
checkpoint Goal Check table is populated") applies. Commit `CP-3.md` and hand
`task-2456` to review with the reproduction
`test/task-2456-handoff-retry-duplicate-lane-event.test.ts` as the red-to-green
artefact.
