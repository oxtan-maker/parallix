# CP-2: classifyError() with regex-based pattern matching for all 8 failure classes

## Goal

Implement `classifyError()` with regex-based pattern matching for all 8 failure classes. Map existing patterns: dirty-artifact → `GitBlockers`, behind-branch → `GitBlockers`, goal-check missing evidence → `IncompleteEvidence`, verification-gate-failed → `GateFailure`, declared-gate-failed → `GateFailure`. Add unit tests verifying SC1 (classification correctness for all 8 classes).

## Work Done

1. Implemented `classifyError(errorMsg)` in `lib/commands/repair-handoff.js:90-168` with 10 specificity-ordered pattern checks:
   - IncompleteEvidence (goal-check missing evidence rows) — `lib/commands/repair-handoff.js:97-100`
   - GitBlockers (dirty artifacts) — `lib/commands/repair-handoff.js:103-107`
   - GitBlockers (behind branch/push rejected) — `lib/commands/repair-handoff.js:110-120`
   - GateFailure (verification gate failed) — `lib/commands/repair-handoff.js:123-126`
   - GateFailure (declared gate failed) — `lib/commands/repair-handoff.js:129-132`
   - UnverifiableClaims (test claims unverifiable) — `lib/commands/repair-handoff.js:135-138`
   - MalformedGates (malformed/non-runnable gates) — `lib/commands/repair-handoff.js:141-144`
   - MissingArtifacts (mandatory artifacts missing) — `lib/commands/repair-handoff.js:147-150`
   - StateMachineViolation (state machine violations) — `lib/commands/repair-handoff.js:153-156`
   - InfraBlocker (forgejo/infra blockers) — `lib/commands/repair-handoff.js:159-162`
   - Default: InfraBlocker/HumanOnly — `lib/commands/repair-handoff.js:165-166`
2. Updated `lib/commands/repair-handoff.ts` with identical implementation
3. Added 14 unit tests in `test/repair-handoff.test.js:401-488`

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC1: GitBlockers classified from dirty error | `test/repair-handoff.test.js:405` `classifyError classifies dirty-artifact error as GitBlockers` — PASS | PASS |
| SC1: GitBlockers classified from behind error | `test/repair-handoff.test.js:417` `classifyError classifies behind-branch error as GitBlockers` — PASS | PASS |
| SC1: IncompleteEvidence classified from goal-check error | `test/repair-handoff.test.js:425` `classifyError classifies goal-check missing-evidence as IncompleteEvidence` — PASS | PASS |
| SC1: GateFailure classified from verification-gate error | `test/repair-handoff.test.js:431` `classifyError classifies verification-gate-failed as GateFailure` — PASS | PASS |
| SC1: GateFailure classified from declared-gate error | `test/repair-handoff.test.js:437` `classifyError classifies declared-gate-failed as GateFailure` — PASS | PASS |
| SC1: UnverifiableClaims classified | `test/repair-handoff.test.js:443` `classifyError classifies unverifiable-claims error as UnverifiableClaims` — PASS | PASS |
| SC1: MalformedGates classified | `test/repair-handoff.test.js:449` `classifyError classifies malformed-gate error as MalformedGates` — PASS | PASS |
| SC1: MissingArtifacts classified | `test/repair-handoff.test.js:455` `classifyError classifies missing-artifacts error as MissingArtifacts` — PASS | PASS |
| SC1: InfraBlocker classified | `test/repair-handoff.test.js:461` `classifyError classifies infra-blocker error as InfraBlocker` — PASS | PASS |
| SC1: StateMachineViolation classified | `test/repair-handoff.test.js:467` `classifyError classifies state-machine-violation error as StateMachineViolation` — PASS | PASS |
| SC1: Unknown error defaults to InfraBlocker | `test/repair-handoff.test.js:473` `classifyError returns InfraBlocker(HumanOnly) for unknown error` — PASS | PASS |
| SC1: No false positives on partial matches | `test/repair-handoff.test.js:479` `classifyError does not false-positive on partial matches` — PASS | PASS |

## Next action

Refactor `repairHandoff()` to use `classifyError()` internally, update `isRelaunchableError` to delegate to `classifyError`, add backward-compatibility tests (SC4), and run `./scripts/verify-local.sh all` (CP-3).
