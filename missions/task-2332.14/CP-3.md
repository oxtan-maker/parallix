# CP-3 — Review adapter port implementation

Refactored the review command module into `ReviewWorkflowAdapter`, which implements the application port and retains the existing review helpers. Legacy tests now compose the interface handler and use case directly, so the adapter no longer exports a top-level review dispatcher.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter implements the complete review port | `src/adapters/review/review-commands.ts:1803` | PASS |
| Start/continue policy routes through separate port operations | `src/application/review-command-use-case.ts:25` | PASS |
| Existing review command helper suite passes | `test/review-commands.test.ts`, `npm test -- test/review-commands.test.ts` | PASS |
| Adapter does not export a top-level review dispatcher | `src/adapters/review/review-commands.ts:1940` | PASS |

Next action: Add mocked-port unit coverage for each required review outcome, then run the full mission verification gate.
