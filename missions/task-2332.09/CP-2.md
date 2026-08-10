# CP-2: CLI interface, composition wiring, mocked-port tests, gates

## Summary

Created `src/interfaces/cli/handoff.ts` with argument parsing (`parseHandoffCliRequest`)
and command factory (`createHandoffCommand`). Updated `src/composition/create-cli.ts`
to wire `HandoffCommandUseCase` with concrete port implementation via constructor
injection, matching integrate pattern. Added 16 mocked-port unit tests covering
CLI parsing, use case delegation, and all SC5 scenarios (success, gate failure,
gatekeeper pushback, NEL persistence failure, checkpoint recording failure,
exit-code mapping). Both gates pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI interface parses args + rendering | `src/interfaces/cli/handoff.ts:4` — `HandoffCliRequest`, `src/interfaces/cli/handoff.ts:11` — `parseHandoffCliRequest` | PASS |
| CLI interface imports no adapters | `src/interfaces/cli/handoff.ts:1-2` — imports `cli-format.js` and `handoff-command-use-case.js` only | PASS |
| Composition wires use case via injection | `src/composition/create-cli.ts:116` — `createHandoffCommand(new HandoffCommandUseCase({...}))` | PASS |
| SC5a: successful handoff test | `test/handoff-use-case.test.ts:96` — `"handoff use case returns success from port on successful handoff"` | PASS |
| SC5b: gate failure test | `test/handoff-use-case.test.ts:103` — `"handoff use case returns failure on gate failure"` | PASS |
| SC5c: gatekeeper pushback test | `test/handoff-use-case.test.ts:111` — `"handoff use case returns gatekeeper pushback result from port"` | PASS |
| SC5d: NEL persistence failure test | `test/handoff-use-case.test.ts:119` — `"handoff use case returns failure on NEL persistence error"` | PASS |
| SC5e: checkpoint recording failure test | `test/handoff-use-case.test.ts:127` — `"handoff use case returns failure on checkpoint recording error"` | PASS |
| SC6: existing handoff tests compatible | `test/handoff.test.ts` — 78 tests pass | PASS |
| SC6: exit code 1 on failure | `test/handoff-use-case.test.ts:143` — `"handoff CLI interface exits with code 1 when slug is missing"` | PASS |
| Static analysis gate | `` `./scripts/verify-local.sh static-analysis` `` — all 4 stages PASS | PASS |
| Full verifier gate | `` `./scripts/verify-local.sh all` `` — 1937 tests PASS | PASS |
| Mandatory integration gate ran | `` `./scripts/verify-local.sh integrate` `` | PASS |

Next action: All checkpoints complete and gates pass. Mission ready for Parallix lifecycle transition.
