# CP-6 — Handoff-gate remediation: PTY and artifact-test determinism

The second handoff gate exposed two test-environment races. Headless mode now requires both stdin and stdout to be non-TTY, preserving interactive lifecycle behavior inside the real PTY. The CJS/ESM artifact tests now launch their artifacts against a small disposable OS-temp backlog fixture instead of concurrently scanning this full checkout, eliminating the 30-second timeout race while retaining real artifact coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Real PTY retains its interactive path through resize and clean exit | `src/interfaces/tui/ui-command.ts:138`, "real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration" | PASS |
| CJS rollback artifact exits under piped stdio without a repository-scale timeout | `test/tui-spawn.test.ts:32`, "dist/px.js ui exits 0 (CJS rollback artifact)" | PASS |
| ESM bundled artifact exits under piped stdio using the same isolated fixture | `test/tui-spawn.test.ts:54`, "build/px.mjs ui exits 0 (ESM single-file bundle)" | PASS |
| Full final verification and static analysis pass after the fixes | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PASS |

Next action: submit the committed deterministic test repair through `px review task-2305 --submit` as requested by the lifecycle controller.
