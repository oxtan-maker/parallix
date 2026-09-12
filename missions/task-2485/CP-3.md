# CP-3 — Document rehearsal evidence and limits

The operator guide now gives the two commands, assigns a cast and plain-text
transcript to each run, and states the evidence boundary. `DEMO_CAST` and
`DEMO_TRANSCRIPT` retain separately named artifacts rather than overwriting the
default recording. The live single-family run remains blocked by its attempted
write to operator Pi state; its captured transcript is retained without
claiming it reached review or integration.

Review repair: the disposable pre-integration gate now runs
`./scripts/verify-local.sh all`, and the transcript check uses the actual
`px integrate` pass line for that configured gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Eligibility input defaults to the existing three families | `scripts/record-first-value-demo.sh`; `docs/real-agent-smoke.md` | PASS |
| Global executable override needs no script edit | `PX_BIN="$(command -v px)" ./scripts/record-first-value-demo.sh`; `docs/real-agent-smoke.md` | PASS |
| Missing integration or verification evidence exits non-zero | `scripts/record-first-value-demo.sh`; `bash -n scripts/record-first-value-demo.sh`; `Repository gate (integration): verification passed.` | PASS |
| Rehearsal declares its operational limits | `scripts/record-first-value-demo.sh`; `docs/real-agent-smoke.md` | PASS |
| Single-family transcript reaches integrate and retains reviewer selection | `missions/task-2485/evidence/single-family-rehearsal-failed.transcript` | BLOCKED: Pi attempted operator `~/.pi` state before review/integration |
| Default three-family recording remains available | `docs/assets/first-value-demo.cast` | BLOCKED: the same stop rule prevents the subsequent live run |
| Existing deterministic lifecycle and real-agent smoke coverage is unchanged | `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Operator procedures, claim limits, and the mission verification gate are documented | `docs/real-agent-smoke.md`; `DEMO_CAST`; `DEMO_TRANSCRIPT`; `./scripts/verify-local.sh all` | PASS |

Next action: after configuring an explicitly isolated Pi session-state location, rerun the documented single-family and default commands and replace the blocked evidence with their completed recordings.
