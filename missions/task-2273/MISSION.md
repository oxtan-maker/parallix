# Mission: Deduplicate Commit-Equivalent Verification Gates in Review Rounds (task-2273)

## Goal
Make an unchanged `px review --submit` round execute each commit-equivalent expensive verification plan no more than once, while every publication boundary remains fail-closed unless it can validate a matching verification proof.

## Why Now
One review submission currently can run the general verification suite at handoff, again through the review-remote pre-push hook, and again from the mission-declared gates. On an older supported workstation this costs roughly 20 minutes despite no gate-relevant change. Eliminating only proven duplicates reduces review latency without relaxing the independent safety of direct commands, pushes, or integration gates.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; the backlog acceptance criteria identify the duplicate boundaries, invalidation cases, and safety invariants.
- Main drivers: gate-call ownership, content-addressed proof identity, fail-closed invalidation, review-round regression coverage, and standalone-command safety.

## Scope
- Trace the general-suite invocation path across `lib/commands/handoff.ts`, `lib/commands/review.ts`, `lib/review/`, the review-remote pre-push hook, `scripts/verify-local.sh`, and declared `MISSION.md` gates.
- Remove duplicate lifecycle ownership where one boundary can safely own a verification plan; retain separate boundaries that independently publish or transition state.
- Add a reusable verification-proof mechanism only where separate boundaries need it, keyed to verifier command, gate-relevant tracked and dirty inputs, configuration, generated runtime artifacts, and required toolchain/environment identity.
- Add counter- or proof-identity-based regression coverage for unchanged review submissions, proof reuse, proof invalidation, malformed or absent proofs, and direct-command fallback behavior.
- Make operator output distinguish a real gate execution from reuse and identify the tree/proof identity used.

## Out of Scope
- Skipping, weakening, or replacing standalone `npm test`, direct `./scripts/verify-local.sh all`, direct Git-push, or integration-only verification when no valid proof is available.
- Using elapsed-time TTLs, commit age, or wall-clock runtime as evidence that a verification result is reusable.
- Replacing deterministic lifecycle E2E, real-agent lifecycle E2E, static analysis, or integration-only gate ownership with a general-suite proof.
- Changing review policy, reviewer approval semantics, remote topology, or unrelated verification plans.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is stated as an observable behavior with identified inputs and assertions; no criterion relies on runtime thresholds or subjective assessment.

- A regression fixture for one `px review --submit` submission records handoff, review-remote pre-push, and declared-gate invocations, identifies the commit-equivalent calls, and asserts that each identical expensive plan executes at most once when all proof inputs match.
- A proof is reusable only when its verifier command, gate-relevant production and test inputs, verification configuration, generated runtime artifacts, and required toolchain/environment identity match the attempted boundary; the reuse decision is asserted by proof identity or invocation count.
- Changing a production file, test file, package or build input, verification script, gate configuration, or generated runtime artifact invalidates the proof and executes the real gate.
- Dirty gate-relevant files, a failed or interrupted gate, a missing, unreadable, or malformed proof, and every identity mismatch fail closed and cannot authorize a review transition or review-remote push.
- Direct `npm test`, direct `./scripts/verify-local.sh all`, and a direct Git push retain their existing standalone verification behavior when no valid orchestrator proof is supplied.
- Mission- and backlog-only edits are reused only when a tested explicit input manifest excludes them from the plan; otherwise they invalidate the proof.
- Deterministic lifecycle E2E, real-agent lifecycle E2E, static analysis, and integration-only verification remain separately owned and covered by their existing applicable gate paths.
- Execution and reuse output reports which occurred and prints the matching proof/tree identity, with regression assertions covering both output states.

## Risks and Assumptions
- Gate-relevant input discovery may be broader than the general suite's changed-file set; the implementation must favor invalidation when the manifest is incomplete or cannot be read.
- Generated JavaScript and toolchain/environment identity can differ from tracked source state; omitting either could reuse a stale result, so they are proof inputs rather than incidental metadata.
- Pre-push and handoff may execute in distinct processes or worktrees; any cross-boundary proof transport must be durable, scoped, and independently validated.
- Existing hooks and lifecycle E2E encode safety expectations not visible in a single gate runner; preserve them with focused regression tests before consolidating ownership.
- This mission assumes the general suite has identifiable command and input boundaries. If it cannot be safely fingerprinted, deduplicate only exact command-and-tree duplicates and document the retained executions.

## Checkpoints
- CP 1: Map the current invocation graph from handoff through declared gates, review submission, and review-remote pre-push; add a counter-based regression fixture that demonstrates the duplicate executions for an unchanged submission and names the plan owners.
- CP 2: Define and implement the proof schema and gate-input fingerprint. Add tests for exact reuse and every fail-closed invalidation input: dirty files, source/tests, package/build input, scripts/configuration, generated artifacts, toolchain/environment identity, missing/malformed proofs, failures, and interruptions.
- CP 3: Wire the chosen ownership/proof validation into the handoff, review, and hook paths. Cover direct `npm test`, direct `./scripts/verify-local.sh all`, and direct push behavior without an orchestrator proof, plus operator output for execution and reuse.
- CP 4: Exercise the complete review-round count and the retained separately owned lifecycle, static-analysis, and integration gate paths; update workflow documentation if the visible proof/reuse output changes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion addressed or explicitly deferred by the checkpoint.
- Accepted evidence forms already verified by Parallix: existing file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the gate boundary implementation (for example `lib/commands/handoff.ts:568`), exact counter/proof test names, test paths under `test/`, and commands such as `npm test -- test/<file>.test.js` or `./scripts/verify-local.sh all` as applicable.
- Raw `stat`/`ls` output or generic prose alone is not evidence. It may supplement a claim only when paired with one of the accepted references above.
- A concrete `Next action:` line at the bottom identifying the next code or verification step.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Declared-gate owner is identified | `lib/commands/handoff.ts:568`, `test/handoff.test.js` | PASS |
| Final verifier ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not edit mission or backlog status/assignee workflow fields except for documentation required by this mission; preserve the backlog task's `assignee` field.
- Do not bypass or weaken the review-remote pre-push hook, direct Git-push checks, standalone verifier commands, static analysis, lifecycle E2E, or integration-only gates.
- Do not write reusable proof state outside the repository's established runtime/state locations without explicit cleanup, scoping, and validation coverage.
- Do not modify unrelated review policy, remote configuration, or generated artifacts solely to make proof reuse succeed.

## Stop Rules
- Stop and retain real gate execution if no complete, deterministic fingerprint can be formed for a verification plan.
- Stop proof reuse and execute the gate if any proof input is dirty, absent, unreadable, malformed, failed, interrupted, stale, or mismatched.
- Stop before merging lifecycle ownership if tests cannot show that the receiving boundary still prevents publishing an unverified tree.
- Stop and escalate if satisfying reuse would require disabling a standalone command, Git hook, static-analysis gate, deterministic lifecycle E2E, real-agent lifecycle E2E, or integration-only gate.
