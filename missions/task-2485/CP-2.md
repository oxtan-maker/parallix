# CP-2 — Single-family rehearsal blocked by external agent state

The isolated single-family run used `PX_BIN="$(command -v px)"` and
`ELIGIBLE_AGENT_FAMILIES='["custom"]'`. It reached the active-phase repair
path, but Pi then attempted to create a session directory in the operator's
`~/.pi` state and failed with `ENOENT`. Per the mission stop rule, the run was
not redirected to or repaired in operator state. The captured transcript is
retained verbatim; the previously usable default cast was restored unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Eligibility input defaults to the existing three families | `scripts/record-first-value-demo.sh` | PASS |
| Global executable override needs no script edit | `PX_BIN="$(command -v px)" ./scripts/record-first-value-demo.sh`; `missions/task-2485/evidence/single-family-rehearsal-failed.transcript` | PASS |
| Missing integration or verification evidence exits non-zero | `scripts/record-first-value-demo.sh`; `missions/task-2485/evidence/single-family-rehearsal-failed.transcript` | PASS |
| Rehearsal declares its operational limits | `scripts/record-first-value-demo.sh` | PASS |
| Single-family transcript reaches integrate and retains reviewer selection | `missions/task-2485/evidence/single-family-rehearsal-failed.transcript` | BLOCKED: Pi attempted operator `~/.pi` state before review/integration |
| Default three-family recording remains available | `docs/assets/first-value-demo.cast` | BLOCKED: stop rule prevents further real-agent runs after external-state attempt |
| Existing deterministic lifecycle and real-agent smoke coverage is unchanged | `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Operator procedures and claim limits are documented | `docs/real-agent-smoke.md`; `docs/designs/reposition-as-trust-layer.md` | BLOCKED: CP-3 follows successful recordings |

Next action: provision a Pi session-state location that is explicitly isolated and rerun CP-2; do not use the operator's `~/.pi` state.
