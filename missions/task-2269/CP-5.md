# CP-5 — Compatible test-runtime selection

Fixed the handoff gate failure caused by npm launching the default test runner
from an obsolete Node 14 nvm shim. The runner now retains its current process
when it is Node 20+ and otherwise selects a compatible `node` executable from
`PATH` before it invokes the built-in Node test runner.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Default test runner uses a Node runtime that supports `--test` | `test/run-default-tests.js:8`, `test/run-default-tests.js:19` | PASS |
| Node 14 parent process selects the available Node 22 executable for the focused suite | `test/run-default-tests.js`, `test/verify-local-integrate.test.js` | PASS |
| Codex integration-option regression coverage remains green | `"verify-local integrate forwards the Codex override only to custom-agent-smoke"` | PASS |

Next action: commit the runtime-selection repair, then resubmit `task-2269` for review.
