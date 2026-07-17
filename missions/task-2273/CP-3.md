# CP-3: Reuse matching proof at the declared-gate boundary

Wired handoff so a successful configured verification gate records a reusable proof.
The declared-gate runner independently validates a matching proof before it reuses;
otherwise it runs the declared command and records a new proof only after success.
It reports both execution and reuse together with the identity. Failed or interrupted
commands cannot write a proof. Direct `npm test`, direct `verify-local.sh`, and direct
Git pushes are unchanged: no standalone command reads this orchestrator proof.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff stores proof only after a successful real configured gate | `lib/commands/handoff.ts:354`, `lib/commands/handoff.ts:368`, "task-2273 handoff records execution and declared gates validate matching proof reuse" | PASS |
| Declared gate reuses only an independently validated matching proof | `lib/commands/handoff.ts:896`, `lib/commands/handoff.ts:898`, "task-2273 handoff records execution and declared gates validate matching proof reuse" | PASS |
| Absent or mismatched proof retains real declared-gate execution | `lib/commands/handoff.ts:901`, `lib/core/verification.ts:220` | PASS |
| Operator output distinguishes execution from reuse and includes identity | `lib/commands/handoff.ts:369`, `lib/commands/handoff.ts:898`, "task-2273 handoff records execution and declared gates validate matching proof reuse" | PASS |
| Standalone verification commands retain their implementation | `scripts/verify-local.sh:24`, `test/verification.test.js` | PASS |

Next action: Run the complete mission gate and document retained lifecycle, static-analysis, and integration-only ownership.
