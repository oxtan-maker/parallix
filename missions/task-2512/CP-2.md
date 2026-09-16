# CP-2: Establish integrate workflow ports

Added an application-owned integrate capability contract and a CLI adapter binding that exposes each current infrastructure mechanism through a live module namespace. The existing integrate implementation still executes unchanged for this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 adapter exports remain importable before sequencing moves | `npm test -- test/integrate.test.ts test/integrate-guard.test.ts`, `src/adapters/cli/commands/integrate.ts` | PASS |
| SC6 integration option seams remain functional | `test/integrate.test.ts`, "px integrate --dry-run never invokes the post-integrate hook (SC4)" | PASS |

Next action: Move integrate sequencing into the application use case through `src/application/ports/integrate-workflow.ts` and reduce the adapter below 450 lines.
