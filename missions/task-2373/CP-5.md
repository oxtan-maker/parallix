# CP-5 — Process liveness beyond a bare PID (SC13–SC14)

## Summary of work done

A published `running` fact can no longer be kept alive by pid reuse.

- `CurrentWorkEvent` carries an optional `processIdentity` beside `processId`, written by
  `CurrentWorkRecorder` from the value composition supplies. Legacy rows have none and keep
  the previous bare-pid behaviour.
- `ProcessLivenessProbe` takes `(processId, identity)`. `probeProcessLiveness` still starts
  with `process.kill(pid, 0)` — the guard was edited in place, not duplicated — and, when the
  publisher recorded an identity, compares it against `processStartIdentity(pid)`. A
  mismatch is reported dead; an unreadable identity stays "alive" rather than fabricating a
  conclusion.
- `processStartIdentity` reads field 22 of `/proc/<pid>/stat` for **one named pid**. That is
  a targeted read, not the broad `ps`/`/proc` scan the mission's restricted areas forbid, and
  it returns `null` where `/proc` does not exist.
- The composition root passes `processIdentity: processStartIdentity(process.pid)` alongside
  the pid in `src/composition/application-services.ts`.

Abnormal termination is unchanged in shape and now covered explicitly: an unobservable
publisher ages `unverified -> stale`, and an observed-dead publisher clears the fact.

`src/adapters/process/process-liveness.ts` was added to the infrastructure exclusions in
`test/persistence-inventory-guardrail.test.ts` — it reads one `/proc` entry as bounded
recovery evidence and owns no ADR 0053 durable-state concept.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC13 — a reused pid with a different start identity is treated as dead | `test/task-2373-liveness.test.ts`, `"SC13: a reused pid whose process-start identity differs is treated as dead"` | PASS |
| SC13 — a matching identity keeps the work live | `test/task-2373-liveness.test.ts`, `"SC13: the matching process-start identity keeps the work live"` | PASS |
| SC13 — the probe works against a real local process | `test/task-2373-liveness.test.ts`, `"SC13: the probe distinguishes this real process from a reused pid and from a missing one"` | PASS |
| SC13 — an unreadable identity degrades safely | `test/task-2373-liveness.test.ts`, `"SC13: an unreadable identity falls back to the bare pid check rather than guessing"` | PASS |
| SC14 — abnormal termination ages stale work out | `test/task-2373-liveness.test.ts`, `"SC14: an abnormally terminated publisher ages its work out instead of staying WORKING"` | PASS |
| SC14 — an observed-dead publisher clears the fact | `test/task-2373-liveness.test.ts`, `"SC14: an abnormally terminated publisher observed dead clears the work immediately"` | PASS |
| No `Lease` or process aggregate introduced | `test/domain-attempt-guard.test.ts`; identity is a string field on the existing event, written by `src/adapters/process/process-liveness.ts` | PASS |
| No broad process-table scan | `src/adapters/process/process-liveness.ts` — `processStartIdentity` reads `/proc/<pid>/stat` for a single supplied pid | PASS |
| Persistence inventory guardrail satisfied | `test/persistence-inventory-guardrail.test.ts`, `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| Typecheck clean | `npm run typecheck`, `npx tsc --noEmit --project tsconfig.test.json` — no output | PASS |

Next action: CP-6 — make the operator rail honest in
`src/application/projections/board.ts` and the TUI rail: WORKING overflow indicator,
legacy/recovery-evidence visibility, and affordance/command parity against
`BoardCommandController` (SC15–SC18).
