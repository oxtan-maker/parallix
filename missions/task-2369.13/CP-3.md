# CP-3: Bound gate/hook output in auto-bounce prompts (SC6)

## Summary of work done

A pre-review gate failure on this branch (git-hook area, during rebase onto
main after the Backlog state update) produced ~545 KB of diagnostic output
(rebase log + docs check + full `npm test` + full `npm run bundle`). The
auto-bounce prompt embedded that output verbatim into the resumed pi
implementer session, pushing its context from ~28k to ~191k tokens. The
model entry had no explicit context window, so pi assumed 128k; for every
subsequent turn pi computed `max_tokens = contextWindow - prompt - safety < 0`
and clamped it to 1. Each launch then emitted exactly one thinking token
(`stopReason=length, output=1`), produced no text or tool call, and exited
silently; the review loop timed out (600 s) and retried into the same wall.

Fix: bounce prompts now embed elided output (head 4 KB + tail 28 KB, with an
elision marker, 32 KB cap total). The head keeps command context; the tail
keeps the failure, where errors land. Classification still runs on the
untruncated output — only the prompt embedding is elided.

## Changes

- `src/application/output-elision.ts` — new: `elideBounceOutput()` with `BOUNCE_OUTPUT_MAX_CHARS` (32,768) and `BOUNCE_OUTPUT_HEAD_CHARS` (4,096)
- `src/application/hook-failure-workflow.ts` — hook-failure bounce prompt embeds `elideBounceOutput(hookOutput)`
- `src/adapters/review/review-gate-handling.ts` — pre-review gate bounce prompt embeds `elideBounceOutput()` of stdout and stderr; `diagnosticOutput` used for classification stays untruncated
- `test/task-2369.13-bounce-output-elision.test.ts` — new: elision unit tests + 500 KB prompt-boundedness regression tests for both injectors

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bounce prompts embed at most 32,768 chars of gate/hook output as head+tail with marker | `test/task-2369.13-bounce-output-elision.test.ts` — "elides oversized output to bounded head+tail with a marker" | PASS |
| Hook-failure bounce prompt stays bounded with 500 KB of hook output, keeps head and tail | `test/task-2369.13-bounce-output-elision.test.ts` — "stays bounded with 500 KB of hook output and keeps head+tail" | PASS |
| Pre-review gate bounce prompt stays bounded with 500 KB of gate stdout, keeps head and tail | `test/task-2369.13-bounce-output-elision.test.ts` — "stays bounded with 500 KB of gate stdout and keeps head+tail" | PASS |
| Failure classification still runs on untruncated output | `src/adapters/review/review-gate-handling.ts` — `classifyGateFailure(diagnosticOutput)` called before prompt construction; `test/task-1385-pre-review-gate.test.ts` and `test/task-2340-hook-rebounce.test.ts` unchanged and passing | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Round 1 resolution (2026-08-15)

Review round 1 verdict: request-changes. Implementer disposition: CHANGES_MADE.

- F1 (blocking) — fixed: dropped the out-of-scope TUI raw-mode commits from the branch with `git rebase --onto 2b4635362 616cfcde2` (TUI fix and its checkpoint, pre-rebase hashes `533ad0399` and `077f0a2b2`). The diff vs main now carries only the dedup work (CP-1) and bounce-output elision (CP-3); `src/interfaces/tui/ui-command.ts`, `test/helpers/pty-smoke-harness.ts`, and `CP-2.md` are no longer part of the branch.
- F2 (conditional on keeping the TUI fix) — moot: the fix was dropped per F1, so `ui-command.ts` is no longer modified by this branch.
- F3 (informational) — resolved: CP-3 is the final checkpoint on the branch and is recorded in the operator database by this checkpoint commit.
- Gate note: the SC20 PTY shutdown flake (TASK-2373 scope) failed one pre-push full-suite gate run while the TUI fix was still on the branch; `test/task-2373-shutdown.test.ts` passes standalone after the drop. Per review, if it blocks the integration gate it is an environment/gate issue to escalate, not a change to land on this branch.

Next action: hand off; the review loop re-runs the rebase and gate, then round 2 review.
