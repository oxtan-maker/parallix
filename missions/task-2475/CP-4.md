# CP-4: Product configuration and closure

Configured Parallix with two enforced custom-agent slots while preserving its independent advisory subagent setting. Configuration documentation now distinguishes the two controls.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Machine-wide custom capacity is atomic | `test/custom-capacity-multiprocess-repro.test.ts`, "two processes contend for one custom slot: exactly one acquires" | Passed |
| Detached-child identity is PID-reuse safe | `test/custom-capacity-detached-child.test.ts`, "a lease liveness identity rejects a reused PID" | Passed |
| Shared `PARALLIX_HOME` capacity covers repositories | `test/custom-capacity-cross-repo.test.ts`, "repositories sharing PARALLIX_HOME share custom capacity" | Passed |
| Checked-in custom capacity is two and subagent control remains separate | `workflow.config.json`; `docs/config.md`; `px config` | Configured |
| Static analysis and focused lease tests are clean | `npx tsc --noEmit --pretty false`; `node --import tsx --test test/custom-capacity-multiprocess-repro.test.ts test/custom-capacity-cross-repo.test.ts test/custom-capacity-detached-child.test.ts` | Passed |

Next action: run the mission-declared repository gates after committing this closure checkpoint.
