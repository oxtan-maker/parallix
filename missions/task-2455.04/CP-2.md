# CP-2: Retain CLI validation failures

Traced both `run()` startup assignments in `src/entry/px.ts` and the legacy executable path in `src/composition/create-cli.ts`. Each now preserves an existing non-zero `process.exitCode`; `run()` still supplies the status when no failure was set.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Malformed configuration exits non-zero and retains diagnostic and fallback output | `test/task-2455-config-exit-status-repro.test.ts`; `px config keeps a non-zero exit status for malformed JSON while printing fallback output` | Green |
| Structurally invalid configuration exits non-zero and retains diagnostic and fallback output | `test/task-2455-config-exit-status-repro.test.ts`; `px config keeps a non-zero exit status for structurally invalid JSON while printing fallback output` | Green |
| CLI startup does not overwrite config validation failure status | `src/entry/px.ts`; `src/composition/create-cli.ts` | Green |

Next action: run `./scripts/verify-local.sh all` and capture its completed-mission evidence in CP-3.
