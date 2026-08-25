# Mission: Make recovery actionable, evidence-preserving and non-stranding (task-2413)

## Goal
Make every bounded, agent-fixable recovery incident retain its structured root cause, use one recovery-policy authority, and give the next agent exact stage-specific evidence. Reuse a successful handoff verification proof only when the tree, command, inputs, and toolchain still match; otherwise run fresh verification and preserve its failure evidence. Keep recovery bounded and leave genuine exhaustion with an actionable dossier rather than a generic stranded result.

## Why Now
The task-2373.01 production incident showed that handoff can verify a tree successfully, then Forgejo reruns the same verifier under contention and collapses its detailed failure into an exit-code wrapper. The implementer then receives a generic prompt, spends the wrong retry currency, and can be stranded after a later clean run. The duplicated recovery paths now span handoff, publication, review, rebase, artifacts, timeouts, and legacy repair-handoff, so a local retry-count increase would leave the systemic failure intact.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: cross-cutting recovery-policy migration with behavioural regressions specified
- Main drivers: structured root-failure propagation; verified-proof identity and reuse; fresh-failure classification; separate retry budgets; migration of handoff, review, rebase, artifact, timeout, and legacy repair consumers

## Scope
- Inventory all recovery, retry, relaunch, verification, publication, timeout, artifact, hook, rebase, and recursive-handoff paths before changing policy.
- Extend the existing rebound reason model to carry structured process evidence and preserve an underlying cause through wrappers.
- Reclassify and fingerprint each fresh failed recovery check; visibly start or report a reclassified incident when the material failure changes.
- Reuse authoritative handoff verification proof for publication only after exact HEAD/tree, command, relevant-input, and toolchain identity checks; invalidate reuse on any mismatch.
- Separate and bound transient verifier reruns, implementer repairs, launcher/session recovery, provider/network retries, and conflict/hook repair, with observable attempt history.
- Add conservative adapter-driven transient verifier handling for unchanged trees, including the Parallix timing/resource-contention failure class, without treating a failure as success.
- Consolidate recovery classification, prompt construction, and attempt semantics in rebound; migrate repair-handoff and review timeout paths to it or thin delegates.
- Produce bounded, actionable exhaustion dossiers and retain existing concrete rebase-conflict guidance.
- Add regression or characterisation coverage for every behavioural acceptance test in the backlog task.

## Out of Scope
- Raising retry limits as the primary remedy, weakening or suppressing verification, or allowing stale proof to authorize publication.
- Task-2373-specific logic, hard-coded host load thresholds, or remediation that kills unrelated processes or changes other worktrees.
- A second lifecycle, review, or recovery persistence authority, or a parallel RecoveryManager abstraction.
- Unrelated workflow redesigns and changes to the mission lifecycle outside recovery evidence and bounded recovery decisions.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Handoff and publication failures preserve mission, stage, role, cwd, revision/tree identity, failed command, exit status or signal, bounded stdout/stderr, underlying structured cause, relevant review state, recovery action, and attempt history; an outer Forgejo wrapper cannot replace or misclassify a gate failure.
- An implementer recovery prompt for a failed command includes that exact command, cwd, exit status, useful captured output, current revision, and the post-return action; it never claims commands are listed when none are present.
- A successful final handoff verifier produces reusable proof, and unchanged publication consumes/asserts it without rerunning the same verifier; changed HEAD/tree, command, relevant inputs, or toolchain invalidates reuse and requires fresh verification.
- A failed fresh verification or recovery check is fingerprinted and classified anew; a materially changed failure receives its new class, policy, and prompt rather than the prior incident's policy.
- Transient unchanged-tree verifier outcomes exhaust only their bounded transient budget before agent launch; deterministic failures use normal repair, and exhausted transient outcomes remain failures with structured evidence.
- Launcher/session, implementer repair, provider/network, transient verifier, and conflict/hook recovery use distinct bounded accounting with matching prompt, log, and loop denominators; nested handoff remediation cannot multiply budgets invisibly.
- Handoff, artifact, gate, hook, review timeout, rebase conflict, and legacy repair-handoff consumers use the same recovery classification and prompt authority, while rebase conflict guidance remains concrete.
- Genuine recovery exhaustion emits a bounded dossier containing the current root failure, HEAD, last failed command/action, useful diagnostic, fingerprints and attempt history, successful checks, stop reason, and safest manual next action; the mission remains recoverable through normal Parallix commands.
- Regression coverage proves all 18 behavioural acceptance cases in the backlog task, including red-to-green coverage for the information-loss reproduction, and existing lifecycle/review/rebase/handoff behaviour remains green.

