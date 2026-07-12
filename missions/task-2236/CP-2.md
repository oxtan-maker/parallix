# CP-2 — E2E wiring repaired

Fixed the test-command path so an explicit file passed through `npm test -- <file>` is executed instead of being discarded. The real-agent smoke target also bypasses the unit-test HOME isolation preload, allowing its existing fixture to copy the operator's pi configuration into its disposable agent directory. Placeholder local-provider keys in that copied configuration are replaced only inside the disposable directory, so pi can run against the local vLLM endpoint without writing to operator state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Explicit npm test target replaces the default suite | `test/run-default-tests.js:12` | PASS |
| Real pi smoke avoids the unit-test HOME shim | `test/run-default-tests.js:18` | PASS |
| Pi fixture keeps agent state disposable and normalizes only copied placeholder local keys | `test/e2e-real-agent-smoke.test.js:300` | PASS |
| Regression test protects command selection and real-agent bootstrap wiring | `test/task-2236-pi-e2e-repro.test.js:6` | PASS |

Next action: wait for the single real pi draft-plus-active lifecycle to complete, then run the required repository verifier.
