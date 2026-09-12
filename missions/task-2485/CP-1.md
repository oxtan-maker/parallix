# CP-1 — Parameterize the isolated rehearsal

The rehearsal now accepts `ELIGIBLE_AGENT_FAMILIES` as a non-empty JSON array,
defaulting to `codex`, `claude`, and `custom`. A supplied `PX_BIN` is executed
directly, while the bundled default remains Node-driven. The disposable demo
also configures an integration verification gate and fails unless the captured
PTY transcript shows both that gate and a completed integration.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Eligibility input defaults to the existing three families | `scripts/record-first-value-demo.sh`; `ELIGIBLE_AGENT_FAMILIES='["custom"]'` | PASS |
| Global executable override needs no script edit | `scripts/record-first-value-demo.sh`; `PX_BIN="$(command -v px)" ./scripts/record-first-value-demo.sh` | PASS |
| Missing integration or verification evidence exits non-zero | `scripts/record-first-value-demo.sh`; `bash -n scripts/record-first-value-demo.sh` | PASS |
| Rehearsal declares its operational limits | `scripts/record-first-value-demo.sh` | PASS |
| Single-family transcript includes verbatim reviewer selection | `scripts/record-first-value-demo.sh` | PENDING CP-2 rehearsal |
| Default three-family recording remains available | `scripts/record-first-value-demo.sh` | PENDING CP-2 rehearsal |
| Existing deterministic lifecycle and real-agent smoke coverage is unchanged | `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Operator procedures and claim limits are documented | `docs/real-agent-smoke.md`; `docs/designs/reposition-as-trust-layer.md` | PENDING CP-3 documentation |

Next action: run the isolated single-family rehearsal with the global `px`, retain its text transcript and reviewer-selection excerpt, then record the default configuration.
