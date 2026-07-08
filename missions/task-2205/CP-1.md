# CP-1

Identified and applied the checkpoint-1 insertion points in `setupRepository()`: the seeded smoke repo now creates `hello.sh` before repository initialization, and the seeded backlog task text now points the agent at fixing that file instead of generating a new program.

## Goal Check Table

| Check | Evidence | Test |
| --- | --- | --- |
| Seeded-file insertion point is before repo initialization and the initial add/commit sequence | `test/e2e-real-agent-smoke.test.js:305`, `test/e2e-real-agent-smoke.test.js:325`, `test/e2e-real-agent-smoke.test.js:328`, `test/e2e-real-agent-smoke.test.js:329` | `real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)` |
| Backlog task text now targets typo repair in the pre-seeded file | `test/e2e-real-agent-smoke.test.js:321` | `real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)` |

Next action: finish CP-2 by validating the exact seeded file contents and then run the repo verification gate.
