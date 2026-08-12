# CP-4: Verification gate and final evidence

## Summary

Ran the focused reproduction test and the full local verification gate on the
committed tree, and closed two gate blockers found on the way:

1. **Stale consumer citation.** `src/application/consumer-domain-requirements.ts`
   pins the `ui-board-card` entry to a `file:line` in
   `src/application/projections/mission-board.ts`; the CP-3 edits moved
   `projectMissionCard` from line 198 to 212, so
   `test/domain-consumer-requirements.test.ts`
   (`"SC3: every consumer citation points at a line containing its anchor"`)
   reported drift. Updated the recorded line to match the anchor.
2. **Time-bomb fixture, pre-existing.** `test/qwen-limit-detection.test.ts`
   (`"qwen quota-exceeded: timed block with reason (parseResetTime tried first)"`)
   asserts a *parsed* reset time from the transcript
   `will reset at 2026-08-12T10:00:00+00:00` while using the real wall clock.
   Once the clock passed that instant the parsed reset fell into the past and
   the detector reported `fallback`. Confirmed pre-existing by running the file
   against the mission parent commit `a38003efc` (same 1 failure, without any
   of this mission's changes). Fixed in the fixture only, by pinning the
   existing `now` seam of `detectLimitHit` — the same seam the neighbouring
   test `"qwen quota-exceeded: recognizes the CLI insufficient_quota
   transcript"` already uses. No production code was changed for it.

Documentation: `docs/tui-board.md` gained a "What the attention rail lists"
section, because the board now has a user-facing contract it did not have
before — a mission with a live agent session is not listed in
`▲ NEEDS YOU NEXT`, while a blocking reason, a failed gate, and unobservable
liveness still are.

Gate result: `./scripts/verify-local.sh all` → exit 0, `tests 2186`,
`pass 2186`, `fail 0`, `skipped 0`, `todo 0`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red-before-fix reproduction | `test/task-2368-agent-running-review-detection.test.ts` committed in `7754ca7be` before the fix in `a35b0f15d`; at `a38003efc` the test `"a review-lane mission whose review is running does not ask for human attention"` failed with `the card records the live review session` (recorded in `missions/task-2368/CP-1.md`) | PASS |
| SC2 active review is detected, human attention is not requested | Test `"a review-lane mission whose review is running does not ask for human attention"` asserts `card.liveSession?.missionId === 'task-2274'` and `reason.kind === 'none'`; `src/interfaces/tui/shell.tsx` filters the rail and the `attention N` header count on `reason.kind !== 'none'` | PASS |
| SC3 no live session still yields pending review + attention | Tests `"a review-lane mission with no live session still awaits a human review decision"` and `"unknown liveness leaves the review-lane attention item unchanged"` | PASS |
| SC3 existing lane/rank behavior unchanged | `test/board-projections.test.ts`, `test/board-readers.test.ts`, `test/board-controller.test.ts`, and `"attention-items: rank order is correct (blocking=0 < gate-failed=1 < review=2 < integrate=3)"` all pass in `./scripts/verify-local.sh all` | PASS |
| SC4 no real Forgejo, agent launch, or heavy CLI | `test/task-2368-agent-running-review-detection.test.ts` uses in-file adapter stubs plus the `listProcesses` / `listWorktrees` / `resolveCwd` / `now` seams of `src/adapters/agents/running-sessions.ts` | PASS |
| SC5 focused test passes | `npx tsx --test test/task-2368-agent-running-review-detection.test.ts` → 4 pass, 0 fail (the repo runs TypeScript tests through `tsx`, as `test/run-default-tests.ts` does) | PASS |
| SC6 full verification gate | `./scripts/verify-local.sh all` → exit 0, tests 2186, pass 2186, fail 0 | PASS |
| DoD #2 lint / static analysis clean | `./scripts/verify-local.sh all` includes lint and typecheck; `npx tsc -p tsconfig.json --noEmit` produces no output | PASS |
| DoD #3 no focused or skipped tests introduced | `./scripts/verify-local.sh all` reports `skipped 0`, `todo 0`; `test/task-2368-agent-running-review-detection.test.ts` contains no `.only` or `.skip` | PASS |
| DoD #5 docs updated for the user-facing change | `./scripts/verify-local.sh all` ran on the tree containing the new `docs/tui-board.md` section "What the attention rail lists"; the behavior that section states is asserted by the test `"a review-lane mission whose review is running does not ask for human attention"` in `test/task-2368-agent-running-review-detection.test.ts`, with the outranking and unknown-liveness cases in `"unknown liveness leaves the review-lane attention item unchanged"` | PASS |
| DoD #6 red-to-green reproduction for a bug-labeled mission | Red at `a38003efc` (CP-1), green at `a35b0f15d` (CP-3), same file `test/task-2368-agent-running-review-detection.test.ts` | PASS |
| Fix stayed out of Restricted Areas | No changes to `src/adapters/forgejo/forgejo.ts`, `src/adapters/review/review-commands.ts`, `src/adapters/review/review-loop.ts`, or agent launchers; `git show --stat a35b0f15d` lists only the three projection files and `missions/task-2368/CP-3.md` | PASS |

Known limitation, deliberately not changed: the agent strip still counts a
`px review` session as unattributed (`● claude 0 running`), because that
command runs the reviewer and the act-on-review implementer in one process and
its session-marker role is `null`. It is reported honestly through
`unattributedRunningSessions` rather than as a family count, and correcting it
would require changing launcher/marker semantics, which this mission's
Restricted Areas exclude. See `missions/task-2368/CP-2.md`.

Next action: hand the branch off for review — `px review task-2368` — since all four checkpoints are committed and `./scripts/verify-local.sh all` passes on the final tree.
