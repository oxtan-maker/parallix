# CP-5 — Handoff-gate remediation: non-TTY artifact exit

The handoff gate exposed a real lifecycle defect: the shipped CJS and ESM `px ui` artifacts rendered under piped stdio but then waited indefinitely for an interactive `q`. `runUiCommand()` now uses Ink `renderToString()` and returns `0` when stdin is not a TTY; interactive TTY/PTY sessions retain the existing `render()` and `waitUntilExit()` path. This fixes the artifact-spawn timeout without weakening the real-PTY smoke coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Piped/headless UI renders a static frame and exits instead of waiting for keyboard input | `src/interfaces/tui/ui-command.ts:136`, `src/interfaces/tui/ui-command.ts:143` | PASS |
| CJS and ESM shipped UI artifacts both exit successfully under piped stdio | "dist/px.js ui exits 0 (CJS rollback artifact)", "build/px.mjs ui exits 0 (ESM single-file bundle)", `test/tui-spawn.test.ts` | PASS |
| Headless compatibility and the full final verification suite pass | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `test/tui-headless-isolation.test.ts` | PASS |

Next action: submit the committed repair through `px review task-2305 --submit` as requested by the lifecycle controller.
