# CP-7 — Review round 1 PTY correction

Addressed the blocking PTY review findings. The target now runs in the foreground of the local PTY, receives its terminal input, and the smoke assertion proves a down-arrow moves focus to a second mission before resize and `q` exit. The terminal-state comparison now snapshots immediately after the child exits and before harness cleanup. The lane overflow indicator now counts only cards below a scrolled window. The full verification and static-analysis gates pass after these changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Real PTY input drives a visible selection change before clean exit | `test/helpers/pty-smoke-harness.ts:68`, `test/tui-pty-smoke.test.ts:31`, "real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration" | PASS |
| Terminal restoration is measured before harness restoration | `test/helpers/pty-smoke-harness.ts:73`, `test/helpers/pty-smoke-harness.ts:105` | PASS |
| Scrolled overflow counts only cards below the visible window | `src/interfaces/tui/lane-column.tsx:66`, `test/tui-lane-columns.test.ts` | PASS |
| Required final gates pass after review changes | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PASS |

Next action: provide the round-resolution artifacts to the review loop for a new formal decision.
