# CP-2: Enforce exact command-only gates

Tightened the declared-gate validation boundary to reject Markdown command spans with trailing text, prose introduced by description separators, and common unquoted outcome-language suffixes. Validation preserves the original offending declaration in an actionable `validation-failed` result and runs before the shell loop. Quoted human-readable arguments remain outside prose detection. Updated the canonical draft prompt to require exact repository commands and relocate outcomes to Success Criteria or checkpoint documentation. The CP-1 reproduction is now green; three legacy handoff tests that expected descriptions to be silently stripped are intentionally queued for contract-aligned replacement in CP-3.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Prose-appended gate is rejected before execution | `lib/commands/handoff.ts:643`, `test/task-2214-repro.test.js:39`, `node --test test/task-2214-repro.test.js` | PASS |
| SC2: Validation identifies the declaration and gives command-only remediation | `lib/commands/handoff.ts:673`, `lib/commands/handoff.ts:677` | PASS |
| SC3: Draft instructions require exact commands and prohibit trailing outcomes | `prompts/draft.md:32`, `prompts/draft.md:33` | PASS |
| SC4: Quoted arguments and shell forms remain supported | `lib/commands/handoff.ts:645`, `test/handoff.test.js` | IMPLEMENTED; FOCUSED COMPATIBILITY EXPANSION DEFERRED TO CP-3 |
| SC5: Automated rejection and supported-form coverage | `test/task-2214-repro.test.js`, "runDeclaredGates rejects prose-appended commands before execution" | REJECTION PASS; COMPATIBILITY CASES DEFERRED TO CP-3 |
| SC6: Final declared gates pass | `./scripts/verify-local.sh static-analysis`, `node --test test/task-2214-repro.test.js test/handoff.test.js test/draft.test.js`, `./scripts/verify-local.sh all` | DEFERRED TO CP-3 |

Next action: replace legacy description-stripping expectations with rejection assertions, add checked/unchecked/bare/backticked and shell-syntax compatibility cases, then run all three mission gates.
