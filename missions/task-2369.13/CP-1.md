# CP-1: Dedup goal-check evidence helpers — remove duplicates, wire import, pass gates

Removed 5 duplicate goal-check evidence functions from `handoff-command-use-case.ts` (~166 lines). Canonical versions in `review-static-evidence.ts` now accept optional `fileSystem` port parameter (falls back to `node:fs` when omitted). Handoff use case imports from canonical module; CLI adapter switched import source. Added production dependency exception for the application→adapter edge.

## Changes

- `src/adapters/review/review-static-evidence.ts` — added `FileSystemPort` interface, 4 helper functions (`_fsExistsSync`, `_fsReadText`, `_fsListEntries`, `_fsListNames`), optional `fileSystem` param on 5 functions, exported all 5
- `src/application/handoff-command-use-case.ts` — removed 5 duplicate functions (166 lines: 1379→1213), added import from `review-static-evidence.ts`
- `src/adapters/cli/commands/handoff.ts` — switched import source for `collectGoalCheckEvidenceRows`, `evidenceCellHasVerifiableReference`, `findUnverifiableGoalCheckRow` to `review-static-evidence.ts`
- `src/application/consumer-domain-requirements.ts` — updated line citation (275→302) for shifted line numbers
- `src/adapters/architecture/boundary-guards.ts` — added production exception for handoff→review-static-evidence edge (owned by TASK-2369.13)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 5 functions defined exactly once in review-static-evidence.ts | `test/review-static-evidence.test.ts` — 9 tests cover all exported functions | PASS |
| handoff-command-use-case.ts reduced by 150+ lines, imports from canonical module | `test/handoff-use-case.test.ts` — "handoff use case completes the full workflow over mocked ports" exercises deduped import path | PASS |
| Canonical functions accept optional fileSystem param; fallback to node:fs | `test/handoff-use-case.test.ts` (lines 67, 434) — fileSystem port passed to use case; `test/review-static-evidence.test.ts` — canonical functions tested | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint + tsc + test-hygiene + test typecheck all PASS | PASS |
| Handoff evidence-checking behavior unchanged | `npm test` — 2320 tests pass, including `test/handoff.test.ts` and `test/task-2215-missing-error-bounce.test.ts` | PASS |

Next action: Run `./scripts/verify-local.sh static-analysis` as mission gate, then hand off for review.
