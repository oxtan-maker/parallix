# CP-3: Recovery and configuration authority

Added PID-start-identity liveness checks, shared-home coverage, and canonical-worktree policy resolution. A malformed canonical workflow configuration now fails custom admission rather than falling back to unlimited capacity.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repositories sharing operator state share capacity | `test/custom-capacity-cross-repo.test.ts`, "repositories sharing PARALLIX_HOME share custom capacity" | Passed |
| PID reuse and stale leases are handled safely | `test/custom-capacity-detached-child.test.ts`, "a lease liveness identity rejects a reused PID"; `src/adapters/process/process-liveness.ts` | Passed |
| Mission worktree is not the policy authority | `src/adapters/config/product-config.ts`, `resolveCanonicalRepositoryRoot` and `resolveCanonicalMaxConcurrentCustom` | Passed |
| Invalid present configuration fails closed; absent remains unlimited | `src/adapters/config/product-config.ts`; `npx tsc --noEmit --pretty false` | Passed |

Next action: commit the checked-in capacity setting, documentation distinction, and final checkpoint evidence; then run all mission gates.
