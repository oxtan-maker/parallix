# CP-1: Kernel contract and classification

## Summary

- Moved the ADR 0048 classification table out of the adapter and into the application layer as `src/application/failure-classification.ts` (`FailureClass`, `DispatchAction`, `DISPATCH_TABLE`, `getDispatchAction`, `classifyError`). `src/adapters/cli/commands/repair-handoff.ts` now imports and re-exports those symbols, so its callers and its `(repairHandoff as any).classifyError` seam are unchanged. This move is what lets the application-layer kernel consume the single table without violating the layer rule enforced by `test/application-boundaries.test.ts` (application may import `domain` and `application` only).
- Folded the pre-review gate site's ad-hoc human-only override regex into the classifier as the named rule `hasExplicitHumanOnlyDiagnostic()`. Semantics are unchanged from the call-site version — human-only requires both a `HumanOnly` dispatch from the table *and* a recognized infrastructure/state-machine marker, which is what distinguishes an explicit blocker from the classifier's catch-all `InfraBlocker` default. No call site keeps its own copy.
- Created the kernel module `src/application/rebound-kernel.ts`:
  - `ReboundReason` union with all five structured kinds — `gate-failure`, `hook-failure`, `artifact-incomplete`, `agent-timeout`, `handoff-verification`. No kind is a regex match over combined text; `reboundDiagnostic()` flattens a reason into diagnostic text only for the human-only rule and the prompt.
  - `ReboundContext` (slug, worktree, implementer, `verify` callback, injected `startAgent`, optional `maxAttempts`, transition and agent-fallback callbacks, log/error).
  - `ReboundOutcome` = `fixed` | `exhausted` | `human-only`, plus attempts, last diagnostic, classification, and the fallback-resolved implementer.
  - `classifyReboundReason()`: structured facts pick the ADR 0048 class (gate ran and exited non-zero → `GateFailure`; hook rejection → `GitBlockers`; artifact-incomplete → `IncompleteEvidence`; agent-timeout → `InfraBlocker`; handoff-verification → classified from its own error text), with the human-only rule able to override the two incident-path kinds.
  - `buildReboundFixPrompt()`: the single slot-based builder (kind label, mission, area/facts, diagnostic, classification, attempt, remedy, and the automatic re-verify statement); the context-compaction boilerplate lives here.
  - `rebound()` entry point: human-only short-circuits with zero launches; the relaunchable path launches through the injected `startAgent` and calls `verify()`. The attempt loop, per-occurrence budget wiring, and null-exit reclassification are asserted in CP 2.
- The kernel performs no state-store, filesystem, or process I/O: every effect arrives through injected callbacks.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — kernel exposes `rebound(reason, context) -> outcome` with the contract shapes | `src/application/rebound-kernel.ts` (`ReboundReason`, `ReboundContext`, `ReboundOutcome`, `rebound`); `"task-2377.03: a human-only classification returns human-only without launching an agent"` | PASS |
| All five reason kinds exist in the union and classify | `test/task-2377.03-rebound-kernel.test.ts`: `"task-2377.03: a declared gate that ran and exited non-zero classifies as GateFailure, not a Git blocker"`, `"task-2377.03: a Git hook failure classifies as a mechanical GitBlockers auto-repair"`, `"task-2377.03: an artifact-incomplete reason classifies as IncompleteEvidence auto-send-back"`, `"task-2377.03: an agent-timeout reason classifies as an InfraBlocker human-only failure"`, `"task-2377.03: a handoff-verification reason classifies from its own ADR 0048 error text"` | PASS |
| SC5 — classification is the single ADR 0048 table; human-only override folded in as a classifier rule | `ADR 0048`; `src/application/failure-classification.ts` (`hasExplicitHumanOnlyDiagnostic`); `"task-2377.03: the human-only rule inside the classifier keeps an infrastructure gate diagnostic human-only"`, `"task-2377.03: the human-only rule keeps a state-machine gate diagnostic human-only"` | PASS |
| SC5 — a declared gate that ran and exited non-zero dispatches as a gate failure, not a Git blocker | `"task-2377.03: an unrecognized gate diagnostic still bounces instead of stranding as the classifier default"` | PASS (kernel side; call-site remap deleted in CP 3) |
| SC6 — one prompt builder carrying the compaction boilerplate and the re-verify statement | `src/application/rebound-kernel.ts` (`buildReboundFixPrompt`); `"task-2377.03: the single fix-prompt builder carries the compaction boilerplate and the automatic re-verify statement"`, `"task-2377.03: the hook fix prompt uses the same builder with hook slots"` | PASS (call sites migrated in CP 4) |
| Kernel unit tests are mock-only (no real agents, git, or Forgejo) | `test/task-2377.03-rebound-kernel.test.ts` — `startAgent` and `verify` injected via `contextFor()` | PASS |
| Classifier move keeps existing consumers and layer boundaries green | `npm test -- test/repair-handoff.test.ts test/task-1385-pre-review-gate.test.ts test/application-boundaries.test.ts test/task-2377.03-rebound-kernel.test.ts` → 87 pass, 0 fail | PASS |

Next action: CP 2 — add the launch→verify→relaunch loop with the per-occurrence in-memory budget (default 2), reclassify a null/ambiguous agent exit as launch failure, and assert SC2/SC3/SC4 in `test/task-2377.03-rebound-kernel.test.ts` including a mocked state store that fails on any write.
