# CP-3 — Reusable real-PTY smoke harness

Added a reusable local PTY helper backed by util-linux `script`. The helper starts only the caller-provided executable inside a deterministic 120×30 pseudo-terminal, exposes keyboard input and a `SIGWINCH` resize path, enforces a caller-provided timeout on startup/resize/exit, and compares `stty -g` state before and after Ink exits. The smoke test uses a disposable OS-temp repository fixture and the built CLI, so it never mutates this checkout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Harness launches a real PTY with explicit timeout bounds | `test/helpers/pty-smoke-harness.ts:58`, `test/helpers/pty-smoke-harness.ts:90`, "real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration" | PASS |
| Smoke test drives launch, keyboard navigation, resize, and clean exit | `test/tui-pty-smoke.test.ts:21`, `test/tui-pty-smoke.test.ts:28`, `test/tui-pty-smoke.test.ts:30` | PASS |
| Terminal state restoration is verified | `test/helpers/pty-smoke-harness.ts:107`, `test/tui-pty-smoke.test.ts:33` | PASS |
| Harness is reusable and isolated from agents, Forgejo, network, and repository writes | `test/helpers/pty-smoke-harness.ts:52`, "PTY smoke harness: has no agent, Forgejo, repository-write, or network capability" | PASS |
| PTY smoke suite and typecheck pass | `npm test -- --test-name-pattern='PTY smoke' test/tui-pty-smoke.test.ts`, `npm run typecheck` | PASS |

Next action: run both mission-declared verification gates, check test hygiene for focused or bare skips, update Graphify metadata, and record final criterion-by-criterion evidence.
