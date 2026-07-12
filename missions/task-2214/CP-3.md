# CP-3: Complete compatibility coverage and verification

Replaced the former description-stripping expectations with command-only rejection coverage and added explicit compatibility cases for bare, checked, unchecked, and fully backticked commands. Added protection for quoted arguments, pipelines, redirects, and compound commands, plus a draft-prompt contract test. The full gate exposed a pre-existing trailing comma in `workflow.config.json`; repairing it activated the configured `pi` runner, so launcher-dependent tests were isolated with a `pi` stub and runner-appropriate model flags. The integration approval test now explicitly selects Forgejo mode instead of inheriting the neighboring primary checkout. Graphify was updated after code changes. All three declared mission gates pass on the final tree; the full suite reports 2,094 passed, 0 failed, and 23 annotated skips.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: The task-2214 reproduction changed from red at the parent behavior to green through pre-execution validation | `test/task-2214-repro.test.js:9`, "runDeclaredGates rejects prose-appended commands before execution", `node --test test/task-2214-repro.test.js` | PASS |
| SC2: Rejection uses `validation-failed`, includes the offending declaration, and directs outcomes to non-gate documentation | `lib/commands/handoff.ts:673`, `lib/commands/handoff.ts:677`, "validateDeclaredGates rejects outcome prose with command-only remediation" | PASS |
| SC3: Canonical draft instructions require exact runnable commands and prohibit outcome suffixes | `prompts/draft.md:32`, `prompts/draft.md:33`, "buildDraftPrompt requires command-only Gates and relocates outcome prose" | PASS |
| SC4: Bare, checked, unchecked, and fully backticked commands execute; quoted arguments and shell composition remain valid | `test/handoff.test.js:1530`, `test/handoff.test.js:1552`, "runDeclaredGates executes bare, backticked, checked, and unchecked command forms", "validateDeclaredGates preserves quoted arguments, pipelines, redirects, and compound commands" | PASS |
| SC5: Focused tests cover prose-appended and dash-suffixed rejection before execution plus every supported declaration form | `test/task-2214-repro.test.js:39`, `test/handoff.test.js:1502`, `test/handoff.test.js:1516`, "runDeclaredGates rejects explanatory dash suffixes" | PASS |
| SC6: Static analysis, focused tests, and the complete local verifier succeed | `./scripts/verify-local.sh static-analysis`, `node --test test/task-2214-repro.test.js test/handoff.test.js test/draft.test.js`, `./scripts/verify-local.sh all` | PASS |

Next action: commit CP-3 with the final implementation/test artifacts, then hand task-2214 to review with `px review task-2214 --submit`.