## Risks and Assumptions
- Risk: recovery producers have hidden nested retry loops; inventory and focused characterisation must precede migration to avoid leaving a duplicate authority active.
- Risk: proof reuse could weaken publish safety; reuse is permitted only after exact identity validation and every mismatch must force fresh verification.
- Risk: transient classification may hide deterministic failures; it must be adapter-configured, bounded, unchanged-tree-only, and must never yield success.
- Assumption: `rebound-kernel.ts` remains capable of owning shared recovery policy; stage orchestration can stay in its current consumers.

## Checkpoints
- CP 1: Author `test/task-2413-repro.test.ts` before any recovery fix. Reproduce a successful handoff verifier followed by publication verification whose failure is surfaced only as an exit-code-only Forgejo wrapper. Assert at the mission parent commit that the handoff caller lacks the underlying command/cwd/exit/captured-output structured gate failure (red); after the fix, assert those fields are preserved (green). Record the complete inventory of recovery/retry/relaunch producers and their current authority in CP-1 evidence.

Reproduction-Test: test/task-2413-repro.test.ts

- CP 2: Implement structured root-failure propagation, per-check fingerprinting and reclassification, separate recovery currencies, conservative transient handling, and exact verification-proof reuse/invalidation; add coverage proving stale proof cannot authorize publication.
- CP 3: Migrate handoff, review timeout, artifact, hook, rebase, and repair-handoff consumers to the central rebound policy; remove or reduce duplicate policy seams to thin stage adapters and prove consistent prompt/log/loop accounting.
- CP 4: Exercise handoff-to-publication, changed-failure, transient, timeout, exhaustion, and rebase-conflict paths through command seams; capture the final actionable recovery dossier and full verification evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done supported first by durable evidence: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.
- The exact heading `## Goal Check`.
- The exact 3-column table `| Criterion | Evidence | Status |`, with at least one durable evidence row for every success criterion.
- Raw `stat`/`ls` output or generic prose may supplement evidence but is not enough on its own; pair shell output with an accepted reference above.
- CP-1 must name `test/task-2413-repro.test.ts`, show its red assertion at the parent commit, and identify the recovery producers and their current authority.
- CP-2 must cite tests for structured failure preservation, proof reuse and invalidation, changed-failure reclassification, and retry-currency separation.
- CP-3 must cite the migrated consumer tests and the removed or delegated legacy recovery seam.
- CP-4 must cite the command-seam tests, the final verification command, and the exhaustion-dossier evidence.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify verification policy to pass or suppress failures, use stale proof, or introduce task-2373-specific recovery behaviour.
- Do not add independent lifecycle/review/recovery persistence or retain competing prompt/classification policy in `repair-handoff.ts`.
- Do not perform host-wide process cleanup, mutate another mission worktree, or consume shared SQLite retry counters.
- Do not broaden this mission into unrelated CLI, review, or lifecycle redesign.

## Stop Rules
- Stop and request direction if preserving a root failure requires a second persistent source of lifecycle/review truth rather than extending existing state.
- Stop and request direction if proof identity cannot include a trustworthy representation of HEAD/tree, command, relevant inputs, and toolchain without weakening publication safety.
- Stop and request direction if a proposed transient policy cannot distinguish adapter-declared environmental outcomes from deterministic failures without treating a failure as success.
- Stop and request direction if the recovery-path inventory reveals a consumer whose migration would require changing unrelated external-provider semantics beyond bounded evidence preservation and recovery policy.
