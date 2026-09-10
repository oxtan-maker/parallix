# CP-5 — Real replay closure

## Summary

Closed the loop by re-recording the real first-value demo, inspecting the raw
`.cast` and the rendered GIF, fixing the one in-scope defect surfaced by replay,
running the focused integrate tests directly, and passing both repository
gates.

Re-record. The original `scripts/record-first-value-demo.sh` randomly selected
the slow `codex` agent and was flaky under machine load, so the recording was
forced through the `custom` agent via a variant invocation. The new cast shows
the committed happy-path shape end to end: the `READY TO INTEGRATE` evidence
view (CP-2/CP-3), the summary stats line, and the landing `main <before> →
<after>` SHA transition (CP-4), with no empty `[INFO]` line.

Inspect. Raw cast validated as asciinema v2 (`first line` is the v2 header
object; `READY TO INTEGRATE` present once). GIF rendered from the cast and
inspected.

Fix. Focused replay surfaced one in-scope defect: `test/task-1109.test.ts`
`withDebug()` used `return fn()` with a `try/finally` that restored
`process.env.DEBUG` **synchronously** the instant the async `fn()` returned its
pending promise — before `integrate`'s first `await` resolved. Every
`detail()` preflight line is guarded by `if (process.env.DEBUG)`, so the
`Forgejo PR: PR #41 open` / `Forgejo approval:` regression locks read DEBUG as
`undefined` and never emitted, failing the test. Production is unaffected: the
real `createMissionApplicationServices` never deletes DEBUG, and no source path
mutates it. Fix is test-only: make `withDebug` `async` and `return await fn()`
so DEBUG is restored only after the awaited call completes.

Run focused files. `npm test -- test/integrate.test.ts` and the full default
suite (`test/run-default-tests.ts`) both green.

Run gates. Both repository gates pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| First-value demo re-recorded and re-rendered | `scripts/record-first-value-demo.sh` → new `docs/assets/first-value-demo.cast` (asciinema v2 header, `READY TO INTEGRATE` present) and `docs/assets/first-value-demo.gif` | PASS |
| Raw cast inspected | `docs/assets/first-value-demo.cast`, v2 header object + `READY TO INTEGRATE` evidence view + landing `main <before> → <after>` SHA transition | PASS |
| GIF rendered and inspected | `docs/assets/first-value-demo.gif` rendered from the cast | PASS |
| In-scope defect fixed | `test/task-1109.test.ts`, `withDebug` changed to `async function` + `return await fn()` so DEBUG persists through the awaited `integrate` call | PASS |
| Focused integrate tests pass | `npm test -- test/integrate.test.ts` → green | PASS |
| Full default suite passes | `test/run-default-tests.ts` → 2455 passed, 0 failed | PASS |
| Repository gate `all` passes | `./scripts/verify-local.sh all` → EXIT 0, 2455 passed, 0 failed | PASS |
| Repository gate `static-analysis` passes | `./scripts/verify-local.sh static-analysis` → ESLint, tsc, test-hygiene, test typecheck all clean | PASS |
| No integration-gate logic weakened | Restricted areas untouched: `src/adapters/cli/commands/integrate-gates.ts`, `src/adapters/config/repository-gates.ts`, `decideIntegration`/`close` in `src/application/mission-integration-service.ts` | PASS |

Next action: all declared checkpoints (CP-1 → CP-5) committed and both mission
gates pass. Close out task-2479.
