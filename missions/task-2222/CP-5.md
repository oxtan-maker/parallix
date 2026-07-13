# CP-5 — Review correction: repository-wide durable-write guard

## Summary

Reviewer finding 1 was fixed. The SC7 guard now recursively traverses every TypeScript source
file under `lib/`, rather than only four hand-selected files. The exception map remains the same
three inventory-documented generated/configuration writers. The negative regression builds a
temporary `lib/tools/new-state.ts` fixture and proves the real tree walk rejects its direct JSON
write. A comment records the detector's intentionally bounded inline-serialization scope.

`node --test test/durable-state-policy.test.js` passed (3/0) and
`./scripts/verify-local.sh static-analysis` passed. The required full verifier was retried but
is currently blocked by unrelated checkpoint-suite failures: an Infinity-vs-1 assertion and
`checkpoint is not a function` in `test/task-1268-checkpoint-no-gate.test.js`. Neither
`lib/commands/checkpoint.ts` nor that test is in TASK-2222's mission diff.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC7 scans the complete TypeScript implementation tree | `test/durable-state-policy.test.js:31`; `test/durable-state-policy.test.js:42` | PASS |
| SC7 permits only the three documented exceptions | `test/durable-state-policy.test.js:9`; `lib/core/durable-state-inventory.ts:54`; `lib/core/durable-state-inventory.ts:61` | PASS |
| SC7 rejects a newly introduced non-inventoried lib writer through the tree walk | `test/durable-state-policy.test.js`, "direct durable JSON write guard rejects a new non-inventoried lib writer" | PASS |
| Focused reviewer-fix test passes | `node --test test/durable-state-policy.test.js` (3 passed) | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Required full verifier is currently blocked outside the mission diff | `./scripts/verify-local.sh all`; `test/task-1268-checkpoint-no-gate.test.js` | BLOCKED — external baseline failure |

Next action: Parallix should repair or rebase the checkpoint-suite baseline, then rerun `./scripts/verify-local.sh all` before TASK-2222 handoff.
