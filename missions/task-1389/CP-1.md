# CP-1: FailureClass/DispatchAction enums and getDispatchAction()

## Goal

Define `FailureClass` enum with 8 values and `DispatchAction` enum with 3 values; implement `getDispatchAction()` dispatch table mapping each failure class to its prescribed action per ADR 0048. Add unit tests verifying SC2 (dispatch table correctness).

## Work Done

1. Added `FailureClass` constant object with 8 values in `lib/commands/repair-handoff.js:49-57`
2. Added `DispatchAction` constant object with 3 values in `lib/commands/repair-handoff.js:60-65`
3. Implemented `DISPATCH_TABLE` mapping all 8 failure classes to prescribed actions in `lib/commands/repair-handoff.js:68-77`
4. Implemented `getDispatchAction(failureClass)` function in `lib/commands/repair-handoff.js:81-85`
5. Implemented `classifyError(errorMsg)` stub in `lib/commands/repair-handoff.js:89-97` (full pattern matching deferred to CP-2)
6. Exported `FailureClass`, `DispatchAction`, `classifyError`, `getDispatchAction` as named exports in `lib/commands/repair-handoff.js:42-45`
7. Attached all new members to `repairHandoff` object for backward-compatible `require()` access in `lib/commands/repair-handoff.js:314-317`
8. Added 11 unit tests in `test/repair-handoff.test.js:348-398`

Also updated `lib/commands/repair-handoff.ts` (TypeScript source) with equivalent definitions and exports.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| FailureClass has 8 values | `lib/commands/repair-handoff.js:49-57` — UnverifiableClaims, MalformedGates, MissingArtifacts, IncompleteEvidence, GitBlockers, GateFailure, InfraBlocker, StateMachineViolation | PASS |
| DispatchAction has 3 values | `lib/commands/repair-handoff.js:60-65` — AutoRepair, AutoSendBack, HumanOnly | PASS |
| SC2: GitBlockers → AutoRepair | `test/repair-handoff.test.js:348` test `getDispatchAction returns AutoRepair for GitBlockers` — PASS | PASS |
| SC2: MalformedGates → AutoRepair | `test/repair-handoff.test.js:352` test `getDispatchAction returns AutoRepair for MalformedGates` — PASS | PASS |
| SC2: UnverifiableClaims → AutoSendBack | `test/repair-handoff.test.js:356` test — PASS | PASS |
| SC2: MissingArtifacts → AutoSendBack | `test/repair-handoff.test.js:360` test — PASS | PASS |
| SC2: IncompleteEvidence → AutoSendBack | `test/repair-handoff.test.js:364` test — PASS | PASS |
| SC2: GateFailure → AutoSendBack | `test/repair-handoff.test.js:368` test — PASS | PASS |
| SC2: InfraBlocker → HumanOnly | `test/repair-handoff.test.js:372` test — PASS | PASS |
| SC2: StateMachineViolation → HumanOnly | `test/repair-handoff.test.js:376` test — PASS | PASS |
| SC5: Named exports importable | `test/repair-handoff.test.js:380` test `classifyError and getDispatchAction are importable named exports` — PASS | PASS |

## Next action

Implement `classifyError()` with regex-based pattern matching for all 8 failure classes (CP-2).
