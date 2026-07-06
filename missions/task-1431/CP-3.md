# CP 3: Null-slug regression coverage

## Summary
The transcript showed `Integration preflight for null` and
`expected mission/null` — an invalid operator-facing state. Tracing the call
graph: `buildIntegrationContext()` is only ever invoked in production from
`integrate()` (lib/commands/integrate.ts:563), which already guards against a
null/empty slug before that call (lib/commands/integrate.ts:552-555,
`if (!slug) { fmt.log.fail('Usage: px integrate ...'); process.exit(1); }`).
So a null slug can only reach `buildIntegrationContext` /
`printIntegrationPreflight` through a caller that bypasses that guard (e.g. a
future automation entry point, or a defect in slug inference feeding these
functions directly). Per the mission's Stop Rule, this is coverable
deterministically without external provider state, so rather than leaving it
unguarded, both entry points now fail fast instead of silently building a
"mission/null" context:

- `buildIntegrationContext(slug, ...)` (lib/commands/integrate.ts:871-875)
  throws `'buildIntegrationContext requires a non-null mission slug.'`
  immediately when `slug` is falsy, before any branch/worktree/task
  resolution runs.
- `printIntegrationPreflight(context, ...)` (lib/commands/integrate.ts:1060-1071)
  throws `'printIntegrationPreflight requires a context with a non-null
  mission slug.'` immediately when `context.slug` is falsy, before the
  `Integration preflight for ${context.slug}` log line is ever emitted.

This guarantees that for a real mission integration run, `null` can never
surface in the branch-expectation or preflight-header log lines — the call
aborts with a clear error before printing anything null-shaped.

## Goal Check

| Criterion | Evidence |
|---|---|
| Null-slug symptom reproduced deterministically from local test fixtures | `test/task-1431-integration-preflight-repro.test.js` — `buildIntegrationContext(null)` / `buildIntegrationContext(undefined)` previously threw an unrelated `TypeError: Cannot read properties of null (reading 'toLowerCase')` from deep inside `resolveTaskFile` → `findTaskFiles` → `scan` (lib/tools/backlog.js:102), and `printIntegrationPreflight` did not throw at all and instead would have gone on to print `Integration preflight for null` |
| Corrected preflight output no longer emits `Integration preflight for null` or `expected mission/null` for a real mission slug fixture | `test/task-1431-integration-preflight-repro.test.js` — `printIntegrationPreflight refuses to run with a null mission slug instead of printing "for null"` — PASS; asserts `assert.doesNotMatch(output, /Integration preflight for null/)` and `assert.doesNotMatch(output, /expected mission\/null/)` |
| `buildIntegrationContext` also guarded (the other real entry point that can produce a null-slug context) | `test/task-1431-integration-preflight-repro.test.js` — `buildIntegrationContext refuses to build a context for a null mission slug` — PASS |
| Fix location | lib/commands/integrate.ts:871-875 (buildIntegrationContext guard), lib/commands/integrate.ts:1066-1071 (printIntegrationPreflight guard) |

Next action: Run CP 4 — full verification (`./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis`) and confirm the backlog task classification labels are unchanged before handoff.
