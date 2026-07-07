# CP-5: Implement C7 Evidence-Reference Validation

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `handoff.ts` validates evidence cell format | `lib/commands/handoff.ts:201-230` — regex checks for file:line, test commands, test paths | PASS |
| `review-commands.ts` mirrors C7 validation | `lib/review/review-commands.ts:295-324` — same pattern in static review findings | PASS |
| Invalid evidence cells produce actionable errors | Error message cites the bad reference and explains required format | PASS |
| All 231 related tests pass | Includes handoff, review-commands, active, repair-handoff, pre-review-gate | PASS |

## Changes

- **`lib/commands/handoff.ts`**: Added C7 evidence-reference format validation after evidence row detection. Each evidence cell (second column) must match pattern for file:line paths, test commands (`npm test`, `npx`), or test file paths (`test/`, `spec/`, `.test.`, `.spec.`). Invalid references produce a clear error with the offending value.
- **`lib/review/review-commands.ts`**: Same C7 validation added to static review findings. Invalid evidence references are reported as findings rather than hard failures (consistent with review-commands' advisory nature).

## Next Action

CP-6: Final verification — run full test suite, update ADR 0048 documentation, write final checkpoint with complete Goal Check table.
