# CP-1: Execution-root contract inventory

## Summary

Audited the production defense surface for root resolution and child-process
working directories. The selected-target-root contract is: once a mission
worktree has been selected, its absolute root is passed explicitly to every
verification, Git, configuration, asset, temporary-path, proof, and child
process operation. Ambient `process.cwd()` is allowed only at a top-level CLI
boundary before target selection; primary-root resolution is allowed only for
an operation that intentionally changes the primary checkout.

| Defense family | Audited call sites | Classification and remediation seam |
|---|---|---|
| Local verification and proof | `core/verification.ts` root defaults and `runVerificationGate` child `cwd` | target-worktree after caller supplies `rootDir`; tests can inject `gitRunner` and `runFn`. |
| Default/unit runner and static analysis | `test/run-default-tests.js` build/test children; `scripts/verify-local.sh` script-root discovery | target-worktree when launched from that tree; add an explicit root argument/environment contract and mocked child-process assertions. |
| Integration gate planning/execution | `commands/integrate.ts:527`, `commands/integrate.ts:555`, `commands/integrate.ts:685` | `:527`/`:685` are target-worktree; `:555` is invalid because its fallback is `getPrimaryWorktree()`. |
| Workflow E2E and real-agent smoke | `test/e2e-mission-lifecycle.test.ts`, `test/e2e-real-agent-smoke.test.ts`, agent launchers | target-worktree; fixtures must assert launcher `cwd` and use temporary repositories only. |
| Checkpoint and handoff | `commands/checkpoint.ts:22`, `commands/checkpoint.ts:38`; `commands/handoff.ts:253`, `commands/handoff.ts:948` | checkpoint is invalid after slug selection because it uses ambient CWD; handoff is target-worktree once `opts.worktree` is supplied. |
| Review and rebase | `commands/rebase.ts:54`, `commands/rebase.ts:80`, `commands/rebase.ts:96`, `commands/rebase.ts:171`; review command child Git calls | rebase locations are invalid or primary-fallback after a mission is selected; review helpers carry `rootDir` and are target-worktree. |
| Exact-tree proof and publication | `core/verification.ts:180`, `tools/forgejo.ts:481`, `tools/forgejo.ts:883`, `tools/forgejo.ts:1035` | target-worktree for branch proof/push; `syncPrimaryBaseline` is the retained primary-only exception and must be documented/tested as such. |
| Integration and hooks | `commands/integrate.ts:685`, `core/post-integrate-hook.ts:61`, `tools/setup-review.ts:1078` | integration gate and post-integrate hook use supplied roots; setup-review verification needs a root-propagation test. |
| Git/worktree lookup | `core/git.ts:49`, `core/mission-utils/worktree.ts:58`, `agents/worktree.ts:58` | top-level/default utility boundaries are primary/ambient only before selection; selected mission callers must pass the root. |

The audit command is intentionally reproducible:

```sh
rg -n --glob 'src/**' --glob '!**/*.test.*' 'process\\.cwd\\(\\)|getPrimaryWorktree\\(|resolveWorktree\\(|\\brootDir\\b|\\bcwd\\s*:' src
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production-defense root-resolution call site is classified | `missions/task-2298/CP-1.md`, `src/platform/runtime/lib/core/verification.ts:145`, `src/platform/runtime/lib/commands/rebase.ts:54` | PASS — inventory completed; invalid sites are explicitly identified for CP-2/CP-3 remediation. |
| Selected-root propagation seam for verification and nested children is identified | `src/platform/runtime/lib/core/verification.ts:180`, `src/platform/runtime/lib/commands/integrate.ts:685`, `src/platform/runtime/lib/commands/handoff.ts:948` | PASS |
| Primary-only exception is constrained to an operation on primary | `src/platform/runtime/lib/tools/forgejo.ts:883`, `ADR 0045` | PASS — synchronization of the review baseline remains separately scoped. |
| Two-worktree test seams are identified without real services | `test/integration-pipelines.test.ts`, `test/rebase_hardening.test.ts`, `test/forgejo.test.ts` | PASS |

Next action: replace checkpoint, verification-runner, and integration-gate ambient/primary fallbacks with one selected execution root, then add temporary-repository nested-CWD coverage.
