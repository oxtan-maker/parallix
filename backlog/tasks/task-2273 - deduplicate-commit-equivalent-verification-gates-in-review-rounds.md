---
id: TASK-2273
title: deduplicate commit-equivalent verification gates in review rounds
status: active
assignee: [codex]
created_date: '2026-07-16 10:54'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A single `px review --submit` round can execute the same general verification suite
three times: the handoff final gate, the review-remote pre-push hook, and the gates
declared in `MISSION.md`. On an older supported workstation this makes a review round
take about 20 minutes even when no gate-relevant content changes between executions.

Reduce duplicate verification without weakening Parallix development or allowing an
unverified tree to be published. First remove lifecycle duplication where one owner can
enforce the gate once. Where separate enforcement boundaries must remain, introduce a
content-addressed verification proof that is reusable only when the verifier command,
gate-relevant inputs, configuration, generated runtime artifacts, and required
toolchain/environment identity still match.

The proof must fail closed. Dirty gate-relevant files, a changed test or production
input, a changed verification command/configuration, stale generated JavaScript, a
failed or interrupted run, or an unreadable/invalid proof must execute the real gate.
Do not use elapsed-time TTLs as a substitute for identity validation. Preserve the
standalone safety of direct `npm test`, `./scripts/verify-local.sh`, Git pushes, and
integration gates when they are invoked outside an orchestrated review round.
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** make an unchanged review round execute each expensive verification plan at
most once while retaining fail-closed verification at every publication boundary.

**Scope and proof:** trace the handoff gate, pre-push hook, declared-gate runner,
review-loop gate, and verification-tree proof code; record command, tree, and input
identity at every boundary; choose a single gate owner where possible; otherwise pass
and validate a durable or process-scoped proof. Add counters in regression fixtures so
tests prove both deduplication and invalidation rather than relying on wall-clock
timeouts.

**Checkpoints:** (1) gate-call graph and exact duplicate-execution reproduction; (2)
proof schema/input fingerprint and fail-closed invalidation tests; (3) lifecycle/hook
wiring plus direct-command fallback coverage; (4) end-to-end review-round count and
cross-platform verification.

**Stop rule:** do not disable a standalone Git hook, skip a changed-tree gate, reuse a
failed/interrupted proof, or treat commit age/elapsed time as proof of validity. If a
safe gate-input fingerprint cannot be defined, deduplicate only executions with an
exact matching tree and command identity and document the remaining cost.

## Acceptance Criteria

- [ ] A regression fixture records the current handoff, pre-push, and declared-gate invocation counts for one review submission and proves which executions are duplicates.
- [ ] On the unchanged happy path, each identical expensive verification plan executes at most once per review round; assertions use invocation counters or proof identities, not runtime thresholds.
- [ ] A changed production file, test file, package/build input, verification script, gate configuration, or generated runtime artifact invalidates the proof and runs the real gate.
- [ ] Dirty gate-relevant files, failed gates, interrupted gates, missing proofs, malformed proofs, and identity mismatches fail closed and cannot authorize a push or review transition.
- [ ] Direct `npm test`, direct `./scripts/verify-local.sh all`, and a direct Git push retain their existing standalone verification behavior when no valid orchestrator proof is supplied.
- [ ] Mission/backlog-only changes are skipped only if an explicit tested input manifest proves they cannot affect that verification plan; otherwise they invalidate the proof.
- [ ] Deterministic lifecycle E2E, real-agent lifecycle E2E, static analysis, and integration-only gates retain their existing ownership and are not silently replaced by a general-suite proof.
- [ ] Operator output states whether a gate executed or reused a proof and prints the matching proof/tree identity for diagnosis.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
