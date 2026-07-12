# CP-1: Lock prose-appended gate regression

Added the task-specific reproduction test before changing production or prompt code. The test builds a temporary mission containing ``- [ ] `./scripts/verify-local.sh all` passes on the final tree.``, instruments the executable with a marker file, and requires command-only validation to reject the declaration before that executable runs. On the current parent behavior, the test is demonstrably red because `runDeclaredGates` returns `gate-failed` instead of `validation-failed` after reaching shell execution.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Reproduction is red before the fix and specifies early validation | `test/task-2214-repro.test.js:9`, `node --test test/task-2214-repro.test.js` | RED AS REQUIRED |
| SC2: Reproduction requires the offending text and command-only remediation | `test/task-2214-repro.test.js:14`, `test/task-2214-repro.test.js:35` | TEST LOCKED; IMPLEMENTATION DEFERRED TO CP-2 |
| SC3: Draft instructions prohibit outcome prose | `prompts/draft.md` | DEFERRED TO CP-2 |
| SC4: Supported gate forms remain executable | `test/handoff.test.js` | DEFERRED TO CP-2/CP-3 |
| SC5: Rejected gates do not invoke the shell runner | `test/task-2214-repro.test.js:39`, "runDeclaredGates rejects prose-appended commands before execution" | TEST LOCKED; IMPLEMENTATION DEFERRED TO CP-2 |
| SC6: Final declared gates pass | `./scripts/verify-local.sh static-analysis`, `node --test test/task-2214-repro.test.js test/handoff.test.js test/draft.test.js`, `./scripts/verify-local.sh all` | DEFERRED TO CP-3 |

Next action: implement command-only suffix validation in `validateDeclaredGates`, then tighten `prompts/draft.md` while preserving quoted arguments, pipelines, redirects, and compound commands.
