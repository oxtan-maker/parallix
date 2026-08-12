# CP 1 — Codex HOME override reproduction

Added a focused reproduction that supplies a worktree-local `HOME` through
the Codex launch `env` parameter. It exercises both invocation modes and
asserts that an operator-installed nested OpenCode path remains resolvable.
It also records the existing bootstrap contract: operator Codex state is read
from the real process HOME when no `CODEX_HOME` is supplied.

The reproduction was run before the fix and failed because the launch
environment selected the caller-supplied worktree HOME.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction models caller-supplied HOME overriding operator HOME | `test/task-2266-codex-isolation-repro.test.ts`; `npx tsx test/run-default-tests.ts test/task-2266-codex-isolation-repro.test.ts` | PASS (red on mission parent) |
| Nested operator tool resolution is asserted | `"codex launch keeps the operator HOME when caller env supplies a worktree HOME"` in `test/task-2266-codex-isolation-repro.test.ts` | PASS (red on mission parent) |
| Bootstrap retains process-HOME operator state source | `"Codex bootstrap reads operator state from process HOME when caller env supplies HOME"` in `test/task-2266-codex-isolation-repro.test.ts` | PASS |

Next action: preserve `process.env.HOME` after the caller environment spread in both Codex invocation paths, then run the reproduction green with existing isolation coverage.
