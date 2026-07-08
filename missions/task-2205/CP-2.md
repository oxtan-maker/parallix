# CP-2

Implemented the smoke-test narrowing change in the seeded repository fixture: `hello.sh` is written with an intentional `Helo, Wrld!` typo, and the generated backlog task instructs the real agent to fix that typo while preserving the existing smoke-test assertion surface.

## Goal Check Table

| Check | Evidence | Test |
| --- | --- | --- |
| `hello.sh` is created with a deliberate typo in the seeded repo fixture | `test/e2e-real-agent-smoke.test.js:305` | `real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)` |
| Seeded backlog task instructs the agent to fix `hello.sh` instead of creating a script | `test/e2e-real-agent-smoke.test.js:321` | `real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)` |
| The initial `git add .` and `git commit` still capture the seeded file for the draft phase | `test/e2e-real-agent-smoke.test.js:328`, `test/e2e-real-agent-smoke.test.js:329` | `real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)` |

Next action: run `./scripts/verify-local.sh all` and capture the passing gate output for CP-3.
